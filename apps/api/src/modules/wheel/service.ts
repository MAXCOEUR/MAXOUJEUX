import { randomInt } from "node:crypto";
import {
  WHEEL_ERROR_LABELS,
  WHEEL_SEGMENTS,
  WHEEL_SPIN_MS,
  isValidStake,
  nextWheelSpinAt,
  wheelPayout,
  type WheelHistoryEntry,
  type WheelPlayer,
  type WheelSpinResult,
  type WheelSpinning,
  type WheelView,
} from "@maxoujeux/shared";
import { spinWheel } from "@maxoujeux/engines";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { wallets, wheelSpins } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { notifyWallet } from "../../realtime/notify.js";
import { creditInTx, debitInTx } from "../wallet/service.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Spin = typeof wheelSpins.$inferSelect;

/**
 * La salle de la roue.
 *
 * Il n'y a **qu'une seule roue sur tout le site**, et donc aucune table à
 * créer : on entre dans la salle, on regarde tourner, et on lance à son tour si
 * on ne l'a pas déjà fait dans les 24 h. C'est la seule pièce du casino où le
 * spectacle est partagé sans que personne n'ait à s'asseoir.
 *
 * Deux états seulement : la roue est libre, ou elle tourne. Le résultat est
 * tiré **au départ** et voyage avec l'animation — deux spectateurs arrivés à
 * une seconde d'écart voient donc la même roue s'arrêter au même endroit.
 *
 * La salle n'occupe pas le verrou d'activité : regarder une roue tourner
 * pendant qu'on attend son tour ailleurs n'a rien d'incompatible, et il serait
 * absurde d'interdire un lancer quotidien de six secondes à qui est assis à une
 * table de blackjack.
 */

export interface WheelNotifier {
  /** L'état de la salle a changé : à diffuser à tous ses occupants. */
  room(): void;
}

const NO_NOTIFIER: WheelNotifier = { room: () => {} };
let notifier: WheelNotifier = NO_NOTIFIER;

export function setWheelNotifier(next: WheelNotifier): void {
  notifier = next;
}

/** Occupants de la salle, et leurs sockets — un joueur peut avoir deux onglets. */
const audience = new Map<string, { player: WheelPlayer; sockets: Set<string> }>();

/** Lancer en cours, doublé de la minuterie qui libérera la roue. */
type ActiveSpin = WheelSpinning & { timer: NodeJS.Timeout | null };

/** Une seule roue sur le site, donc au plus un lancer à la fois. */
let spinning: ActiveSpin | null = null;

/** Les derniers lancers de la salle. Volontairement court : c'est une frise, pas un journal. */
const history: WheelHistoryEntry[] = [];
const HISTORY_MAX = 12;

let randomIndex: (maximumExclusive: number) => number = (maximum) => randomInt(maximum);

/**
 * Durée effective d'un lancer.
 *
 * La valeur de production vient du contrat partagé ; les tests la raccourcissent
 * à quelques millisecondes. Truquer l'horloge globale serait plus fragile :
 * PGlite s'appuie lui aussi sur des minuteries.
 */
let spinMs = WHEEL_SPIN_MS;

/** Aléa imposé par les tests, sans détourner le hasard du processus. */
export function setWheelRandomForTests(next: typeof randomIndex): void {
  randomIndex = next;
}

/** Raccourcit l'animation. Réservé aux tests. */
export function setWheelSpinMsForTests(next: number): void {
  spinMs = next;
}

function fail(code: keyof typeof WHEEL_ERROR_LABELS, status = 409): never {
  throw new AppError(status, code, WHEEL_ERROR_LABELS[code]);
}

function toResult(spin: Spin): WheelSpinResult {
  return {
    index: spin.segment,
    multiplierTenths: spin.multiplierTenths,
    stake: spin.stake,
    payout: spin.payout,
    spunAt: spin.spunAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Présence dans la salle
// ---------------------------------------------------------------------------

/** Entrer dans la salle. Idempotent : deux onglets ne font pas deux spectateurs. */
export function enterWheelRoom(player: WheelPlayer, socketId: string): void {
  const entry = audience.get(player.userId);
  if (entry) {
    entry.player = player;
    entry.sockets.add(socketId);
    return;
  }
  audience.set(player.userId, { player, sockets: new Set([socketId]) });
  notifier.room();
}

/** Quitter la salle. Le joueur n'en sort qu'à la fermeture de son dernier onglet. */
export function leaveWheelRoom(userId: string, socketId: string): void {
  const entry = audience.get(userId);
  if (!entry) return;
  entry.sockets.delete(socketId);
  if (entry.sockets.size > 0) return;
  audience.delete(userId);
  notifier.room();
}

/** Un changement de pseudo ou d'avatar doit se voir sans quitter la salle. */
export function updateWheelIdentity(userId: string, patch: Partial<WheelPlayer>): void {
  const entry = audience.get(userId);
  if (!entry) return;
  entry.player = { ...entry.player, ...patch };
  notifier.room();
}

/** Comptes à qui diffuser l'état de la salle. */
export function wheelAudienceOf(): string[] {
  return [...audience.keys()];
}

export function isInWheelRoom(userId: string): boolean {
  return audience.has(userId);
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

async function lastSpinOf(tx: Transaction, userId: string): Promise<Spin | null> {
  const [spin] = await tx
    .select()
    .from(wheelSpins)
    .where(eq(wheelSpins.userId, userId))
    .orderBy(desc(wheelSpins.spunAt))
    .limit(1);
  return spin ?? null;
}

/**
 * L'état de la salle, vu par un joueur donné.
 *
 * La partie publique — occupants, roue en cours, historique — est la même pour
 * tous ; seuls le délai de 24 h et le dernier lancer sont personnels.
 */
export async function wheelState(userId: string, now = new Date()): Promise<WheelView> {
  const spin = await db.transaction((tx) => lastSpinOf(tx, userId));
  const next = nextWheelSpinAt(spin?.spunAt ?? null, now);

  return {
    audience: [...audience.values()].map((entry) => entry.player),
    spinning: spinning ? { by: spinning.by, result: spinning.result, endsAt: spinning.endsAt } : null,
    // Trois conditions : le délai est passé, la roue est libre, et le joueur
    // est bien dans la salle.
    canSpin: next === null && spinning === null && audience.has(userId),
    nextSpinAt: next?.toISOString() ?? null,
    lastSpin: spin ? toResult(spin) : null,
    history: [...history],
    now: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Lancer
// ---------------------------------------------------------------------------

export async function spin(userId: string, stake: number, now = new Date()): Promise<void> {
  // Rejoué côté serveur : le front propose des paliers, rien n'empêche d'envoyer
  // 37 MaxouCoin à la main. Le plafond de mise compte double ici — c'est lui qui
  // borne ce qu'un ×20 peut injecter dans l'économie.
  if (!isValidStake("wheel", stake)) fail("WHEEL_STAKE_INVALID", 400);

  const entry = audience.get(userId);
  if (!entry) fail("WHEEL_NOT_HERE", 403);

  // Contrôle **synchrone** de l'occupation, avant tout `await` : deux joueurs
  // qui cliquent en même temps ne doivent pas lancer la même roue.
  if (spinning) fail("WHEEL_BUSY");
  const reservation: ActiveSpin = {
    by: entry.player,
    // Réservation provisoire, remplacée dès que le tirage est fait. Elle
    // n'existe que pour fermer la porte pendant la transaction.
    result: { index: 0, multiplierTenths: 0, stake, payout: 0, spunAt: now.toISOString() },
    endsAt: new Date(now.getTime() + spinMs).toISOString(),
    timer: null,
  };
  spinning = reservation;

  let balance: number | null = null;
  try {
    const result = await db.transaction(async (tx) => {
      // Le verrou du porte-monnaie sérialise deux lancers du même compte : sans
      // lui, un double-clic passerait deux fois le contrôle des 24 h avant que
      // la première ligne ne soit visible.
      await tx.execute(
        sql`select ${wallets.userId} from ${wallets} where ${wallets.userId} = ${userId} for update`,
      );

      const previous = await lastSpinOf(tx, userId);
      if (nextWheelSpinAt(previous?.spunAt ?? null, now)) fail("WHEEL_COOLDOWN");

      balance = await debitInTx(tx, userId, stake, "wheel_stake");

      const index = spinWheel(randomIndex);
      const segment = WHEEL_SEGMENTS[index];
      if (!segment) throw new Error(`Secteur de roue inconnu : ${index}`);
      const payout = wheelPayout(stake, segment.multiplierTenths);

      const [inserted] = await tx
        .insert(wheelSpins)
        .values({
          userId,
          stake,
          segment: index,
          multiplierTenths: segment.multiplierTenths,
          payout,
          spunAt: now,
        })
        .returning();
      if (!inserted) throw new Error("Lancer de roue non enregistré");

      // Le versement est écrit dans la même transaction que le débit et la
      // ligne d'historique : un incident entre les deux ne peut pas laisser une
      // mise encaissée sans gain.
      if (payout > 0) balance = await creditInTx(tx, userId, payout, "wheel_reward");

      return toResult(inserted);
    });

    reservation.result = result;
    history.unshift({ ...result, by: entry.player });
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;

    // La roue se libère toute seule à la fin de l'animation : personne n'a à
    // envoyer un « c'est fini » que le client pourrait ne jamais émettre.
    reservation.timer = setTimeout(() => {
      if (spinning === reservation) {
        spinning = null;
        notifier.room();
      }
    }, spinMs);
    reservation.timer.unref?.();

    notifier.room();
  } catch (error) {
    // Lancer refusé : la roue doit redevenir disponible immédiatement, sinon
    // une mise invalide la bloquerait six secondes pour toute la salle.
    if (spinning === reservation) {
      if (reservation.timer) clearTimeout(reservation.timer);
      spinning = null;
      notifier.room();
    }
    throw error;
  }

  // Après le commit seulement : notifier un solde qui pourrait encore être
  // annulé ferait clignoter un montant faux.
  if (balance !== null) notifyWallet(userId, balance);
}

/** Arrêt propre : aucune minuterie ne doit survivre au processus. */
export function shutdownWheel(): void {
  if (spinning?.timer) clearTimeout(spinning.timer);
  spinning = null;
  audience.clear();
  history.length = 0;
  notifier = NO_NOTIFIER;
}

/** Remise à zéro entre deux tests. */
export function resetWheelForTests(): void {
  shutdownWheel();
  randomIndex = (maximum) => randomInt(maximum);
  spinMs = WHEEL_SPIN_MS;
}
