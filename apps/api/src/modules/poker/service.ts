import { randomInt, randomUUID } from "node:crypto";
import {
  POKER_ACTION_MS,
  POKER_MISSED_HANDS_MAX,
  POKER_DISCONNECT_GRACE_MS,
  POKER_ERROR_LABELS,
  POKER_HAND_BREAK_MS,
  POKER_START_DELAY_MS,
  POKER_STREET_PAUSE_MS,
  pokerTableConfigSchema,
  pokerHandLabel,
  type PokerActionKind,
  type PokerCard,
  type PokerPhase,
  type PokerSeatView,
  type PokerTableConfig,
  type PokerTimerKind,
  type PokerView,
  type RoundFlag,
  type TableCounts,
  type TableSummary,
} from "@maxoujeux/shared";
import {
  applyPokerAction,
  autoPokerAction,
  createPokerHandDeck,
  legalPokerActions,
  nextButton,
  pokerBlindPositions,
  pokerPotTotal,
  startPokerHand,
  type PokerHandState,
} from "@maxoujeux/engines";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { matchPlayers, matches } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { notifyWallet } from "../../realtime/notify.js";
import { connectionCount } from "../../realtime/presence.js";
import { releaseActivity, reserveActivity } from "../games/activity.js";
import { recoverOpenRounds } from "../tables/recovery.js";
import {
  casinoOutcome,
  publishRoundReceipt,
  recordRoundInTx,
  type RoundReceipt,
} from "../stats/service.js";
import { creditInTx, debitInTx } from "../wallet/service.js";

/**
 * Texas Hold'em — une seule table sur le site.
 *
 * **Le modèle économique diffère de tous les autres jeux.** Au blackjack, chaque
 * mise débite le porte-monnaie et chaque gain le crédite. Ici, les jetons
 * circulent entre joueurs : on ne gagne pas contre la maison. Donc :
 *
 * - se caver **débite** le porte-monnaie et crée un tapis (`poker_buyin`) ;
 * - les mains se jouent **entièrement en jetons**, en mémoire, sans toucher au
 *   porte-monnaie ;
 * - se lever **crédite** le porte-monnaie du tapis restant (`poker_cashout`).
 *
 * Une seule ligne `matches` par **session de table**, pas par main. Conséquence
 * heureuse : `recoverOpenRounds` rembourse la somme nette investie par chacun,
 * et comme la somme des caves moins les sorties égale exactement la somme des
 * tapis en jeu, une reprise après redémarrage est **neutre pour l'économie**.
 * Contrepartie assumée : après un arrêt brutal, chacun récupère sa cave nette,
 * pas son tapis du moment. C'est l'annulation de la table, pas un règlement.
 */

export interface PlayerIdentity {
  userId: string;
  pseudo: string;
  avatarSeed: string;
}

interface Occupant extends PlayerIdentity {
  seat: number;
  sockets: number;
  graceTimer: NodeJS.Timeout | null;
  stack: number;
  /** Cumul des caves et des sorties : donne le net écrit au départ. */
  buyInTotal: number;
  cashOutTotal: number;
  sittingOut: boolean;
  /** Assis pendant une main en cours : il entre à la suivante. */
  waitingForHand: boolean;
  inHand: boolean;
  leaveAfterHand: boolean;
  standAfterHand: boolean;
  /** Mains consécutives manquées sans payer de blinde. */
  missedHands: number;
  lastAction: { kind: PokerActionKind; amount: number } | null;
  wonThisHand: number | null;
  /** A montré son jeu de lui-même après s'être couché. Remis à zéro chaque main. */
  revealed: boolean;
  /**
   * Coups d'éclat abattus depuis la cave, en attente de la sortie de table.
   *
   * La manche statistique du poker est la **session**, pas la main : un carré
   * abattu au troisième coup ne peut donc pas être enregistré au moment où il
   * tombe. Il attend ici que le joueur se lève.
   */
  achievementFlags: Set<RoundFlag>;
}

interface Watcher extends PlayerIdentity {
  sockets: number;
  graceTimer: NodeJS.Timeout | null;
  followedUserId: string | null;
}

interface PokerTable {
  id: string;
  sessionMatchId: string;
  hostId: string;
  config: PokerTableConfig;
  pendingConfig: PokerTableConfig | null;
  seats: (Occupant | null)[];
  watchers: Map<string, Watcher>;
  phase: PokerPhase;
  hand: PokerHandState | null;
  button: number;
  deadline: number | null;
  timer: NodeJS.Timeout | null;
  timerKind: PokerTimerKind | null;
  timerMs: number | null;
  timerGeneration: number;
  version: number;
  createdAt: number;
  queue: Promise<void>;
}

export interface PokerNotifier {
  table(tableId: string): void;
  salon(): void;
  counts(): void;
}

const NO_NOTIFIER: PokerNotifier = { table: () => {}, salon: () => {}, counts: () => {} };
let notifier: PokerNotifier = NO_NOTIFIER;

const tables = new Map<string, PokerTable>();
const tableByUser = new Map<string, string>();

let randomIndex: (maximumExclusive: number) => number = (maximum) => randomInt(maximum);
const durations = {
  action: POKER_ACTION_MS,
  startDelay: POKER_START_DELAY_MS,
  streetPause: POKER_STREET_PAUSE_MS,
  handBreak: POKER_HAND_BREAK_MS,
};

export function setPokerNotifier(next: PokerNotifier): void {
  notifier = next;
}

/** Aléa imposé par les tests, sans détourner le hasard du processus. */
export function setPokerRandomForTests(next: typeof randomIndex): void {
  randomIndex = next;
}

/** Raccourcit les phases. Réservé aux tests. */
export function setPokerDurationsForTests(next: Partial<typeof durations>): void {
  Object.assign(durations, next);
}

function fail(code: keyof typeof POKER_ERROR_LABELS | string, message?: string, status = 409): never {
  const libelle =
    message ?? POKER_ERROR_LABELS[code as keyof typeof POKER_ERROR_LABELS] ?? "Action impossible.";
  throw new AppError(status, code, libelle);
}

function publish(table: PokerTable): void {
  notifier.table(table.id);
  notifier.salon();
  notifier.counts();
}

function occupants(table: PokerTable): Occupant[] {
  return table.seats.filter((seat): seat is Occupant => seat !== null);
}

function audience(table: PokerTable): string[] {
  return [...occupants(table).map((seat) => seat.userId), ...table.watchers.keys()];
}

function enqueue<T>(table: PokerTable, work: () => Promise<T>): Promise<T> {
  const result = table.queue.then(work, work);
  table.queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Minuteries
// ---------------------------------------------------------------------------

function clearTimer(table: PokerTable): void {
  if (table.timer) clearTimeout(table.timer);
  table.timer = null;
  table.deadline = null;
  table.timerKind = null;
  table.timerMs = null;
  // Toute annulation invalide les rappels déjà en file : un `clearTimeout`
  // n'empêche pas un `setTimeout` arrivé à échéance de s'exécuter.
  table.timerGeneration += 1;
}

function schedule(
  table: PokerTable,
  kind: PokerTimerKind,
  duration: number,
  work: () => Promise<void> | void,
): void {
  clearTimer(table);
  table.deadline = Date.now() + duration;
  table.timerKind = kind;
  table.timerMs = duration;
  const generation = table.timerGeneration;
  table.timer = setTimeout(() => {
    if (table.timerGeneration !== generation) return;
    void enqueue(table, async () => {
      if (table.timerGeneration !== generation) return;
      await work();
    }).catch(() => {
      // Un rappel qui échoue ne doit pas emporter le processus : la table
      // reprend au prochain geste d'un joueur.
    });
  }, duration);
  table.timer.unref?.();
}

// ---------------------------------------------------------------------------
// Cycle de vie de la table
// ---------------------------------------------------------------------------

export async function createPokerTable(
  player: PlayerIdentity,
  config: PokerTableConfig,
): Promise<string> {
  // --- Réservation synchrone : aucun `await` jusqu'à la fin du bloc. ---
  if (tables.size >= 1) fail("CAPACITY_REACHED", "Une table de poker est déjà ouverte. Rejoins-la.");
  if (tableByUser.has(player.userId)) fail("ALREADY_IN_GAME", "Tu es déjà à une table.");

  const id = randomUUID();
  const sessionMatchId = randomUUID();
  if (!reserveActivity(player.userId, { kind: "table", id })) {
    fail("ALREADY_IN_GAME", "Tu joues déjà à un autre jeu.");
  }

  const table: PokerTable = {
    id,
    sessionMatchId,
    hostId: player.userId,
    config,
    pendingConfig: null,
    seats: Array.from({ length: config.seats }, () => null),
    watchers: new Map(),
    phase: "waiting",
    hand: null,
    button: 0,
    deadline: null,
    timer: null,
    timerKind: null,
    timerMs: null,
    timerGeneration: 0,
    version: 1,
    createdAt: Date.now(),
    queue: Promise.resolve(),
  };
  table.seats[0] = freshOccupant(player, 0);
  tables.set(id, table);
  tableByUser.set(player.userId, id);

  try {
    const balance = await db.transaction(async (tx) => {
      await tx.insert(matches).values({
        id: sessionMatchId,
        game: "poker",
        status: "playing",
        config: { tableId: id, ruleset: "holdem-v1", ...config },
        startedAt: new Date(),
      });
      await tx.insert(matchPlayers).values({ matchId: sessionMatchId, userId: player.userId, seat: 0 });
      return debitInTx(tx, player.userId, config.minBuyIn, "poker_buyin", sessionMatchId);
    });

    const hote = table.seats[0];
    if (hote) {
      hote.stack = config.minBuyIn;
      hote.buyInTotal = config.minBuyIn;
      hote.waitingForHand = false;
    }
    notifyWallet(player.userId, balance);
  } catch (error) {
    // La réservation mémoire ne doit pas survivre à un débit refusé.
    tables.delete(id);
    tableByUser.delete(player.userId);
    releaseActivity(player.userId, { kind: "table", id });
    throw error;
  }

  publish(table);
  return id;
}

function freshOccupant(player: PlayerIdentity, seat: number): Occupant {
  return {
    ...player,
    seat,
    sockets: Math.max(1, connectionCount(player.userId)),
    graceTimer: null,
    stack: 0,
    buyInTotal: 0,
    cashOutTotal: 0,
    sittingOut: false,
    waitingForHand: true,
    inHand: false,
    leaveAfterHand: false,
    standAfterHand: false,
    missedHands: 0,
    lastAction: null,
    wonThisHand: null,
    revealed: false,
    achievementFlags: new Set(),
  };
}

/**
 * Entrer à la table, c'est **regarder**.
 *
 * La place se prend ensuite, siège par siège. Regarder ne consomme aucun verrou
 * d'activité : on peut suivre une table en ayant sa partie ailleurs.
 */
export function watchPokerTable(player: PlayerIdentity, tableId: string): Promise<string> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);

  if (tableByUser.get(player.userId) === tableId) return Promise.resolve(tableId);
  if (tableByUser.has(player.userId)) fail("ALREADY_IN_GAME", "Tu es déjà à une table.");
  table.watchers.set(player.userId, {
    ...player,
    sockets: Math.max(1, connectionCount(player.userId)),
    graceTimer: null,
    followedUserId: null,
  });
  tableByUser.set(player.userId, tableId);
  table.version += 1;
  publish(table);
  return Promise.resolve(tableId);
}

/**
 * Prendre une place et se caver.
 *
 * Le siège est réservé **avant** le premier `await` : sinon deux demandes
 * simultanées sur la même chaise franchiraient toutes deux le contrôle pendant
 * l'attente de la base.
 */
export async function sitPoker(
  player: PlayerIdentity,
  tableId: string,
  seat: number,
  buyIn: number,
): Promise<void> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  if (occupants(table).some((occupant) => occupant.userId === player.userId)) {
    fail("POKER_ALREADY_SEATED");
  }
  if (seat < 0 || seat >= table.seats.length) fail("POKER_SEAT_TAKEN", undefined, 400);
  if (table.seats[seat] !== null) fail("POKER_SEAT_TAKEN");

  const { minBuyIn, maxBuyIn } = table.config;
  if (buyIn < minBuyIn || (maxBuyIn !== null && buyIn > maxBuyIn)) fail("POKER_BUYIN_INVALID", undefined, 400);
  if (!reserveActivity(player.userId, { kind: "table", id: tableId })) {
    fail("ALREADY_IN_GAME", "Tu joues déjà à un autre jeu.");
  }

  const watcher = table.watchers.get(player.userId);
  table.watchers.delete(player.userId);
  const occupant = freshOccupant(player, seat);
  if (watcher) occupant.sockets = watcher.sockets;
  table.seats[seat] = occupant;
  tableByUser.set(player.userId, tableId);

  await enqueue(table, async () => {
    try {
      const balance = await db.transaction(async (tx) => {
        await tx
          .insert(matchPlayers)
          .values({ matchId: table.sessionMatchId, userId: player.userId, seat })
          .onConflictDoNothing();
        return debitInTx(tx, player.userId, buyIn, "poker_buyin", table.sessionMatchId);
      });
      occupant.stack = buyIn;
      occupant.buyInTotal = buyIn;
      notifyWallet(player.userId, balance);
    } catch (error) {
      if (table.seats[seat] === occupant) table.seats[seat] = null;
      releaseActivity(player.userId, { kind: "table", id: tableId });
      if (watcher) {
        table.watchers.set(player.userId, watcher);
      } else {
        tableByUser.delete(player.userId);
      }
      throw error;
    }

    table.version += 1;
    publish(table);
    void maybeStartHand(table);
  });
}

/** Se recaver, entre deux mains seulement. */
export async function rebuyPoker(userId: string, tableId: string, amount: number): Promise<void> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  await enqueue(table, async () => {
    const occupant = occupants(table).find((seat) => seat.userId === userId);
    if (!occupant) fail("POKER_NOT_SEATED", undefined, 403);
    const entreLesMains = !table.hand || table.phase === "payout";
    if (!entreLesMains) fail("POKER_REBUY_CLOSED");

    const { maxBuyIn, minBuyIn } = table.config;
    if (amount <= 0) fail("POKER_BUYIN_INVALID", undefined, 400);
    if (maxBuyIn !== null && occupant.stack + amount > maxBuyIn) {
      fail("POKER_BUYIN_INVALID", undefined, 400);
    }
    if (occupant.stack + amount < minBuyIn) fail("POKER_BUYIN_INVALID", undefined, 400);

    const balance = await db.transaction((tx) =>
      debitInTx(tx, userId, amount, "poker_buyin", table.sessionMatchId),
    );
    occupant.stack += amount;
    occupant.buyInTotal += amount;
    occupant.missedHands = 0;
    occupant.sittingOut = false;
    notifyWallet(userId, balance);

    table.version += 1;
    publish(table);
    maybeStartHand(table);
  });
}

/** Rendre sa place et récupérer ses jetons. Reste spectateur. */
export async function standPoker(userId: string, tableId: string): Promise<void> {
  const table = tables.get(tableId);
  if (!table) return;
  await enqueue(table, async () => {
    const occupant = occupants(table).find((seat) => seat.userId === userId);
    if (!occupant) return;

    if (occupant.inHand && table.hand) {
      occupant.standAfterHand = true;
      table.version += 1;
      publish(table);
      return;
    }
    await cashOut(table, occupant, true);
  });
}

export async function leavePoker(userId: string, tableId: string): Promise<void> {
  const table = tables.get(tableId);
  if (!table) return;
  await enqueue(table, async () => {
    const occupant = occupants(table).find((seat) => seat.userId === userId);
    if (!occupant) {
      if (table.watchers.delete(userId)) {
        tableByUser.delete(userId);
        table.version += 1;
        disposeIfDeserted(table);
        publish(table);
      }
      return;
    }

    if (occupant.inHand && table.hand) {
      occupant.leaveAfterHand = true;
      table.version += 1;
      publish(table);
      return;
    }
    await cashOut(table, occupant, false);
  });
}

/**
 * Sortie de table : les jetons repartent au porte-monnaie.
 *
 * C'est le **seul** endroit qui crédite un joueur de poker, et il écrit du même
 * mouvement le résultat de la session dans `match_players` et les cumuls.
 *
 * C'est aussi la borne de la manche statistique du poker : elle court de la
 * première cave à la sortie de table, rebuys compris. Compter main par main
 * n'aurait aucun sens ici — les jetons ne passent pas par le porte-monnaie entre
 * les deux, et une session est ce que le joueur vit comme une partie.
 */
async function cashOut(table: PokerTable, occupant: Occupant, keepWatching: boolean): Promise<void> {
  if (table.seats[occupant.seat] !== occupant) return;
  const montant = occupant.stack;
  const cashOutPrecedent = occupant.cashOutTotal;
  occupant.stack = 0;
  occupant.cashOutTotal += montant;
  const delta = occupant.cashOutTotal - occupant.buyInTotal;
  let receipt: RoundReceipt | null = null;

  try {
    const balance = await db.transaction(async (tx) => {
      await tx
        .update(matchPlayers)
        .set({ result: delta > 0 ? "win" : delta < 0 ? "loss" : "draw", chipsDelta: delta })
        .where(
          and(
            eq(matchPlayers.matchId, table.sessionMatchId),
            eq(matchPlayers.userId, occupant.userId),
          ),
        );
      const balance =
        montant > 0
          ? await creditInTx(tx, occupant.userId, montant, "poker_cashout", table.sessionMatchId)
          : null;

      // Après le versement : le solde lu par les succès de fortune doit être
      // celui que le joueur a effectivement en poche en quittant la table.
      receipt = await recordRoundInTx(tx, {
        userId: occupant.userId,
        game: "poker",
        wagered: occupant.buyInTotal,
        returned: occupant.cashOutTotal,
        outcome: casinoOutcome(occupant.buyInTotal, occupant.cashOutTotal),
        flags: [...occupant.achievementFlags],
        at: new Date(),
      });

      return balance;
    });
    if (balance !== null) notifyWallet(occupant.userId, balance);
    publishRoundReceipt(receipt);
  } catch (error) {
    occupant.stack = montant;
    occupant.cashOutTotal = cashOutPrecedent;
    throw error;
  }

  vacateSeat(table, occupant, keepWatching);
}

function vacateSeat(table: PokerTable, occupant: Occupant, keepWatching: boolean): void {
  if (table.seats[occupant.seat] !== occupant) return;
  if (occupant.graceTimer) clearTimeout(occupant.graceTimer);
  table.seats[occupant.seat] = null;
  for (const watcher of table.watchers.values()) {
    if (watcher.followedUserId === occupant.userId) watcher.followedUserId = null;
  }
  releaseActivity(occupant.userId, { kind: "table", id: table.id });

  if (keepWatching) {
    table.watchers.set(occupant.userId, {
      userId: occupant.userId,
      pseudo: occupant.pseudo,
      avatarSeed: occupant.avatarSeed,
      sockets: occupant.sockets,
      graceTimer: null,
      followedUserId: null,
    });
  } else {
    tableByUser.delete(occupant.userId);
  }

  table.version += 1;
  disposeIfDeserted(table);
  publish(table);
}

/** Ferme la table quand il n'y a plus personne, spectateurs compris. */
function disposeIfDeserted(table: PokerTable): void {
  if (occupants(table).length > 0 || table.watchers.size > 0) return;
  clearTimer(table);
  tables.delete(table.id);
  void db
    .update(matches)
    .set({ status: "finished", endedAt: new Date() })
    .where(eq(matches.id, table.sessionMatchId))
    .catch(() => {
      // La session est close côté mémoire ; une écriture ratée sera reprise par
      // `recoverPokerRounds` au prochain démarrage.
    });
}

/** Les blindes du créateur, appliquées à la main suivante. */
export function setPokerBlinds(userId: string, tableId: string, smallBlind: number, bigBlind: number): void {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  if (table.hostId !== userId) fail("POKER_NOT_HOST", undefined, 403);
  const validation = pokerTableConfigSchema.safeParse({ ...table.config, smallBlind, bigBlind });
  if (!validation.success) {
    fail("POKER_ACTION_INVALID", validation.error.issues[0]?.message, 400);
  }

  const suivant = validation.data;
  if (table.hand) {
    // Jamais au milieu d'un coup : le changement attend la main suivante.
    table.pendingConfig = suivant;
  } else {
    table.config = suivant;
    table.pendingConfig = null;
  }
  table.version += 1;
  publish(table);
}

/**
 * Montrer son jeu après s'être couché.
 *
 * Uniquement une fois couché, et tant que la main court : montrer un jeu qu'on
 * défend encore reviendrait à donner sa lecture à l'adversaire pendant les
 * enchères. Le geste est sans retour — on ne remet pas des cartes face cachée.
 */
export function revealPoker(userId: string, tableId: string): void {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  const occupant = occupants(table).find((seat) => seat.userId === userId);
  if (!occupant) fail("POKER_NOT_SEATED", undefined, 403);
  if (!canRevealNow(table, occupant)) fail("POKER_REVEAL_CLOSED");

  occupant.revealed = true;
  table.version += 1;
  publish(table);
}

/** Le joueur est-il couché sur une main qui court encore ? */
function canRevealNow(table: PokerTable, occupant: Occupant): boolean {
  if (occupant.revealed) return false;
  const siege = table.hand?.seats[occupant.seat];
  return Boolean(table.hand) && occupant.inHand && siege?.status === "folded";
}

export function sitOutPoker(userId: string, tableId: string, out: boolean): void {
  const table = tables.get(tableId);
  if (!table) return;
  const occupant = occupants(table).find((seat) => seat.userId === userId);
  if (!occupant) return;
  occupant.sittingOut = out;
  table.version += 1;
  publish(table);
  if (!out) void maybeStartHand(table);
}

/** Mémorise le suivi côté serveur sans jamais ouvrir la main pendant le coup. */
export function followPoker(userId: string, tableId: string, followedUserId: string | null): void {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  const watcher = table.watchers.get(userId);
  if (!watcher) fail("POKER_NOT_SEATED", "Seul un spectateur peut suivre un joueur.", 403);
  if (
    followedUserId !== null &&
    !occupants(table).some((occupant) => occupant.userId === followedUserId)
  ) {
    fail("POKER_ACTION_INVALID", "Ce joueur n'est plus à la table.", 400);
  }
  watcher.followedUserId = followedUserId;
  table.version += 1;
  publish(table);
}

// ---------------------------------------------------------------------------
// Déroulé d'une main
// ---------------------------------------------------------------------------

/** Joueurs prêts à recevoir des cartes. */
function eligibles(table: PokerTable): Occupant[] {
  return occupants(table).filter(
    (seat) => !seat.sittingOut && seat.stack > 0 && !seat.leaveAfterHand && !seat.standAfterHand,
  );
}

function maybeStartHand(table: PokerTable): void {
  if (table.hand || !tables.has(table.id)) return;
  if (eligibles(table).length < 2) {
    table.phase = "waiting";
    clearTimer(table);
    table.version += 1;
    publish(table);
    return;
  }
  // L'arrivée du deuxième joueur doit être lisible par toute la table. En
  // production on annonce la donne ; les tests peuvent neutraliser ce délai.
  if (durations.startDelay <= 0) {
    startHand(table);
    return;
  }
  if (table.timerKind === "start") return;
  table.phase = "waiting";
  schedule(table, "start", durations.startDelay, () => {
    if (eligibles(table).length < 2) {
      maybeStartHand(table);
      return;
    }
    startHand(table);
  });
  table.version += 1;
  publish(table);
}

function startHand(table: PokerTable): void {
  if (table.pendingConfig) {
    table.config = table.pendingConfig;
    table.pendingConfig = null;
  }

  const joueurs = eligibles(table);
  for (const occupant of occupants(table)) {
    occupant.waitingForHand = !joueurs.includes(occupant);
    occupant.inHand = joueurs.includes(occupant);
    occupant.lastAction = null;
    occupant.wonThisHand = null;
    // Un jeu montré au coup précédent ne doit pas suivre le joueur au suivant.
    occupant.revealed = false;
  }

  table.button = nextButton(
    joueurs.map((seat) => seat.seat),
    table.button,
    table.seats.length,
  );

  table.hand = startPokerHand({
    players: joueurs.map((seat) => ({ seat: seat.seat, stack: seat.stack })),
    seatCount: table.seats.length,
    button: table.button,
    smallBlind: table.config.smallBlind,
    bigBlind: table.config.bigBlind,
    deck: createPokerHandDeck(randomIndex),
  });

  syncStacks(table);
  table.phase = phaseOf(table.hand);
  table.version += 1;
  armTurn(table);
  publish(table);
}

function phaseOf(hand: PokerHandState): PokerPhase {
  switch (hand.street) {
    case "preflop":
      return "preflop";
    case "flop":
      return "flop";
    case "turn":
      return "turn";
    case "river":
      return "river";
    case "showdown":
      return "showdown";
    default:
      return "payout";
  }
}

/**
 * Retient les mains d'exception abattues au tapis.
 *
 * Ne regarde que l'abattage : une quinte flush qui remporte le pot sans être
 * montrée n'a été vue de personne, et le moteur n'en garde pas trace.
 */
function collectHandFlags(table: PokerTable, hand: PokerHandState): void {
  for (const entree of hand.showdown) {
    const occupant = table.seats[entree.seat];
    if (!occupant) continue;
    if (entree.rank.category === "quinte-flush") occupant.achievementFlags.add("poker_straight_flush");
    if (entree.rank.category === "carre") occupant.achievementFlags.add("poker_quads");
  }
}

/** Recopie les tapis du moteur vers les sièges : le moteur fait autorité. */
function syncStacks(table: PokerTable): void {
  if (!table.hand) return;
  for (const siege of table.hand.seats) {
    if (!siege) continue;
    const occupant = table.seats[siege.seat];
    if (occupant) occupant.stack = siege.stack;
  }
}

function armTurn(table: PokerTable): void {
  const hand = table.hand;
  if (!hand || hand.turn === null) {
    clearTimer(table);
    return;
  }
  const siege = hand.turn;
  schedule(table, "action", durations.action, async () => {
    const courant = table.hand;
    if (!courant || courant.turn !== siege) return;
    await applyAndAdvance(table, siege, null);
  });
}

/**
 * Applique une action puis fait avancer la table.
 *
 * `action === null` signifie « le temps est écoulé » : on checke si c'est
 * gratuit, sinon on couche.
 */
async function applyAndAdvance(
  table: PokerTable,
  seat: number,
  action: { kind: PokerActionKind; amount?: number } | null,
): Promise<void> {
  const hand = table.hand;
  if (!hand) return;

  const avant = hand.street;
  const suivant = action ? applyPokerAction(hand, seat, action) : autoPokerAction(hand, seat);
  table.hand = suivant;

  const occupant = table.seats[seat];
  if (occupant) {
    const engage = suivant.seats[seat]?.committed ?? 0;
    occupant.lastAction = { kind: action?.kind ?? "fold", amount: engage };
    if (!action) {
      const legal = legalPokerActions(hand, seat);
      occupant.lastAction = {
        kind: legal.actions.includes("check") ? "check" : "fold",
        amount: engage,
      };
    }
  }

  syncStacks(table);
  table.phase = phaseOf(suivant);
  table.version += 1;

  if (suivant.street === "ended") {
    await finishHand(table);
    return;
  }

  // Une nouvelle rue mérite une respiration avant de relancer le compte à
  // rebours : sans elle, le tableau apparaît et le tour repart dans la même
  // image, sans qu'on ait vu les cartes.
  if (suivant.street !== avant) {
    schedule(table, "street", durations.streetPause, () => {
      armTurn(table);
      table.version += 1;
      publish(table);
    });
    publish(table);
    return;
  }

  armTurn(table);
  publish(table);
}

async function finishHand(table: PokerTable): Promise<void> {
  const hand = table.hand;
  if (!hand) return;

  syncStacks(table);
  for (const gain of hand.awards) {
    const occupant = table.seats[gain.seat];
    if (occupant) occupant.wonThisHand = gain.amount;
  }

  // Les coups d'éclat sont **mémorisés**, pas enregistrés : au poker, la manche
  // statistique est la session de table entière, pas la main. Ils repartiront
  // avec le joueur au moment où il se lève.
  collectHandFlags(table, hand);

  table.phase = "payout";
  clearTimer(table);
  table.version += 1;

  // Fenêtre de fin de coup : c'est là qu'on lit le résultat, qu'on se recave et
  // qu'on quitte la table.
  schedule(table, "hand-break", durations.handBreak, async () => {
    table.hand = null;
    for (const occupant of occupants(table)) {
      // Une main jouée implique qu'une blinde a pu lui revenir ; une main
      // manquée compte vers l'éviction, qu'il soit en pause ou sans jeton.
      occupant.missedHands = occupant.inHand ? 0 : occupant.missedHands + 1;
      occupant.inHand = false;
      if (occupant.stack === 0 && !occupant.sittingOut) {
        occupant.sittingOut = true;
      }
    }

    for (const occupant of occupants(table)) {
      if (occupant.leaveAfterHand) await cashOut(table, occupant, false);
      else if (occupant.standAfterHand) await cashOut(table, occupant, true);
      else if (occupant.missedHands >= POKER_MISSED_HANDS_MAX) {
        await cashOut(table, occupant, true);
      }
    }

    if (!tables.has(table.id)) return;
    maybeStartHand(table);
  });
  publish(table);
}

export async function actPoker(
  userId: string,
  tableId: string,
  version: number,
  action: { kind: PokerActionKind; amount?: number },
): Promise<void> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);

  await enqueue(table, async () => {
    const hand = table.hand;
    if (!hand) fail("POKER_ACTION_INVALID");
    if (table.timerKind !== "action") fail("POKER_ACTION_INVALID", "Le tour n'a pas encore repris.");
    if (table.version !== version) fail("STALE_STATE", "La main a avancé entre-temps.");

    const occupant = occupants(table).find((seat) => seat.userId === userId);
    if (!occupant) fail("POKER_NOT_SEATED", undefined, 403);
    if (hand.turn !== occupant.seat) fail("POKER_NOT_YOUR_TURN");

    await applyAndAdvance(table, occupant.seat, action);
  });
}

// ---------------------------------------------------------------------------
// Vue, filtrée par destinataire
// ---------------------------------------------------------------------------

function statusOf(table: PokerTable, occupant: Occupant): PokerSeatView["status"] {
  const siege = table.hand?.seats[occupant.seat];
  if (siege && occupant.inHand) {
    if (siege.status === "folded") return "folded";
    if (siege.status === "allin") return "allin";
    return "active";
  }
  if (occupant.stack === 0) return "broke";
  if (occupant.sittingOut) return "sitting-out";
  if (occupant.waitingForHand) return "waiting";
  return "active";
}

export function viewPoker(tableId: string, userId: string | null): PokerView | null {
  const table = tables.get(tableId);
  if (!table) return null;

  const hand = table.hand;
  const places = occupants(table).map((seat) => seat.seat);
  const blindes =
    hand && places.length >= 2
      ? pokerBlindPositions(
          hand.seats.flatMap((seat) => (seat ? [seat.seat] : [])),
          hand.button,
          table.seats.length,
        )
      : null;

  const abattage = table.phase === "payout" || table.phase === "showdown";
  // Le destinataire regarde-t-il sans jouer ? Un joueur assis n'a jamais accès
  // au jeu partagé d'un autre : le partage s'adresse aux spectateurs seuls.
  const watcher = userId === null ? null : table.watchers.get(userId) ?? null;

  const seats: PokerSeatView[] = occupants(table).map((occupant) => {
    const siege = hand?.seats[occupant.seat] ?? null;
    const showdown = hand?.showdown.find((entree) => entree.seat === occupant.seat) ?? null;

    /**
     * Les cartes d'un adversaire ne sortent **jamais** du serveur pendant la
     * main. Aucun masquage n'est laissé au client. Trois portes seulement :
     *
     * 1. c'est son propre jeu ;
     * 2. le récapitulatif de fin de coup : les joueurs voient l'abattage, les
     *    spectateurs peuvent alors lire la main de celui qu'ils suivent ;
     * 3. il a montré son jeu de lui-même après s'être couché.
     *
     * Le suivi est mémorisé par spectateur, mais aucune intention ne peut
     * ouvrir un jeu en direct, volontairement ou par mégarde.
     */
    const cartesVisibles =
      occupant.userId === userId ||
      (abattage && showdown !== null) ||
      (abattage && watcher?.followedUserId === occupant.userId) ||
      occupant.revealed;
    const cartes: (PokerCard | null)[] = siege?.cards
      ? cartesVisibles
        ? [...siege.cards]
        : [null, null]
      : [];

    return {
      seat: occupant.seat,
      userId: occupant.userId,
      pseudo: occupant.pseudo,
      avatarSeed: occupant.avatarSeed,
      connected: occupant.sockets > 0,
      stack: occupant.stack,
      committed: siege?.committed ?? 0,
      status: statusOf(table, occupant),
      cards: cartes,
      hand: showdown ? { category: showdown.rank.category, ranks: showdown.rank.ranks } : null,
      handLabel: showdown
        ? pokerHandLabel({ category: showdown.rank.category, ranks: showdown.rank.ranks })
        : null,
      bestCards: showdown ? showdown.rank.cards.map((carte) => ({ ...carte })) : null,
      isDealer: hand ? hand.button === occupant.seat : table.button === occupant.seat,
      isSmallBlind: blindes?.small === occupant.seat,
      isBigBlind: blindes?.big === occupant.seat,
      lastAction: occupant.lastAction,
      won: occupant.wonThisHand,
      leavingAfterHand: occupant.leaveAfterHand || occupant.standAfterHand,
      revealed: occupant.revealed,
      sittingOut: occupant.sittingOut,
    };
  });

  const moi = occupants(table).find((seat) => seat.userId === userId) ?? null;
  const aMoiDeParler = hand && moi && hand.turn === moi.seat && table.timerKind === "action";
  const legal = aMoiDeParler ? legalPokerActions(hand, moi.seat) : null;

  // Se caver n'est possible qu'entre deux mains, et seulement si le tapis n'est
  // pas déjà au plafond.
  const entreLesMains = !hand || table.phase === "payout";
  const peutSeCaver =
    moi !== null && entreLesMains && (table.config.maxBuyIn === null || moi.stack < table.config.maxBuyIn);

  return {
    id: table.id,
    game: "poker",
    phase: table.phase,
    config: table.config,
    pendingConfig: table.pendingConfig,
    seats,
    maxSeats: table.seats.length,
    watchers: [...table.watchers.values()].map((watcher) => ({
      userId: watcher.userId,
      pseudo: watcher.pseudo,
      avatarSeed: watcher.avatarSeed,
    })),
    followedUserId: watcher?.followedUserId ?? null,
    you: moi?.seat ?? null,
    isHost: table.hostId === userId,
    board: hand ? hand.board.map((carte) => ({ ...carte })) : [],
    pots: hand ? hand.pots.map((pot) => ({ amount: pot.amount, eligible: [...pot.eligible] })) : [],
    potTotal: hand ? pokerPotTotal(hand) : 0,
    turn: hand?.turn ?? null,
    allowed: legal
      ? {
          actions: legal.actions,
          callAmount: legal.callAmount,
          minRaiseTo: legal.minRaiseTo,
          maxRaiseTo: legal.maxRaiseTo,
        }
      : null,
    buyInRange: peutSeCaver
      ? {
          min: Math.max(1, table.config.minBuyIn - (moi?.stack ?? 0)),
          max: table.config.maxBuyIn === null ? null : table.config.maxBuyIn - (moi?.stack ?? 0),
        }
      : null,
    canReveal: moi !== null && canRevealNow(table, moi),
    deadlineAt: table.deadline ? new Date(table.deadline).toISOString() : null,
    timerKind: table.timerKind,
    timerMs: table.timerMs,
    actionMs: durations.action,
    version: table.version,
    now: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Lecture, présence, arrêt
// ---------------------------------------------------------------------------

export function pokerTableOf(userId: string): string | null {
  return tableByUser.get(userId) ?? null;
}

export function hasPokerTable(tableId: string): boolean {
  return tables.has(tableId);
}

export function pokerAudienceOf(tableId: string): string[] {
  const table = tables.get(tableId);
  return table ? audience(table) : [];
}

export function updatePokerIdentity(userId: string, patch: Partial<PlayerIdentity>): void {
  const tableId = tableByUser.get(userId);
  const table = tableId ? tables.get(tableId) : undefined;
  if (!table) return;
  const occupant = occupants(table).find((seat) => seat.userId === userId);
  if (occupant) Object.assign(occupant, patch);
  const watcher = table.watchers.get(userId);
  if (watcher) Object.assign(watcher, patch);
  table.version += 1;
}

export function pokerSalonSnapshot(): TableSummary | null {
  const table = tables.values().next().value as PokerTable | undefined;
  if (!table) return null;
  return {
    id: table.id,
    game: "poker",
    stake: null,
    status: table.phase === "waiting" ? "waiting" : "playing",
    seats: occupants(table).map((occupant) => ({
      seat: occupant.seat,
      userId: occupant.userId,
      pseudo: occupant.pseudo,
      avatarSeed: occupant.avatarSeed,
      connected: occupant.sockets > 0,
    })),
    maxSeats: table.seats.length,
    createdAt: new Date(table.createdAt).toISOString(),
  };
}

export function pokerCounts(): TableCounts {
  const table = tables.values().next().value as PokerTable | undefined;
  if (!table) return { waiting: 0, playing: 0, max: 1 };
  return {
    waiting: table.phase === "waiting" ? 1 : 0,
    playing: table.phase === "waiting" ? 0 : 1,
    max: 1,
  };
}

export function attachPoker(userId: string): string | null {
  const tableId = tableByUser.get(userId);
  const table = tableId ? tables.get(tableId) : null;
  if (!tableId || !table) return null;

  const occupant = occupants(table).find((seat) => seat.userId === userId);
  const watcher = table.watchers.get(userId);
  const present = occupant ?? watcher;
  if (!present) return null;

  present.sockets += 1;
  if (present.graceTimer) {
    clearTimeout(present.graceTimer);
    present.graceTimer = null;
    table.version += 1;
    publish(table);
  }
  return tableId;
}

/**
 * Une socket se ferme.
 *
 * Un joueur déconnecté **reste en jeu** : son minuteur continue de tourner et
 * le fait checker ou coucher, comme à une vraie table. Ce n'est qu'à
 * l'expiration du sursis qu'il est mis en pause, puis levé à la fin de la main.
 * Son siège n'est jamais libéré au milieu d'un coup.
 */
export function detachPoker(userId: string, graceMs = POKER_DISCONNECT_GRACE_MS): void {
  const tableId = tableByUser.get(userId);
  const table = tableId ? tables.get(tableId) : null;
  if (!table) return;

  const occupant = occupants(table).find((seat) => seat.userId === userId);
  const watcher = table.watchers.get(userId);
  const present = occupant ?? watcher;
  if (!present) return;

  present.sockets = Math.max(0, present.sockets - 1);
  if (present.sockets > 0 || present.graceTimer) return;

  present.graceTimer = setTimeout(() => {
    present.graceTimer = null;
    if (present.sockets > 0) return;
    if (occupant) {
      occupant.sittingOut = true;
      occupant.leaveAfterHand = true;
      if (!occupant.inHand || !table.hand) {
        void enqueue(table, () => cashOut(table, occupant, false));
      }
    } else if (watcher) {
      table.watchers.delete(userId);
      tableByUser.delete(userId);
      table.version += 1;
      disposeIfDeserted(table);
      publish(table);
    }
  }, graceMs);
  present.graceTimer.unref?.();

  table.version += 1;
  publish(table);
}

/**
 * Rembourse les sessions restées ouvertes après un arrêt brutal.
 *
 * Une ligne, parce que `recoverOpenRounds` fait exactement ce qu'il faut : la
 * somme des mouvements d'un joueur sur la session vaut ses sorties moins ses
 * caves, donc rembourser son opposé lui rend sa mise nette.
 */
export function recoverPokerRounds(): Promise<void> {
  return recoverOpenRounds("poker", "poker_cashout");
}

export function shutdownPoker(): void {
  for (const table of tables.values()) {
    clearTimer(table);
    for (const occupant of occupants(table)) {
      if (occupant.graceTimer) clearTimeout(occupant.graceTimer);
      releaseActivity(occupant.userId, { kind: "table", id: table.id });
    }
    for (const watcher of table.watchers.values()) {
      if (watcher.graceTimer) clearTimeout(watcher.graceTimer);
    }
  }
  tables.clear();
  tableByUser.clear();
  notifier = NO_NOTIFIER;
}

export function resetPokerForTests(): void {
  shutdownPoker();
  randomIndex = (maximum) => randomInt(maximum);
  durations.action = POKER_ACTION_MS;
  durations.streetPause = POKER_STREET_PAUSE_MS;
  durations.handBreak = POKER_HAND_BREAK_MS;
}
