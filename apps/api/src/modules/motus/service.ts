import { randomInt } from "node:crypto";
import {
  MOTUS_ERROR_LABELS,
  MOTUS_MAX_ATTEMPTS,
  MOTUS_WORD_LENGTHS,
  currentMotusSlot,
  getGame,
  isValidStake,
  motusReward,
  type MotusGuessInput,
  type MotusGuessView,
  type MotusView,
} from "@maxoujeux/shared";
import { evaluateMotusGuess, normalizeMotusWord } from "@maxoujeux/engines";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { motusAttempts, motusSlots, motusWords, wallets } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { notifyWallet } from "../../realtime/notify.js";
import { releaseActivity, reserveActivity } from "../games/activity.js";
import {
  publishRoundReceipt,
  recordRoundInTx,
  type RoundReceipt,
} from "../stats/service.js";
import { creditInTx, debitInTx } from "../wallet/service.js";

type Attempt = typeof motusAttempts.$inferSelect;
type Slot = typeof motusSlots.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const MAX_ACTIVE = getGame("motus")?.maxTables ?? 10;
const MOTUS_MIN_STAKE = getGame("motus")?.wager.min ?? 10;

export interface MotusNotifier {
  state(userId: string, view: MotusView): void;
  counts(): void;
}

const NO_NOTIFIER: MotusNotifier = { state: () => {}, counts: () => {} };
let notifier: MotusNotifier = NO_NOTIFIER;

export function setMotusNotifier(next: MotusNotifier): void {
  notifier = next;
}

/** Sockets qui consultent réellement la page, regroupées par compte. */
const watchers = new Map<string, Set<string>>();
/** Utilisateurs qui occupent l'une des dix places de jeu. */
const active = new Map<string, string>();

function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}

function addWatcher(userId: string, socketId: string): void {
  const sockets = watchers.get(userId) ?? new Set<string>();
  sockets.add(socketId);
  watchers.set(userId, sockets);
}

function releaseSession(userId: string): void {
  const id = active.get(userId);
  if (!id) return;
  active.delete(userId);
  releaseActivity(userId, { kind: "motus", id });
  notifier.counts();
}

function reserveSession(userId: string, slotStart: string): void {
  const current = active.get(userId);
  if (current === slotStart) return;
  if (current) releaseSession(userId);
  if (active.size >= MAX_ACTIVE) {
    fail("MOTUS_CAPACITY_REACHED", MOTUS_ERROR_LABELS.MOTUS_CAPACITY_REACHED);
  }
  if (!reserveActivity(userId, { kind: "motus", id: slotStart })) {
    fail("ALREADY_IN_GAME", "Tu joues déjà à un autre jeu. Termine-le avant de reprendre Motus.");
  }
  active.set(userId, slotStart);
  notifier.counts();
}

function storedGuesses(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((guess): guess is string => typeof guess === "string") : [];
}

async function ensureSlot(tx: Transaction, now: Date): Promise<Slot> {
  const current = currentMotusSlot(now);
  const [existing] = await tx
    .select()
    .from(motusSlots)
    .where(eq(motusSlots.slotStart, current.start))
    .limit(1);
  if (existing) return existing;

  const length = MOTUS_WORD_LENGTHS[randomInt(MOTUS_WORD_LENGTHS.length)];
  if (!length) fail("MOTUS_UNAVAILABLE", MOTUS_ERROR_LABELS.MOTUS_UNAVAILABLE, 503);
  const [candidate] = await tx
    .select({ word: motusWords.word })
    .from(motusWords)
    .where(
      and(
        eq(motusWords.length, length),
        eq(motusWords.active, true),
        eq(motusWords.isSolution, true),
      ),
    )
    .orderBy(sql`random()`)
    .limit(1);
  if (!candidate) fail("MOTUS_UNAVAILABLE", MOTUS_ERROR_LABELS.MOTUS_UNAVAILABLE, 503);

  await tx
    .insert(motusSlots)
    .values({ slotStart: current.start, word: candidate.word, length })
    .onConflictDoNothing({ target: motusSlots.slotStart });

  const [slot] = await tx
    .select()
    .from(motusSlots)
    .where(eq(motusSlots.slotStart, current.start))
    .limit(1);
  if (!slot) fail("MOTUS_UNAVAILABLE", MOTUS_ERROR_LABELS.MOTUS_UNAVAILABLE, 503);
  return slot;
}

async function slotOf(tx: Transaction, slotStart: Date): Promise<Slot> {
  const [slot] = await tx
    .select()
    .from(motusSlots)
    .where(eq(motusSlots.slotStart, slotStart))
    .limit(1);
  if (!slot) fail("MOTUS_UNAVAILABLE", MOTUS_ERROR_LABELS.MOTUS_UNAVAILABLE, 503);
  return slot;
}

async function attemptView(
  tx: Transaction,
  userId: string,
  attempt: Attempt | null,
  slot: Slot,
  now: Date,
): Promise<MotusView> {
  const current = currentMotusSlot(now);
  const guesses = attempt ? storedGuesses(attempt.guesses) : [];
  const evaluated: MotusGuessView[] = guesses.map((guess) => {
    const result = evaluateMotusGuess(slot.word, guess);
    return { guess: result.guess, marks: result.marks };
  });
  const isCurrentSlot = slot.slotStart.getTime() === current.start.getTime();
  const finished = attempt?.finishedAt != null;
  const status = !attempt
    ? "available"
    : !finished
      ? "playing"
      : attempt.solved
        ? "won"
        : "lost";
  const endReason = !finished
    ? null
    : attempt?.solved
      ? "solved"
      : guesses.length >= MOTUS_MAX_ATTEMPTS
        ? "attempts"
        : "abandoned";
  const [currentAttempt] = await tx
    .select({ userId: motusAttempts.userId })
    .from(motusAttempts)
    .where(and(eq(motusAttempts.userId, userId), eq(motusAttempts.slotStart, current.start)))
    .limit(1);
  const payout = attempt?.reward ?? 0;

  return {
    slotStart: slot.slotStart.toISOString(),
    slotEnd: currentMotusSlot(slot.slotStart).end.toISOString(),
    nextSlotAt: current.end.toISOString(),
    isCurrentSlot,
    canStartCurrent: status === "available" || (finished && !currentAttempt),
    length: slot.length,
    guesses: evaluated,
    attemptsLeft: Math.max(0, MOTUS_MAX_ATTEMPTS - guesses.length),
    status,
    endReason,
    // Sans tentative en cours, la mise affichée est le minimum : l'écran s'en
    // sert comme proposition de départ dans son champ de saisie.
    stake: attempt?.stake ?? MOTUS_MIN_STAKE,
    payout,
    net: attempt ? payout - attempt.stake : 0,
    version: attempt?.version ?? 0,
    startedAt: attempt?.startedAt.toISOString() ?? null,
    durationMs:
      attempt && attempt.finishedAt
        ? attempt.finishedAt.getTime() - attempt.startedAt.getTime()
        : null,
    now: now.toISOString(),
  };
}

async function stateInTx(tx: Transaction, userId: string, now: Date): Promise<MotusView> {
  const [unfinished] = await tx
    .select()
    .from(motusAttempts)
    .where(and(eq(motusAttempts.userId, userId), isNull(motusAttempts.finishedAt)))
    .limit(1);
  if (unfinished) {
    return attemptView(tx, userId, unfinished, await slotOf(tx, unfinished.slotStart), now);
  }

  const slot = await ensureSlot(tx, now);
  const [attempt] = await tx
    .select()
    .from(motusAttempts)
    .where(and(eq(motusAttempts.userId, userId), eq(motusAttempts.slotStart, slot.slotStart)))
    .limit(1);
  return attemptView(tx, userId, attempt ?? null, slot, now);
}

async function state(userId: string, now: Date): Promise<MotusView> {
  return db.transaction((tx) => stateInTx(tx, userId, now));
}

function synchronizeReservation(userId: string, view: MotusView): void {
  if (view.status === "playing") reserveSession(userId, view.slotStart);
  else releaseSession(userId);
}

/** Une réponse lente ne doit pas rattacher une page déjà quittée. */
function synchronizeAttachedReservation(userId: string, view: MotusView): void {
  const sockets = watchers.get(userId);
  if (sockets && sockets.size > 0) synchronizeReservation(userId, view);
  else releaseSession(userId);
}

export async function watch(userId: string, socketId: string, now = new Date()): Promise<MotusView> {
  addWatcher(userId, socketId);
  try {
    const view = await state(userId, now);
    synchronizeAttachedReservation(userId, view);
    return view;
  } catch (error) {
    unwatch(userId, socketId);
    throw error;
  }
}

/** Quitter l'écran suspend la tentative ; seul `abandon` la termine. */
export function unwatch(userId: string, socketId: string): void {
  const sockets = watchers.get(userId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size > 0) return;
  watchers.delete(userId);
  releaseSession(userId);
}

export async function start(
  userId: string,
  socketId: string,
  stake: number,
  now = new Date(),
): Promise<MotusView> {
  // Rejoué côté serveur : le front propose des paliers, mais rien n'empêche
  // d'envoyer 37 MaxouCoin à la main. Le plafond, lui, est le solde et c'est le
  // débit atomique qui le fait respecter.
  if (!isValidStake("motus", stake)) {
    fail("MOTUS_STAKE_INVALID", MOTUS_ERROR_LABELS.MOTUS_STAKE_INVALID, 400);
  }
  addWatcher(userId, socketId);
  const before = await state(userId, now);
  reserveSession(userId, before.status === "playing" ? before.slotStart : currentMotusSlot(now).start.toISOString());

  let balance: number | null = null;
  try {
    const view = await db.transaction(async (tx) => {
      // Le verrou du portefeuille sérialise deux démarrages du même compte,
      // y compris de part et d'autre d'une frontière de créneau.
      await tx.execute(sql`select ${wallets.userId} from ${wallets} where ${wallets.userId} = ${userId} for update`);

      const [unfinished] = await tx
        .select()
        .from(motusAttempts)
        .where(and(eq(motusAttempts.userId, userId), isNull(motusAttempts.finishedAt)))
        .limit(1);
      if (unfinished) {
        return attemptView(tx, userId, unfinished, await slotOf(tx, unfinished.slotStart), now);
      }

      const slot = await ensureSlot(tx, now);
      const [inserted] = await tx
        .insert(motusAttempts)
        // `startedAt` est posé explicitement et non laissé au `now()` de la base :
        // le chrono doit suivre la même horloge que le reste du service, celle
        // que les tests injectent.
        .values({ userId, slotStart: slot.slotStart, stake, startedAt: now })
        .onConflictDoNothing()
        .returning();

      if (!inserted) {
        const [existing] = await tx
          .select()
          .from(motusAttempts)
          .where(and(eq(motusAttempts.userId, userId), eq(motusAttempts.slotStart, slot.slotStart)))
          .limit(1);
        if (!existing) fail("MOTUS_UNAVAILABLE", MOTUS_ERROR_LABELS.MOTUS_UNAVAILABLE, 503);
        return attemptView(tx, userId, existing, slot, now);
      }

      balance = await debitInTx(tx, userId, stake, "motus_stake");
      return attemptView(tx, userId, inserted, slot, now);
    });

    if (balance !== null) notifyWallet(userId, balance);
    synchronizeAttachedReservation(userId, view);
    notifier.state(userId, view);
    return view;
  } catch (error) {
    releaseSession(userId);
    throw error;
  }
}

export async function guess(
  userId: string,
  socketId: string,
  input: MotusGuessInput,
  now = new Date(),
): Promise<MotusView> {
  const current = await watch(userId, socketId, now);
  if (current.status !== "playing") {
    fail("MOTUS_NOT_STARTED", MOTUS_ERROR_LABELS.MOTUS_NOT_STARTED);
  }

  let normalized: string;
  try {
    normalized = normalizeMotusWord(input.guess);
  } catch {
    fail("MOTUS_UNKNOWN_WORD", MOTUS_ERROR_LABELS.MOTUS_UNKNOWN_WORD, 400);
  }
  if (normalized.length !== current.length) {
    fail("MOTUS_INVALID_LENGTH", MOTUS_ERROR_LABELS.MOTUS_INVALID_LENGTH, 400);
  }

  let balance: number | null = null;
  let receipt: RoundReceipt | null = null;
  const view = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select 1 from ${motusAttempts} where ${motusAttempts.userId} = ${userId} and ${motusAttempts.finishedAt} is null for update`,
    );
    const [attempt] = await tx
      .select()
      .from(motusAttempts)
      .where(and(eq(motusAttempts.userId, userId), isNull(motusAttempts.finishedAt)))
      .limit(1);
    if (!attempt) fail("MOTUS_NOT_STARTED", MOTUS_ERROR_LABELS.MOTUS_NOT_STARTED);
    if (attempt.version !== input.version) {
      fail("STALE_STATE", "La partie a avancé entre-temps. Regarde la grille.");
    }

    const slot = await slotOf(tx, attempt.slotStart);
    const [known] = await tx
      .select({ word: motusWords.word })
      .from(motusWords)
      .where(and(eq(motusWords.word, normalized), eq(motusWords.active, true)))
      .limit(1);
    if (!known) fail("MOTUS_UNKNOWN_WORD", MOTUS_ERROR_LABELS.MOTUS_UNKNOWN_WORD, 400);

    const evaluation = evaluateMotusGuess(slot.word, normalized);
    const guesses = [...storedGuesses(attempt.guesses), normalized];
    const finished = evaluation.solved || guesses.length >= MOTUS_MAX_ATTEMPTS;
    const reward = motusReward(guesses.length, evaluation.solved, attempt.stake);
    if (reward > 0) balance = await creditInTx(tx, userId, reward, "motus_reward");

    const [updated] = await tx
      .update(motusAttempts)
      .set({
        guesses,
        solved: evaluation.solved,
        reward,
        version: attempt.version + 1,
        finishedAt: finished ? now : null,
        updatedAt: now,
      })
      .where(and(eq(motusAttempts.userId, userId), eq(motusAttempts.slotStart, attempt.slotStart)))
      .returning();
    if (!updated) fail("MOTUS_UNAVAILABLE", MOTUS_ERROR_LABELS.MOTUS_UNAVAILABLE, 503);

    if (finished) {
      receipt = await recordRoundInTx(tx, {
        userId,
        game: "motus",
        wagered: attempt.stake,
        returned: reward,
        outcome: evaluation.solved ? "win" : "loss",
        attempts: guesses.length,
        // Le chrono court du premier engagement à la proposition décisive. Une
        // tentative reprise après une déconnexion garde donc le temps écoulé
        // entre les deux : c'est la seule mesure honnête d'une grille laissée
        // ouverte, et elle ne pénalise que celui qui l'abandonne en route.
        durationMs: now.getTime() - attempt.startedAt.getTime(),
        flags: evaluation.solved && guesses.length === 1 ? ["motus_first_guess"] : [],
        at: now,
      });
    }

    return attemptView(tx, userId, updated, slot, now);
  });

  if (balance !== null) notifyWallet(userId, balance);
  publishRoundReceipt(receipt);
  synchronizeAttachedReservation(userId, view);
  notifier.state(userId, view);
  return view;
}

export async function abandon(userId: string, socketId: string, now = new Date()): Promise<MotusView> {
  const current = await watch(userId, socketId, now);
  if (current.status !== "playing") {
    fail("MOTUS_GAME_OVER", MOTUS_ERROR_LABELS.MOTUS_GAME_OVER);
  }

  let receipt: RoundReceipt | null = null;
  const view = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select 1 from ${motusAttempts} where ${motusAttempts.userId} = ${userId} and ${motusAttempts.finishedAt} is null for update`,
    );
    const [attempt] = await tx
      .select()
      .from(motusAttempts)
      .where(and(eq(motusAttempts.userId, userId), isNull(motusAttempts.finishedAt)))
      .limit(1);
    if (!attempt) fail("MOTUS_GAME_OVER", MOTUS_ERROR_LABELS.MOTUS_GAME_OVER);
    const [updated] = await tx
      .update(motusAttempts)
      .set({ finishedAt: now, version: attempt.version + 1, updatedAt: now })
      .where(and(eq(motusAttempts.userId, userId), eq(motusAttempts.slotStart, attempt.slotStart)))
      .returning();
    if (!updated) fail("MOTUS_UNAVAILABLE", MOTUS_ERROR_LABELS.MOTUS_UNAVAILABLE, 503);

    // Une grille abandonnée reste une manche jouée et une mise perdue. La taire
    // laisserait le rendement d'un joueur qui renonce souvent artificiellement
    // bon.
    receipt = await recordRoundInTx(tx, {
      userId,
      game: "motus",
      wagered: attempt.stake,
      returned: 0,
      outcome: "loss",
      durationMs: now.getTime() - attempt.startedAt.getTime(),
      at: now,
    });

    return attemptView(tx, userId, updated, await slotOf(tx, attempt.slotStart), now);
  });

  publishRoundReceipt(receipt);
  synchronizeAttachedReservation(userId, view);
  notifier.state(userId, view);
  return view;
}

export function activeCount(): number {
  return active.size;
}

/** Arrêt propre et aide de test : aucune réservation mémoire ne doit survivre. */
export function shutdown(): void {
  for (const [userId, id] of active) {
    releaseActivity(userId, { kind: "motus", id });
  }
  active.clear();
  watchers.clear();
  notifier = NO_NOTIFIER;
}
