/**
 * Gestionnaire de tables — état en mémoire, cycle de vie, minuteries.
 *
 * Ce module ne connaît **pas** Socket.IO : il reçoit un notifieur à
 * l'initialisation, sur le modèle de `realtime/notify.ts`. Sans cette
 * séparation il serait intestable sans lancer un serveur, et c'est précisément
 * la logique la plus délicate du lot — capacité, sièges, forfaits — donc celle
 * qui a le plus besoin de tests.
 *
 * L'état vit en mémoire et non en base : une table en attente n'a aucun intérêt
 * à survivre à un redémarrage de l'API, et une contrainte SQL « une seule
 * partie active par joueur » demanderait une migration pour un état volatil.
 * Les parties, elles, sont bien écrites en base (voir `settle.ts`).
 */

import { randomUUID } from "node:crypto";
import {
  GRACE_MS,
  TURN_MS,
  WAITING_TTL_MS,
  getGame,
  isValidStake,
  type Cell,
  type DuelGame,
  type EndReason,
  type GameCode,
  type MatchOutcome,
  type MatchView,
  type SalonSnapshot,
  type Seat,
  type TableCounts,
  type TableSeat,
  type TableStatus,
  type TableSummary,
  type TableGame,
} from "@maxoujeux/shared";
import { getEngine, type GridState } from "@maxoujeux/engines";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { matchPlayers, matches } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { notifyWallet } from "../../realtime/notify.js";
import { connectionCount } from "../../realtime/presence.js";
import { releaseActivity, reserveActivity } from "../games/activity.js";
import { debitInTx } from "../wallet/service.js";
import { cancelMatch, settleMatch, type PlayerResult } from "./settle.js";
import {
  attachBlackjack,
  blackjackCounts,
  blackjackPlayersOf,
  blackjackSalonSnapshot,
  blackjackTableOf,
  createBlackjackTable,
  detachBlackjack,
  hasBlackjackTable,
  watchBlackjackTable,
  leaveBlackjack,
  resetBlackjackForTests,
  setBlackjackNotifier,
  shutdownBlackjack,
  viewBlackjack,
} from "../blackjack/service.js";
import {
  attachRoulette,
  createRouletteTable,
  detachRoulette,
  hasRouletteTable,
  joinRouletteTable,
  leaveRoulette,
  resetRouletteForTests,
  rouletteCounts,
  roulettePlayersOf,
  rouletteSalonSnapshot,
  rouletteTableOf,
  setRouletteNotifier,
  shutdownRoulette,
  viewRoulette,
} from "../roulette/service.js";
import {
  attachPoker,
  createPokerTable,
  detachPoker,
  hasPokerTable,
  leavePoker,
  pokerCounts,
  pokerSalonSnapshot,
  pokerTableOf,
  resetPokerForTests,
  shutdownPoker,
  viewPoker,
  watchPokerTable,
} from "../poker/service.js";
import {
  attachSlots,
  detachSlots,
  hasSlotsTable,
  leaveSlotsTable,
  openSlotsTable,
  resetSlotsForTests,
  shutdownSlots,
  slotsCounts,
  slotsSalonSnapshot,
  slotsTableOf,
  watchSlotsTable,
} from "../slots/service.js";
import {
  attachPlinko,
  detachPlinko,
  hasPlinkoTable,
  leavePlinkoTable,
  openPlinkoTable,
  plinkoCounts,
  plinkoSalonSnapshot,
  plinkoTableOf,
  resetPlinkoForTests,
  shutdownPlinko,
  watchPlinkoTable,
} from "../plinko/service.js";

/**
 * Durée pendant laquelle une table terminée reste consultable.
 *
 * La place au plafond et la contrainte « une seule partie » sont libérées
 * immédiatement ; seul l'affichage du résultat a besoin de ce délai. Sans lui,
 * la table disparaîtrait avant que les joueurs aient vu qui a gagné.
 */
const RESULT_TTL_MS = 120_000;

/**
 * Durées effectives des minuteries.
 *
 * Les valeurs de production viennent du contrat partagé ; les tests les
 * raccourcissent à quelques millisecondes. Truquer l'horloge globale serait plus
 * fragile : PGlite s'appuie lui aussi sur des minuteries, et les figer bloque
 * les requêtes au milieu d'un test.
 */
const durations = {
  turn: TURN_MS,
  grace: GRACE_MS,
  waitingTtl: WAITING_TTL_MS,
  resultTtl: RESULT_TTL_MS,
};

/** Raccourcit les minuteries. Réservé aux tests. */
export function setDurationsForTests(next: Partial<typeof durations>): void {
  Object.assign(durations, next);
}

export interface PlayerIdentity {
  userId: string;
  pseudo: string;
  avatarSeed: string;
}

interface Occupant extends PlayerIdentity {
  seat: Seat;
  /** Sockets ouvertes par ce joueur. Zéro déclenche le sursis. */
  sockets: number;
  graceTimer: NodeJS.Timeout | null;
}

interface Table {
  id: string;
  game: DuelGame;
  stake: number;
  status: TableStatus;
  seats: [Occupant | null, Occupant | null];
  state: GridState | null;
  outcome: MatchOutcome | null;
  /** Échéance du tour courant, en millisecondes epoch. */
  deadline: number | null;
  turnTimer: NodeJS.Timeout | null;
  ttlTimer: NodeJS.Timeout | null;
  removalTimer: NodeJS.Timeout | null;
  /**
   * Numéro de séquence de l'état.
   *
   * Incrémenté à chaque changement. Sert de garde aux minuteries — un
   * `setTimeout` déjà en file d'attente s'exécute même après `clearTimeout`,
   * donc le rappel compare la version capturée à la version courante et ne fait
   * rien si elle a bougé.
   */
  version: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Notifieur
// ---------------------------------------------------------------------------

export interface TableNotifier {
  /** La liste des tables d'un jeu a changé. */
  salon(game: TableGame): void;
  /** L'état d'une table a changé : à diffuser à ses joueurs. */
  match(tableId: string): void;
  /** Les comptages du lobby ont changé. */
  counts(): void;
}

const NO_NOTIFIER: TableNotifier = { salon: () => {}, match: () => {}, counts: () => {} };

let notifier: TableNotifier = NO_NOTIFIER;

export function setTableNotifier(next: TableNotifier): void {
  notifier = next;
  setBlackjackNotifier({
    table: next.match,
    salon: () => next.salon("blackjack"),
    counts: next.counts,
  });
  setRouletteNotifier({
    table: next.match,
    salon: () => next.salon("roulette"),
    counts: next.counts,
  });
}

/** Journalisation d'une erreur survenue dans une minuterie, sans dépendre de Fastify. */
type Logger = (error: unknown, message: string) => void;
let logError: Logger = (error, message) => {
  console.error(message, error);
};

export function setTableLogger(next: Logger): void {
  logError = next;
}

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

const tables = new Map<string, Table>();

/**
 * Index joueur → table.
 *
 * C'est **cet** index qui garantit « une seule partie active à la fois, quel
 * que soit le nombre d'onglets ou d'appareils » (cahier des charges §7.1).
 */
const tableByUser = new Map<string, string>();

/** Une table vivante occupe une place du plafond. */
function isLive(table: Table): boolean {
  return table.status === "waiting" || table.status === "playing";
}

function liveCount(game: DuelGame): number {
  let count = 0;
  for (const table of tables.values()) {
    if (table.game === game && isLive(table)) count += 1;
  }
  return count;
}

function maxTables(game: DuelGame): number {
  return getGame(game)?.maxTables ?? 0;
}

function occupants(table: Table): Occupant[] {
  return table.seats.filter((seat): seat is Occupant => seat !== null);
}

function occupantOf(table: Table, userId: string): Occupant | null {
  return occupants(table).find((seat) => seat.userId === userId) ?? null;
}

function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}

// ---------------------------------------------------------------------------
// Minuteries
//
// Toute transition d'état annule les minuteries de la table. Un `setTimeout`
// orphelin garde en vie la partie qu'il référence : sur un conteneur plafonné à
// 512 Mo, c'est une fuite qui finit par tuer l'API.
// ---------------------------------------------------------------------------

function clearTurnTimer(table: Table): void {
  if (table.turnTimer) {
    clearTimeout(table.turnTimer);
    table.turnTimer = null;
  }
}

function clearTtlTimer(table: Table): void {
  if (table.ttlTimer) {
    clearTimeout(table.ttlTimer);
    table.ttlTimer = null;
  }
}

function clearGrace(seat: Occupant): void {
  if (seat.graceTimer) {
    clearTimeout(seat.graceTimer);
    seat.graceTimer = null;
  }
}

function clearAllTimers(table: Table): void {
  clearTurnTimer(table);
  clearTtlTimer(table);
  for (const seat of occupants(table)) clearGrace(seat);
}

/** Lance un travail asynchrone depuis une minuterie, sans laisser filer d'erreur. */
function runGuarded(label: string, work: () => Promise<void>): void {
  void work().catch((error: unknown) => {
    logError(error, `Échec du traitement différé « ${label} »`);
  });
}

function armTurnTimer(table: Table): void {
  clearTurnTimer(table);
  table.deadline = Date.now() + durations.turn;

  const version = table.version;
  table.turnTimer = setTimeout(() => {
    // Garde de version : le rappel a pu être mis en file d'attente juste avant
    // qu'un coup soit joué. `clearTimeout` seul ne l'annulerait plus.
    if (table.version !== version || table.status !== "playing" || !table.state) return;

    const late = table.state.turn;
    runGuarded("forfait sur dépassement du temps", () =>
      finish(table, "timeout", opponentSeat(late)),
    );
  }, durations.turn);
}

function armTtlTimer(table: Table): void {
  clearTtlTimer(table);
  table.ttlTimer = setTimeout(() => {
    if (table.status !== "waiting") return;
    runGuarded("expiration d'une table en attente", () => cancel(table));
  }, durations.waitingTtl);
}

function armGraceTimer(table: Table, seat: Occupant): void {
  clearGrace(seat);
  seat.graceTimer = setTimeout(() => {
    if (seat.sockets > 0) return;

    if (table.status === "waiting") {
      runGuarded("annulation après déconnexion de l'hôte", () => cancel(table));
      return;
    }
    if (table.status !== "playing") return;

    runGuarded("abandon après déconnexion", () => finish(table, "abandon", opponentSeat(seat.seat)));
  }, durations.grace);
}

function scheduleRemoval(table: Table): void {
  if (table.removalTimer) clearTimeout(table.removalTimer);
  table.removalTimer = setTimeout(() => {
    tables.delete(table.id);
  }, durations.resultTtl);
}

function opponentSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

/**
 * Ouvre une table et engage la mise de son hôte.
 *
 * **Ordre imposé : on réserve en mémoire, puis on écrit en base.** Node est
 * mono-thread, donc tout bloc synchrone est atomique — mais le premier `await`
 * rend la main. Contrôler le plafond puis attendre le débit laisserait deux
 * créations simultanées passer le même contrôle et dépasser la capacité.
 */
export async function createTable(
  player: PlayerIdentity,
  game: TableGame,
  stake?: number,
): Promise<string> {
  if (game === "blackjack") return createBlackjackTable(player);
  if (game === "roulette") return createRouletteTable(player);
  // Au Plinko, « créer » c'est ouvrir sa propre table : il n'y a ni mise de
  // table ni adversaire à attendre.
  if (game === "plinko") return openPlinkoTable(player);
  // Même principe à la machine à sous : « créer » c'est s'installer devant la
  // sienne.
  if (game === "slots") return openSlotsTable(player);
  // Le poker porte ses réglages dans la demande de création : blindes, caves et
  // nombre de sièges sont choisis par celui qui ouvre la table.
  if (game === "poker") fail("STAKE_INVALID", "Les réglages de la table sont obligatoires.", 400);
  if (stake === undefined) fail("STAKE_INVALID", "Cette mise n'est pas autorisée.", 400);
  if (!isValidStake(game, stake)) {
    fail("STAKE_INVALID", "Cette mise n'est pas autorisée.", 400);
  }

  // --- Réservation synchrone : aucun `await` jusqu'à la fin du bloc. ---
  if (tableByUser.has(player.userId)) {
    fail("ALREADY_IN_GAME", "Tu es déjà à une table. Termine ta partie avant d'en ouvrir une autre.");
  }
  if (liveCount(game) >= maxTables(game)) {
    fail(
      "CAPACITY_REACHED",
      "Toutes les tables de ce jeu sont prises. Rejoins-en une ou reviens dans un instant.",
    );
  }

  const id = randomUUID();
  const activity = { kind: "table", id } as const;
  if (!reserveActivity(player.userId, activity)) {
    fail("ALREADY_IN_GAME", "Tu joues déjà à un autre jeu. Termine-le avant d'ouvrir une table.");
  }
  const table: Table = {
    id,
    game,
    stake,
    status: "waiting",
    seats: [
      {
        ...player,
        seat: 0,
        // Le joueur a déjà au moins la socket qui porte cette demande ; partir
        // de zéro armerait un sursis d'abandon dès le premier onglet fermé.
        sockets: Math.max(1, connectionCount(player.userId)),
        graceTimer: null,
      },
      null,
    ],
    state: null,
    outcome: null,
    deadline: null,
    turnTimer: null,
    ttlTimer: null,
    removalTimer: null,
    version: 1,
    createdAt: Date.now(),
  };

  tables.set(id, table);
  tableByUser.set(player.userId, id);
  // --- Fin de la réservation. ---

  let balance: number;
  try {
    balance = await db.transaction(async (tx) => {
      await tx.insert(matches).values({
        id,
        game,
        status: "waiting",
        config: { stake },
      });
      await tx.insert(matchPlayers).values({ matchId: id, userId: player.userId, seat: 0 });
      return debitInTx(tx, player.userId, stake, "match_stake", id);
    });
  } catch (error) {
    // Réservation relâchée : la place au plafond ne doit pas rester bloquée
    // parce que le joueur n'avait pas les fonds.
    tables.delete(id);
    tableByUser.delete(player.userId);
    releaseActivity(player.userId, activity);
    throw error;
  }

  notifyWallet(player.userId, balance);
  armTtlTimer(table);
  notifier.salon(game);
  notifier.counts();
  notifier.match(id);
  return id;
}

/**
 * S'assied à une table en attente et lance la partie.
 *
 * Même règle que ci-dessus : le siège est occupé **avant** le débit. Deux
 * demandes simultanées verraient sinon toutes les deux un siège libre pendant
 * l'attente de la base, et la table finirait avec trois joueurs.
 */
/** Ouvre la table de poker avec ses réglages. Passe par le même verrou d'activité. */
export function createPokerTableWithConfig(
  player: PlayerIdentity,
  config: Parameters<typeof createPokerTable>[1],
): Promise<string> {
  return createPokerTable(player, config);
}

export async function joinTable(player: PlayerIdentity, tableId: string): Promise<string> {
  const table = tables.get(tableId);
  // Sur une table de blackjack, « rejoindre » veut dire **regarder** : la place
  // se choisit ensuite, siège par siège, via `blackjack:sit`. Voir
  // `watchBlackjackTable` pour la raison.
  if (!table && hasBlackjackTable(tableId)) return watchBlackjackTable(player, tableId);
  if (!table && hasRouletteTable(tableId)) return joinRouletteTable(player, tableId);
  // Rejoindre une table de Plinko, c'est toujours la regarder : le seul siège
  // est celui de son propriétaire.
  if (!table && hasPlinkoTable(tableId)) return watchPlinkoTable(player, tableId);
  if (!table && hasSlotsTable(tableId)) return watchSlotsTable(player, tableId);
  if (!table && hasPokerTable(tableId)) return watchPokerTable(player, tableId);

  // --- Réservation synchrone. ---
  if (!table || !isLive(table)) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  // Ce contrôle passe avant celui de la place libre : annoncer « table
  // complète » à un joueur qui est assis à cette table même serait faux.
  if (tableByUser.has(player.userId)) {
    fail("ALREADY_IN_GAME", "Tu es déjà à une table. Termine ta partie avant d'en rejoindre une autre.");
  }
  if (table.status !== "waiting" || table.seats[1] !== null) {
    fail("TABLE_FULL", "Quelqu'un a été plus rapide, cette table est complète.");
  }
  const activity = { kind: "table", id: tableId } as const;
  if (!reserveActivity(player.userId, activity)) {
    fail("ALREADY_IN_GAME", "Tu joues déjà à un autre jeu. Termine-le avant de rejoindre cette table.");
  }

  table.seats[1] = {
    ...player,
    seat: 1,
    sockets: Math.max(1, connectionCount(player.userId)),
    graceTimer: null,
  };
  tableByUser.set(player.userId, tableId);
  // --- Fin de la réservation. ---

  const startedAt = new Date();
  let balance: number;
  try {
    balance = await db.transaction(async (tx) => {
      await tx.insert(matchPlayers).values({ matchId: tableId, userId: player.userId, seat: 1 });
      await tx
        .update(matches)
        .set({ status: "playing", startedAt })
        .where(eq(matches.id, tableId));
      return debitInTx(tx, player.userId, table.stake, "match_stake", tableId);
    });
  } catch (error) {
    table.seats[1] = null;
    tableByUser.delete(player.userId);
    releaseActivity(player.userId, activity);
    throw error;
  }

  notifyWallet(player.userId, balance);

  clearTtlTimer(table);
  table.status = "playing";
  table.state = getEngine(table.game).create();
  table.version += 1;
  armTurnTimer(table);

  notifier.match(tableId);
  notifier.salon(table.game);
  notifier.counts();
  return tableId;
}

/**
 * Applique un coup.
 *
 * Le client n'envoie qu'une intention : le serveur vérifie le siège, le tour,
 * la fraîcheur de l'état, puis laisse le moteur trancher la légalité du coup.
 */
export async function play(
  userId: string,
  tableId: string,
  move: number,
  version: number,
): Promise<void> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  if (table.status !== "playing" || !table.state) {
    fail("GAME_OVER", "La partie est terminée.");
  }

  const occupant = occupantOf(table, userId);
  if (!occupant) fail("NOT_IN_GAME", "Tu n'es pas à cette table.", 403);

  // Le client a cliqué sur un plateau qui a déjà changé : on refuse plutôt que
  // d'appliquer le coup à l'aveugle sur une case qui n'est plus celle visée.
  if (version !== table.version) {
    fail("STALE_STATE", "La partie a avancé entre-temps. Regarde le plateau.");
  }
  if (table.state.turn !== occupant.seat) {
    fail("NOT_YOUR_TURN", "Ce n'est pas ton tour.");
  }

  // `IllegalMove` remonte tel quel : la couche transport la traduit.
  const { state } = getEngine(table.game).reduce(table.state, {
    seat: occupant.seat,
    value: move,
  });

  table.state = state;
  table.version += 1;

  if (!state.finished) {
    armTurnTimer(table);
    notifier.match(tableId);
    return;
  }

  await finish(table, state.winner === null ? "draw" : "line", state.winner);
}

/**
 * Quitte une table.
 *
 * Avant le démarrage, c'est une annulation avec remboursement. En cours de
 * partie, c'est un abandon : l'adversaire encaisse.
 */
export async function leave(userId: string, tableId: string): Promise<void> {
  const table = tables.get(tableId);
  if (!table && hasBlackjackTable(tableId)) return leaveBlackjack(userId, tableId);
  if (!table && hasRouletteTable(tableId)) return leaveRoulette(userId, tableId);
  if (!table && hasPlinkoTable(tableId)) return Promise.resolve(leavePlinkoTable(userId, tableId));
  if (!table && hasSlotsTable(tableId)) return Promise.resolve(leaveSlotsTable(userId, tableId));
  if (!table && hasPokerTable(tableId)) return leavePoker(userId, tableId);
  if (!table || !isLive(table)) fail("TABLE_GONE", "Cette table n'existe plus.", 404);

  const occupant = occupantOf(table, userId);
  if (!occupant) fail("NOT_IN_GAME", "Tu n'es pas à cette table.", 403);

  if (table.status === "waiting") {
    await cancel(table);
    return;
  }
  await finish(table, "abandon", opponentSeat(occupant.seat));
}

/**
 * Clôt une partie : règlement, statistiques, libération de la place.
 *
 * La contrainte « une seule partie » est levée tout de suite pour que les
 * joueurs puissent en relancer une, mais la table reste consultable le temps
 * que le résultat s'affiche.
 */
async function finish(table: Table, reason: EndReason, winnerSeat: Seat | null): Promise<void> {
  if (table.status !== "playing") return;

  clearAllTimers(table);
  table.status = "finished";
  table.deadline = null;

  const players = occupants(table).map((seat) => ({
    userId: seat.userId,
    seat: seat.seat,
    result: resultFor(seat.seat, winnerSeat, reason),
  }));

  const { deltas } = await settleMatch({
    tableId: table.id,
    game: table.game,
    stake: table.stake,
    reason,
    players,
  });

  table.outcome = { reason, winnerSeat, deltas };
  table.version += 1;

  for (const seat of occupants(table)) {
    tableByUser.delete(seat.userId);
    releaseActivity(seat.userId, { kind: "table", id: table.id });
  }
  scheduleRemoval(table);

  notifier.match(table.id);
  notifier.salon(table.game);
  notifier.counts();
}

/**
 * Un dépassement de temps ou une déconnexion n'est pas une défaite jouée : on
 * l'inscrit en `abandon` pour que le journal reste lisible, tout en la comptant
 * comme une défaite dans les statistiques (voir `settle.ts`).
 */
function resultFor(seat: Seat, winnerSeat: Seat | null, reason: EndReason): PlayerResult {
  if (winnerSeat === null) return "draw";
  if (seat === winnerSeat) return "win";
  return reason === "line" ? "loss" : "abandon";
}

/** Annule une table qui n'a jamais démarré et rend les mises. */
async function cancel(table: Table): Promise<void> {
  if (table.status !== "waiting") return;

  clearAllTimers(table);
  table.status = "cancelled";
  const seated = occupants(table);

  await cancelMatch(
    table.id,
    table.stake,
    seated.map((seat) => seat.userId),
  );

  for (const seat of seated) {
    tableByUser.delete(seat.userId);
    releaseActivity(seat.userId, { kind: "table", id: table.id });
  }
  table.version += 1;

  // Une table annulée n'a rien à montrer : elle disparaît tout de suite.
  tables.delete(table.id);
  if (table.removalTimer) clearTimeout(table.removalTimer);

  notifier.salon(table.game);
  notifier.counts();
}

// ---------------------------------------------------------------------------
// Connexions
// ---------------------------------------------------------------------------

/**
 * Une socket du joueur s'ouvre.
 * @returns la table où il est assis, pour l'y rattacher, ou `null`.
 */
export function attach(userId: string): string | null {
  const tableId = tableByUser.get(userId);
  if (!tableId) {
    return (
      attachBlackjack(userId) ??
      attachRoulette(userId) ??
      attachPlinko(userId) ??
      attachSlots(userId) ??
      attachPoker(userId)
    );
  }

  const table = tables.get(tableId);
  if (!table) return null;

  const occupant = occupantOf(table, userId);
  if (!occupant) return null;

  occupant.sockets += 1;
  if (occupant.graceTimer) {
    // Retour avant la fin du sursis : la partie reprend comme si rien n'était.
    clearGrace(occupant);
    table.version += 1;
    notifier.match(tableId);
    notifier.salon(table.game);
  }
  return tableId;
}

/** Une socket du joueur se ferme. Le sursis n'est armé qu'à la dernière. */
export function detach(userId: string): void {
  const tableId = tableByUser.get(userId);
  if (!tableId) {
    detachBlackjack(userId);
    detachRoulette(userId);
    detachPlinko(userId);
    detachSlots(userId);
    detachPoker(userId);
    return;
  }

  const table = tables.get(tableId);
  if (!table || !isLive(table)) return;

  const occupant = occupantOf(table, userId);
  if (!occupant) return;

  occupant.sockets = Math.max(0, occupant.sockets - 1);
  if (occupant.sockets > 0) return;

  armGraceTimer(table, occupant);
  table.version += 1;
  notifier.match(tableId);
  notifier.salon(table.game);
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export function tableOf(userId: string): string | null {
  return (
    tableByUser.get(userId) ??
    blackjackTableOf(userId) ??
    rouletteTableOf(userId) ??
    plinkoTableOf(userId) ??
    slotsTableOf(userId) ??
    pokerTableOf(userId)
  );
}

/**
 * Corrige l'identité recopiée dans un siège occupé.
 *
 * L'identité est figée au moment où le joueur s'assied : sans cette reprise, un
 * joueur renommé garderait son ancien nom à l'écran jusqu'à la fin de la partie.
 * Aucune diffusion forcée — les vues sont reconstruites à chaque coup, la
 * prochaine action emporte naturellement la correction.
 */
export function updateTableIdentity(
  userId: string,
  patch: { pseudo?: string; avatarSeed?: string },
): void {
  const tableId = tableByUser.get(userId);
  const table = tableId ? tables.get(tableId) : undefined;
  if (!table) return;

  for (const seat of table.seats) {
    if (seat?.userId === userId) Object.assign(seat, patch);
  }
}

export function gameOf(tableId: string): TableGame | null {
  if (tables.has(tableId)) return tables.get(tableId)?.game ?? null;
  if (hasBlackjackTable(tableId)) return "blackjack";
  if (hasRouletteTable(tableId)) return "roulette";
  return null;
}

export function playersOf(tableId: string): string[] {
  const table = tables.get(tableId);
  if (table) return occupants(table).map((seat) => seat.userId);
  const blackjack = blackjackPlayersOf(tableId);
  return blackjack.length > 0 ? blackjack : roulettePlayersOf(tableId);
}

function toTableSeat(occupant: Occupant): TableSeat {
  return {
    seat: occupant.seat,
    userId: occupant.userId,
    pseudo: occupant.pseudo,
    avatarSeed: occupant.avatarSeed,
    connected: occupant.sockets > 0,
  };
}

/** Grille vide, pour qu'une table en attente ait déjà la bonne forme à l'écran. */
function emptyCells(game: DuelGame): { rows: number; cols: number; cells: Cell[] } {
  const engine = getEngine(game);
  return {
    rows: engine.rows,
    cols: engine.cols,
    cells: Array.from({ length: engine.rows * engine.cols }, () => null),
  };
}

/**
 * Vue d'une partie pour un destinataire donné.
 *
 * Les deux jeux du lot 1 n'ont aucune information cachée : la vue passe quand
 * même par `engine.view()`, pour que le jour où le poker arrive, la couche
 * transport n'ait pas à changer de forme.
 */
export function viewFor(tableId: string, userId: string | null): MatchView | null {
  const table = tables.get(tableId);
  if (!table) return null;

  const seated = occupants(table);
  const mine = userId ? (occupantOf(table, userId)?.seat ?? null) : null;
  const board = table.state
    ? getEngine(table.game).view(table.state, mine)
    : null;
  const grid = board ?? emptyCells(table.game);

  return {
    id: table.id,
    game: table.game,
    stake: table.stake,
    pot: table.stake * seated.length,
    status: table.status,
    seats: seated.map(toTableSeat),
    you: mine,
    rows: grid.rows,
    cols: grid.cols,
    cells: [...grid.cells],
    turn: table.status === "playing" && board ? board.turn : null,
    winningLine: board?.winningLine ? [...board.winningLine] : null,
    lastMove: board?.lastMove ? { ...board.lastMove } : null,
    deadlineAt: table.deadline ? new Date(table.deadline).toISOString() : null,
    turnMs: durations.turn,
    outcome: table.outcome,
    version: table.version,
    now: new Date().toISOString(),
  };
}

export function activeViewFor(tableId: string, userId: string | null): import("@maxoujeux/shared").ActiveMatchView | null {
  return (
    viewFor(tableId, userId) ??
    viewBlackjack(tableId, userId) ??
    viewRoulette(tableId, userId) ??
    viewPoker(tableId, userId)
  );
}

export function salonSnapshot(game: TableGame): SalonSnapshot {
  // Le Blackjack et la Roulette tiennent leur propre table en mémoire : le
  // gestionnaire n'en connaît que l'instantané.
  if (game === "blackjack" || game === "roulette" || game === "poker") {
    const table =
      game === "blackjack"
        ? blackjackSalonSnapshot()
        : game === "roulette"
          ? rouletteSalonSnapshot()
          : pokerSalonSnapshot();
    return {
      game,
      tables: table ? [table] : [],
      used: table ? 1 : 0,
      max: getGame(game)?.maxTables ?? 1,
      now: new Date().toISOString(),
    };
  }
  // Le Plinko tient ses dix tables lui-même : le gestionnaire n'en connaît
  // que l'instantané, comme pour le Blackjack et la Roulette.
  if (game === "plinko" || game === "slots") {
    const liste = game === "plinko" ? plinkoSalonSnapshot() : slotsSalonSnapshot();
    return {
      game,
      tables: liste,
      used: liste.length,
      max: getGame(game)?.maxTables ?? 10,
      now: new Date().toISOString(),
    };
  }
  const summaries: TableSummary[] = [];

  for (const table of tables.values()) {
    if (table.game !== game || !isLive(table)) continue;
    summaries.push({
      id: table.id,
      game: table.game,
      stake: table.stake,
      status: table.status,
      seats: occupants(table).map(toTableSeat),
      maxSeats: 2,
      createdAt: new Date(table.createdAt).toISOString(),
    });
  }

  // Les tables en attente d'abord, puis les plus anciennes : ce sont celles
  // qu'un arrivant peut rejoindre, elles doivent être en haut de la liste.
  summaries.sort((a, b) => {
    if (a.status !== b.status) return a.status === "waiting" ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return {
    game,
    tables: summaries,
    used: liveCount(game),
    max: maxTables(game),
    now: new Date().toISOString(),
  };
}

/** Comptages affichés sur les cartes du lobby. */
export function tableCounts(): Partial<Record<GameCode, TableCounts>> {
  const counts: Partial<Record<GameCode, TableCounts>> = {};

  for (const game of ["connect4", "tictactoe"] as const) {
    counts[game] = { waiting: 0, playing: 0, max: maxTables(game) };
  }
  counts.blackjack = blackjackCounts();
  counts.roulette = rouletteCounts();
  counts.plinko = plinkoCounts();
  counts.slots = slotsCounts();
  counts.poker = pokerCounts();

  for (const table of tables.values()) {
    const entry = counts[table.game];
    if (!entry) continue;
    if (table.status === "waiting") entry.waiting += 1;
    else if (table.status === "playing") entry.playing += 1;
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Arrêt
// ---------------------------------------------------------------------------

/**
 * Purge toutes les minuteries.
 *
 * Appelé à l'arrêt de l'API : un `setTimeout` encore armé empêche Node de
 * rendre la main et fait échouer un arrêt propre.
 */
export function shutdown(): void {
  for (const table of tables.values()) {
    clearAllTimers(table);
    if (table.removalTimer) {
      clearTimeout(table.removalTimer);
      table.removalTimer = null;
    }
  }
  shutdownBlackjack();
  shutdownRoulette();
  shutdownPlinko();
  shutdownSlots();
  shutdownPoker();
}

/** Remet le gestionnaire à zéro. Réservé aux tests. */
export function resetForTests(): void {
  shutdown();
  for (const table of tables.values()) {
    for (const seat of occupants(table)) {
      releaseActivity(seat.userId, { kind: "table", id: table.id });
    }
  }
  tables.clear();
  tableByUser.clear();
  notifier = NO_NOTIFIER;
  resetBlackjackForTests();
  resetRouletteForTests();
  resetPlinkoForTests();
  resetSlotsForTests();
  resetPokerForTests();
}

/** Nombre de minuteries encore armées. Réservé aux tests. */
export function armedTimerCount(): number {
  let count = 0;
  for (const table of tables.values()) {
    if (table.turnTimer) count += 1;
    if (table.ttlTimer) count += 1;
    if (table.removalTimer) count += 1;
    for (const seat of occupants(table)) if (seat.graceTimer) count += 1;
  }
  return count;
}
