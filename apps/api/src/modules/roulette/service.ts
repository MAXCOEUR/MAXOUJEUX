/**
 * Table de roulette — état en mémoire, arbitrage serveur.
 *
 * Calqué sur `modules/blackjack/service.ts`, dont il reprend les quatre
 * garde-fous : notifieur injecté (le module n'importe pas Socket.IO), file de
 * sérialisation par table, minuteries à garde de génération, et tout mouvement
 * de MaxouCoin passant par `creditInTx` / `debitInTx` dans une transaction
 * unique.
 *
 * Ce qui change par rapport au Blackjack : **il n'y a ni siège ni tour de
 * parole**. Tout le monde mise pendant la même fenêtre et voit les jetons des
 * autres s'empiler. Le numéro `seat` conservé sur chaque participant n'est
 * qu'un identifiant de place dans la liste — `match_players.seat` ne peut pas
 * être nul, et le salon a besoin d'un ordre stable.
 */

import { randomInt, randomUUID } from "node:crypto";
import {
  ALL_BETS_PLACED_MS,
  ROULETTE_BETTING_MS,
  ROULETTE_DISCONNECT_GRACE_MS,
  ROULETTE_HISTORY,
  ROULETTE_MAX_PLAYERS,
  ROULETTE_MIN_BET,
  ROULETTE_RESULT_MS,
  ROULETTE_SPIN_MS,
  spotKey,
  type RoulettePhase,
  type RouletteSpot,
  type RouletteSpotBet,
  type RouletteView,
  type TableCounts,
  type TableSummary,
} from "@maxoujeux/shared";
import { roulettePayout, spinRoulette } from "@maxoujeux/engines";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { matchPlayers, matches, stats } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { notifyWallet } from "../../realtime/notify.js";
import { connectionCount } from "../../realtime/presence.js";
import { releaseActivity, reserveActivity } from "../games/activity.js";
import type { PlayerIdentity } from "../tables/manager.js";
import { recoverOpenRounds } from "../tables/recovery.js";
import { creditInTx, debitInTx } from "../wallet/service.js";

interface PlacedBet {
  spot: RouletteSpot;
  amount: number;
}

interface Participant extends PlayerIdentity {
  /** Position stable dans la liste, pour `match_players.seat` et le salon. */
  seat: number;
  sockets: number;
  graceTimer: NodeJS.Timeout | null;
  /** Mises confirmées du tour, par clé de case. */
  bets: Map<string, PlacedBet>;
  roundNet: number | null;
  leaveAfterRound: boolean;
}

interface Watcher extends PlayerIdentity {
  sockets: number;
}

interface RouletteTable {
  id: string;
  players: Map<string, Participant>;
  /** Présents sans avoir pris place : ils voient tout, ne misent rien. */
  watchers: Map<string, Watcher>;
  phase: RoulettePhase;
  roundId: string | null;
  result: number | null;
  history: number[];
  deadline: number | null;
  timer: NodeJS.Timeout | null;
  timerGeneration: number;
  version: number;
  createdAt: number;
  queue: Promise<void>;
}

export interface RouletteNotifier {
  table(tableId: string): void;
  salon(): void;
  counts(): void;
}

const NO_NOTIFIER: RouletteNotifier = { table: () => {}, salon: () => {}, counts: () => {} };
let notifier = NO_NOTIFIER;
const tables = new Map<string, RouletteTable>();
const tableByUser = new Map<string, string>();

const durations = {
  betting: ROULETTE_BETTING_MS,
  allBetsPlaced: ALL_BETS_PLACED_MS,
  spin: ROULETTE_SPIN_MS,
  result: ROULETTE_RESULT_MS,
  grace: ROULETTE_DISCONNECT_GRACE_MS,
};

/**
 * Source d'aléa du tirage.
 *
 * Remplaçable en test : sans un numéro imposé, aucun test de règlement n'est
 * déterministe et il faudrait vérifier des gains « parfois ».
 */
let randomIndex: (maximumExclusive: number) => number = (maximum) => randomInt(maximum);

export function setRouletteDurationsForTests(next: Partial<typeof durations>): void {
  Object.assign(durations, next);
}

export function setRouletteRandomForTests(next: typeof randomIndex): void {
  randomIndex = next;
}

export function setRouletteNotifier(next: RouletteNotifier): void {
  notifier = next;
}

function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}

function participants(table: RouletteTable): Participant[] {
  return [...table.players.values()].sort((a, b) => a.seat - b.seat);
}

/** Première place libre dans la liste, pour garder un ordre stable à l'écran. */
function freeSeat(table: RouletteTable): number {
  const taken = new Set([...table.players.values()].map((entry) => entry.seat));
  for (let seat = 0; seat < ROULETTE_MAX_PLAYERS; seat += 1) {
    if (!taken.has(seat)) return seat;
  }
  return -1;
}

function freshParticipant(player: PlayerIdentity, seat: number, sockets: number): Participant {
  return {
    ...player,
    seat,
    sockets,
    graceTimer: null,
    bets: new Map(),
    roundNet: null,
    leaveAfterRound: false,
  };
}

function clearTimer(table: RouletteTable): void {
  if (table.timer) clearTimeout(table.timer);
  table.timer = null;
  table.deadline = null;
  table.timerGeneration += 1;
}

/**
 * Arme une minuterie de phase.
 *
 * La garde de génération n'est pas une précaution théorique : un `setTimeout`
 * déjà en file d'attente s'exécute même après `clearTimeout`, et un rappel
 * orphelin ferait partir la bille deux fois sur la même mise.
 */
function schedule(table: RouletteTable, duration: number, work: () => Promise<void>): void {
  clearTimer(table);
  table.deadline = Date.now() + duration;
  const generation = table.timerGeneration;
  table.timer = setTimeout(() => {
    if (table.timerGeneration !== generation) return;
    void enqueue(table, work).catch((error: unknown) => console.error("Minuterie roulette", error));
  }, duration);
}

/**
 * Écourte la minuterie en cours.
 *
 * Ne fait qu'**avancer** l'échéance, jamais la repousser : sans ce contrôle, une
 * mise de dernière seconde rallongerait la fenêtre au lieu de la fermer.
 */
function hasten(table: RouletteTable, duration: number, work: () => Promise<void>): void {
  if (table.deadline === null) return;
  if (table.deadline - Date.now() <= duration) return;
  schedule(table, duration, work);
}

function enqueue<T>(table: RouletteTable, work: () => Promise<T>): Promise<T> {
  const result = table.queue.then(work, work);
  table.queue = result.then(() => undefined, () => undefined);
  return result;
}

function publish(table: RouletteTable): void {
  notifier.table(table.id);
  notifier.salon();
  notifier.counts();
}

// ---------------------------------------------------------------------------
// Cycle de vie de la table
// ---------------------------------------------------------------------------

export function createRouletteTable(player: PlayerIdentity): Promise<string> {
  if (tables.size >= 1) fail("CAPACITY_REACHED", "La table de Roulette existe déjà. Rejoins-la.");
  if (tableByUser.has(player.userId)) fail("ALREADY_IN_GAME", "Tu es déjà à une table.");

  const id = randomUUID();
  if (!reserveActivity(player.userId, { kind: "table", id })) {
    fail("ALREADY_IN_GAME", "Tu joues déjà à un autre jeu.");
  }

  const table: RouletteTable = {
    id,
    players: new Map(),
    watchers: new Map(),
    phase: "idle",
    roundId: null,
    result: null,
    history: [],
    deadline: null,
    timer: null,
    timerGeneration: 0,
    version: 1,
    createdAt: Date.now(),
    queue: Promise.resolve(),
  };
  table.players.set(player.userId, freshParticipant(player, 0, Math.max(1, connectionCount(player.userId))));
  tables.set(id, table);
  tableByUser.set(player.userId, id);
  publish(table);
  return Promise.resolve(id);
}

/**
 * Entrer à la table.
 *
 * Il n'y a pas de siège à choisir : quiconque est à la table peut miser, et
 * quiconque ne mise pas regarde. Le mode spectateur du Blackjack n'a donc pas
 * d'équivalent ici — il n'y aurait rien à distinguer.
 *
 * Tout le corps est **synchrone** : on contrôle la place et on l'occupe dans le
 * même bloc, sans `await` au milieu. Node étant mono-thread, deux arrivées
 * simultanées ne peuvent pas franchir le même plafond.
 */
export function joinRouletteTable(player: PlayerIdentity, tableId: string): Promise<string> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);

  // Entrée idempotente : deux onglets ne font pas deux présences.
  if (tableByUser.get(player.userId) === tableId) return Promise.resolve(tableId);
  if (tableByUser.has(player.userId)) fail("ALREADY_IN_GAME", "Tu es déjà à une table.");

  // Aucun verrou d'activité ici : regarder la bille tourner n'engage rien et
  // n'empêche pas de jouer ailleurs. C'est `sitRoulette` qui engage.
  table.watchers.set(player.userId, { ...player, sockets: Math.max(1, connectionCount(player.userId)) });
  tableByUser.set(player.userId, tableId);
  table.version += 1;
  publish(table);
  return Promise.resolve(tableId);
}

/**
 * Prendre place au tapis.
 *
 * Entrer à la roulette veut dire **regarder** ; s'asseoir est le geste distinct
 * qui ouvre le droit de miser — exactement comme au blackjack. C'est ici, et
 * seulement ici, que le verrou d'activité est pris.
 *
 * Tout le corps est **synchrone** : on contrôle la place et on l'occupe dans le
 * même bloc, sans `await` au milieu. Node étant mono-thread, deux arrivées
 * simultanées ne peuvent pas franchir le même plafond.
 */
export function sitRoulette(player: PlayerIdentity, tableId: string): void {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  if (table.players.has(player.userId)) return;

  const seat = freeSeat(table);
  if (seat < 0) fail("TABLE_FULL", "La table de Roulette est complète.");
  if (!reserveActivity(player.userId, { kind: "table", id: tableId })) {
    fail("ALREADY_IN_GAME", "Tu joues déjà à un autre jeu.");
  }

  const watcher = table.watchers.get(player.userId);
  table.watchers.delete(player.userId);
  table.players.set(
    player.userId,
    freshParticipant(player, seat, watcher?.sockets ?? Math.max(1, connectionCount(player.userId))),
  );
  tableByUser.set(player.userId, tableId);
  table.version += 1;
  publish(table);
}

/**
 * Rendre sa place et redevenir spectateur.
 *
 * Refusé tant qu'une mise est engagée sur le tour : se lever après avoir misé
 * reviendrait à retirer ses jetons du tapis en cours de partie. Le joueur peut
 * d'abord les reprendre avec `roulette:clear`.
 */
export function standRoulette(userId: string, tableId: string): void {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  const player = table.players.get(userId);
  if (!player) return;

  if (wagerOf(player) > 0) {
    fail("ROULETTE_BET_ENGAGED", "Tes jetons sont sur le tapis. Reprends-les d'abord.");
  }

  if (player.graceTimer) clearTimeout(player.graceTimer);
  table.players.delete(userId);
  releaseActivity(userId, { kind: "table", id: tableId });
  table.watchers.set(userId, {
    userId: player.userId,
    pseudo: player.pseudo,
    avatarSeed: player.avatarSeed,
    sockets: player.sockets,
  });
  table.version += 1;
  publish(table);
}

/**
 * Ferme la table si plus personne n'est là.
 *
 * « Personne » compte les spectateurs : une table sans joueur assis mais avec
 * un public reste ouverte, sinon celui qui regarde verrait la salle disparaître
 * sous ses yeux au départ du dernier miseur.
 */
function disposeIfDeserted(table: RouletteTable): void {
  if (table.players.size > 0 || table.watchers.size > 0) return;
  clearTimer(table);
  tables.delete(table.id);
}

function removePlayer(table: RouletteTable, player: Participant): void {
  if (player.graceTimer) clearTimeout(player.graceTimer);
  table.players.delete(player.userId);
  tableByUser.delete(player.userId);
  releaseActivity(player.userId, { kind: "table", id: table.id });
  table.version += 1;
  disposeIfDeserted(table);
  publish(table);
}

// ---------------------------------------------------------------------------
// Mises
// ---------------------------------------------------------------------------

/** Somme déjà engagée par un joueur sur le tour. */
function wagerOf(player: Participant): number {
  let total = 0;
  for (const bet of player.bets.values()) total += bet.amount;
  return total;
}

/**
 * Confirme une mise.
 *
 * Les cases arrivent **en bloc** : un seul débit, une seule transaction, « tout
 * passe ou rien ne passe ». Le joueur peut confirmer plusieurs fois tant que la
 * fenêtre est ouverte, chaque confirmation s'ajoutant à la précédente.
 *
 * Il n'y a plus de plafond : le minimum et le pas sont rejoués ici parce qu'un
 * contrôle client ne protège de rien, mais le seul maximum est le solde du
 * joueur, que le débit atomique fait respecter à lui seul.
 */
export function betRoulette(userId: string, tableId: string, requested: PlacedBet[]): Promise<void> {
  const table = tables.get(tableId);
  if (!table) return Promise.reject(new AppError(404, "TABLE_GONE", "Cette table n'existe plus."));

  return enqueue(table, async () => {
    if (table.phase !== "idle" && table.phase !== "betting") {
      fail("ROULETTE_BETTING_CLOSED", "Rien ne va plus, les mises sont fermées.");
    }
    const player = table.players.get(userId);
    if (!player) fail("NOT_IN_GAME", "Tu n'es pas à cette table.", 403);

    // Le client peut envoyer deux fois la même case : on regroupe avant de
    // débiter, pour n'écrire qu'un seul mouvement par case.
    const grouped = new Map<string, PlacedBet>();
    for (const bet of requested) {
      if (!Number.isInteger(bet.amount) || bet.amount < ROULETTE_MIN_BET || bet.amount % 10 !== 0) {
        fail("ROULETTE_BET_INVALID", "Cette mise n'est pas autorisée.", 400);
      }
      const key = spotKey(bet.spot);
      const current = grouped.get(key);
      grouped.set(key, { spot: bet.spot, amount: (current?.amount ?? 0) + bet.amount });
    }

    // Plus aucun plafond, par case ni au total : le seul maximum est le solde,
    // et c'est le débit atomique du porte-monnaie qui le fait respecter.
    let addition = 0;
    for (const bet of grouped.values()) addition += bet.amount;
    if (addition <= 0) fail("ROULETTE_BET_INVALID", "Cette mise n'est pas autorisée.", 400);

    const first = table.phase === "idle";
    const roundId = first ? randomUUID() : table.roundId;
    if (!roundId) throw new Error("Tour de roulette sans identifiant");

    const balance = await db.transaction(async (tx) => {
      if (first) {
        await tx.insert(matches).values({
          id: roundId,
          game: "roulette",
          status: "betting",
          config: { tableId, ruleset: "roulette-eu-v1" },
        });
      }
      // `onConflictDoNothing` plutôt qu'un drapeau applicatif : le joueur peut
      // confirmer plusieurs fois dans le même tour, et la clé primaire
      // (manche, joueur) refuserait la seconde insertion.
      await tx
        .insert(matchPlayers)
        .values({ matchId: roundId, userId, seat: player.seat })
        .onConflictDoNothing();
      return debitInTx(tx, userId, addition, "roulette_bet", roundId);
    });

    notifyWallet(userId, balance);
    for (const [key, bet] of grouped) {
      const already = player.bets.get(key);
      player.bets.set(key, { spot: bet.spot, amount: (already?.amount ?? 0) + bet.amount });
    }
    player.roundNet = null;
    table.roundId = roundId;
    table.phase = "betting";
    table.result = null;
    table.version += 1;
    if (first) schedule(table, durations.betting, () => spin(table));
    // Tous les joueurs présents ont posé quelque chose : la bille peut partir.
    // Quelqu'un qui regarde sans miser laisse la fenêtre entière se dérouler,
    // il lui reste le temps de se décider.
    if ([...table.players.values()].every((entry) => entry.bets.size > 0)) {
      hasten(table, durations.allBetsPlaced, () => spin(table));
    }
    publish(table);
  });
}

/**
 * Reprend l'intégralité de ses jetons, tant que la bille n'est pas partie.
 *
 * Une seule sortie possible, et elle est totale : rembourser case par case
 * multiplierait les chemins d'écriture pour un geste que personne ne fait à
 * moitié. Un misclic sur un tapis de trente-sept cases se corrige en reprenant
 * tout et en reposant.
 */
export function clearRoulette(userId: string, tableId: string): Promise<void> {
  const table = tables.get(tableId);
  if (!table) return Promise.reject(new AppError(404, "TABLE_GONE", "Cette table n'existe plus."));

  return enqueue(table, async () => {
    if (table.phase !== "betting") {
      fail("ROULETTE_BETTING_CLOSED", "Rien ne va plus, les mises sont fermées.");
    }
    const player = table.players.get(userId);
    if (!player) fail("NOT_IN_GAME", "Tu n'es pas à cette table.", 403);
    const total = wagerOf(player);
    if (total <= 0) return;

    const roundId = table.roundId;
    if (!roundId) throw new Error("Reprise sans tour");
    const balance = await db.transaction((tx) =>
      creditInTx(tx, userId, total, "roulette_refund", roundId),
    );
    notifyWallet(userId, balance);
    player.bets.clear();
    table.version += 1;

    // Plus personne n'a de jetons sur le tapis : le tour n'a pas lieu d'être et
    // la minuterie doit être désarmée, sinon la bille partirait sur une table
    // vide et créerait une manche sans participant.
    if (participants(table).every((entry) => wagerOf(entry) === 0)) {
      await db.update(matches).set({ status: "cancelled", endedAt: new Date() }).where(eq(matches.id, roundId));
      resetRound(table);
      return;
    }
    publish(table);
  });
}

// ---------------------------------------------------------------------------
// Tirage et règlement
// ---------------------------------------------------------------------------

async function spin(table: RouletteTable): Promise<void> {
  if (table.phase !== "betting") return;
  clearTimer(table);

  const engaged = participants(table).filter((entry) => wagerOf(entry) > 0);
  if (engaged.length === 0) return resetRound(table);

  /**
   * Le numéro est tiré **maintenant**, au début du lancer, et part dans l'état.
   * Un joueur peut donc le lire dans le réseau avant l'arrêt de la bille : sans
   * conséquence, les mises étant fermées. C'est en revanche indispensable pour
   * qu'un joueur arrivant en cours de lancer voie une roue cohérente, et pour
   * que l'animation ne dépende pas de l'horloge du client.
   */
  table.result = spinRoulette(randomIndex);
  table.phase = "spinning";
  table.version += 1;
  schedule(table, durations.spin, () => settle(table));
  publish(table);
}

async function settle(table: RouletteTable): Promise<void> {
  clearTimer(table);
  const result = table.result;
  const roundId = table.roundId;
  if (result === null || !roundId) return resetRound(table);

  const settlements = participants(table)
    .filter((player) => wagerOf(player) > 0)
    .map((player) => {
      let payout = 0;
      for (const bet of player.bets.values()) payout += roulettePayout(bet.spot, bet.amount, result);
      const wager = wagerOf(player);
      player.roundNet = payout - wager;
      return { player, payout, net: payout - wager };
    });

  const balances = await db.transaction(async (tx) => {
    const credited = new Map<string, number>();
    await tx.update(matches).set({ status: "finished", endedAt: new Date() }).where(eq(matches.id, roundId));

    for (const settlement of settlements) {
      const label = settlement.net > 0 ? "win" : settlement.net < 0 ? "loss" : "draw";
      if (settlement.payout > 0) {
        credited.set(
          settlement.player.userId,
          await creditInTx(tx, settlement.player.userId, settlement.payout, "roulette_payout", roundId),
        );
      }
      // Le filtre porte sur la manche **et** sur le joueur : sans le second,
      // le résultat d'un seul joueur serait recopié sur toute la table.
      await tx
        .update(matchPlayers)
        .set({ result: label, chipsDelta: settlement.net })
        .where(
          and(
            eq(matchPlayers.matchId, roundId),
            eq(matchPlayers.userId, settlement.player.userId),
          ),
        );

      await tx
        .insert(stats)
        .values({
          userId: settlement.player.userId,
          game: "roulette",
          played: 1,
          won: label === "win" ? 1 : 0,
          lost: label === "loss" ? 1 : 0,
          drawn: label === "draw" ? 1 : 0,
        })
        .onConflictDoUpdate({
          target: [stats.userId, stats.game],
          set: {
            played: sql`${stats.played} + 1`,
            won: sql`${stats.won} + ${label === "win" ? 1 : 0}`,
            lost: sql`${stats.lost} + ${label === "loss" ? 1 : 0}`,
            drawn: sql`${stats.drawn} + ${label === "draw" ? 1 : 0}`,
            updatedAt: new Date(),
          },
        });
    }
    return credited;
  });

  // Après le commit, jamais avant.
  for (const [userId, balance] of balances) notifyWallet(userId, balance);

  table.history = [result, ...table.history].slice(0, ROULETTE_HISTORY);
  table.phase = "result";
  table.version += 1;
  schedule(table, durations.result, async () => resetRound(table));
  publish(table);
}

function resetRound(table: RouletteTable): void {
  clearTimer(table);
  for (const player of participants(table)) {
    player.bets.clear();
    player.roundNet = null;
  }
  table.phase = "idle";
  table.roundId = null;
  table.result = null;
  table.version += 1;

  for (const player of participants(table)) {
    if (player.leaveAfterRound) removePlayer(table, player);
  }
  if (!tables.has(table.id)) return;
  publish(table);
}

// ---------------------------------------------------------------------------
// Départs et présence
// ---------------------------------------------------------------------------

export async function leaveRoulette(userId: string, tableId: string): Promise<void> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  const player = table.players.get(userId);
  if (!player) {
    // Simple spectateur : rien d'engagé, rien à rembourser.
    if (table.watchers.delete(userId)) {
      tableByUser.delete(userId);
      table.version += 1;
      disposeIfDeserted(table);
      publish(table);
      return;
    }
    fail("NOT_IN_GAME", "Tu n'es pas à cette table.", 403);
  }

  const engaged = wagerOf(player);
  if (engaged > 0 && table.phase === "betting") {
    const roundId = table.roundId;
    if (!roundId) throw new Error("Remboursement sans tour");
    const balance = await db.transaction((tx) =>
      creditInTx(tx, userId, engaged, "roulette_refund", roundId),
    );
    notifyWallet(userId, balance);
    player.bets.clear();
    removePlayer(table, player);
    if (!tables.has(table.id)) return;
    if (participants(table).every((entry) => wagerOf(entry) === 0)) {
      await db.update(matches).set({ status: "cancelled", endedAt: new Date() }).where(eq(matches.id, roundId));
      resetRound(table);
    }
    return;
  }

  // Bille lancée ou tour en règlement : la mise reste sur le tapis et le joueur
  // part au retour à la table vide. Reprendre ses jetons après le lancer
  // reviendrait à annuler une mise perdante en la voyant perdre.
  if (engaged > 0) {
    player.leaveAfterRound = true;
    player.sockets = 0;
    table.version += 1;
    publish(table);
    return;
  }

  removePlayer(table, player);
}

export function attachRoulette(userId: string): string | null {
  const tableId = tableByUser.get(userId);
  const table = tableId ? tables.get(tableId) : null;
  if (!tableId || !table) return null;

  // Spectateur : rien à réveiller, il suffit de le rattacher à sa table.
  const watcher = table.watchers.get(userId);
  if (watcher) {
    watcher.sockets += 1;
    return tableId;
  }

  const player = table.players.get(userId);
  if (!player) return null;
  player.sockets += 1;
  if (player.graceTimer) {
    clearTimeout(player.graceTimer);
    player.graceTimer = null;
    table.version += 1;
    publish(table);
  }
  return tableId;
}

export function detachRoulette(userId: string): void {
  const tableId = tableByUser.get(userId);
  const table = tableId ? tables.get(tableId) : null;
  if (!table) return;

  // Un spectateur qui ferme son dernier onglet sort simplement de la salle :
  // il n'a ni mise à protéger ni sursis à armer.
  const watcher = table.watchers.get(userId);
  if (watcher) {
    watcher.sockets = Math.max(0, watcher.sockets - 1);
    if (watcher.sockets > 0) return;
    table.watchers.delete(userId);
    tableByUser.delete(userId);
    table.version += 1;
    disposeIfDeserted(table);
    publish(table);
    return;
  }

  const player = table.players.get(userId);
  if (!player) return;
  player.sockets = Math.max(0, player.sockets - 1);
  if (player.sockets > 0 || player.graceTimer) return;
  table.version += 1;
  player.graceTimer = setTimeout(() => {
    player.graceTimer = null;
    if (player.sockets > 0) return;
    // Une mise engagée n'est pas perdue par la déconnexion : elle suit le tour
    // jusqu'au bout, et le joueur part ensuite.
    if (wagerOf(player) > 0) {
      player.leaveAfterRound = true;
      publish(table);
    } else {
      removePlayer(table, player);
    }
  }, durations.grace);
  publish(table);
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export function viewRoulette(tableId: string, userId: string | null): RouletteView | null {
  const table = tables.get(tableId);
  if (!table) return null;

  // Agrégat par case : le tas de toute la table, et la part du destinataire.
  const aggregate = new Map<string, RouletteSpotBet>();
  for (const player of table.players.values()) {
    const mine = player.userId === userId;
    for (const [key, bet] of player.bets) {
      const current = aggregate.get(key) ?? { spot: bet.spot, total: 0, mine: 0 };
      current.total += bet.amount;
      if (mine) current.mine += bet.amount;
      aggregate.set(key, current);
    }
  }

  return {
    id: table.id,
    game: "roulette",
    phase: table.phase,
    players: participants(table).map((player) => ({
      userId: player.userId,
      pseudo: player.pseudo,
      avatarSeed: player.avatarSeed,
      connected: player.sockets > 0,
      totalWager: wagerOf(player),
      roundNet: player.roundNet,
    })),
    maxPlayers: ROULETTE_MAX_PLAYERS,
    you: userId && table.players.has(userId) ? userId : null,
    watchers: [...table.watchers.values()].map((watcher) => ({
      userId: watcher.userId,
      pseudo: watcher.pseudo,
      avatarSeed: watcher.avatarSeed,
    })),
    roundId: table.roundId,
    bets: [...aggregate.values()],
    result: table.result,
    history: [...table.history],
    deadlineAt: table.deadline ? new Date(table.deadline).toISOString() : null,
    spinMs: durations.spin,
    version: table.version,
    now: new Date().toISOString(),
  };
}

export function rouletteTableOf(userId: string): string | null {
  return tableByUser.get(userId) ?? null;
}

export function hasRouletteTable(tableId: string): boolean {
  return tables.has(tableId);
}

/** Corrige l'identité recopiée dans le participant, figée à son arrivée. */
export function updateRouletteIdentity(
  userId: string,
  patch: { pseudo?: string; avatarSeed?: string },
): void {
  const tableId = tableByUser.get(userId);
  const table = tableId ? tables.get(tableId) : undefined;
  const player = table?.players.get(userId);
  if (player) Object.assign(player, patch);
  const watcher = table?.watchers.get(userId);
  if (watcher) Object.assign(watcher, patch);
}

export function roulettePlayersOf(tableId: string): string[] {
  const table = tables.get(tableId);
  return table ? [...table.players.keys(), ...table.watchers.keys()] : [];
}

export function rouletteSalonSnapshot(): TableSummary | null {
  const table = tables.values().next().value as RouletteTable | undefined;
  if (!table) return null;
  return {
    id: table.id,
    game: "roulette",
    stake: null,
    status: table.phase === "idle" || table.phase === "betting" ? "waiting" : "playing",
    seats: participants(table).map((player) => ({
      seat: player.seat,
      userId: player.userId,
      pseudo: player.pseudo,
      avatarSeed: player.avatarSeed,
      connected: player.sockets > 0,
    })),
    maxSeats: ROULETTE_MAX_PLAYERS,
    createdAt: new Date(table.createdAt).toISOString(),
  };
}

export function rouletteCounts(): TableCounts {
  const table = tables.values().next().value as RouletteTable | undefined;
  return {
    waiting: table && (table.phase === "idle" || table.phase === "betting") ? 1 : 0,
    playing: table && table.phase !== "idle" && table.phase !== "betting" ? 1 : 0,
    max: 1,
  };
}

/** Rembourse les tours dont le règlement n'a jamais abouti. */
export function recoverRouletteRounds(): Promise<void> {
  return recoverOpenRounds("roulette", "roulette_refund");
}

export function shutdownRoulette(): void {
  for (const table of tables.values()) {
    clearTimer(table);
    for (const player of table.players.values()) {
      if (player.graceTimer) clearTimeout(player.graceTimer);
      player.graceTimer = null;
    }
  }
}

export function resetRouletteForTests(): void {
  shutdownRoulette();
  for (const table of tables.values()) {
    for (const userId of table.players.keys()) {
      releaseActivity(userId, { kind: "table", id: table.id });
    }
  }
  tables.clear();
  tableByUser.clear();
  notifier = NO_NOTIFIER;
  randomIndex = (maximum) => randomInt(maximum);
}
