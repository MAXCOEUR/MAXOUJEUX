import { randomInt, randomUUID } from "node:crypto";
import {
  BLACKJACK_ACTION_MS,
  BLACKJACK_BETTING_MS,
  BLACKJACK_DISCONNECT_GRACE_MS,
  BLACKJACK_IDLE_ROUNDS_MAX,
  BLACKJACK_INSURANCE_MS,
  BLACKJACK_MAX_HANDS,
  BLACKJACK_MAX_WATCHERS,
  BLACKJACK_RESULT_MS,
  type BlackjackAction,
  type BlackjackCard,
  type BlackjackHandView,
  type BlackjackView,
  type TableCounts,
  type TableSummary,
} from "@maxoujeux/shared";
import {
  blackjackPayout,
  createShoe,
  handValue,
  legalBlackjackActions,
  playDealer,
  splitHand,
  type BlackjackEngineCard,
  type BlackjackEngineHand,
} from "@maxoujeux/engines";
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

interface Hand {
  cards: BlackjackEngineCard[];
  wager: number;
  fromSplit: boolean;
  splitAces: boolean;
  status: BlackjackEngineHand["status"];
  resultStatus: "blackjack" | "won" | "lost" | "push" | null;
  payout: number | null;
  net: number | null;
  outcome: "blackjack" | "win" | "push" | "loss" | null;
}

interface Occupant extends PlayerIdentity {
  seat: number;
  sockets: number;
  bet: number | null;
  insurance: number;
  insuranceDecided: boolean;
  hands: Hand[];
  roundNet: number | null;
  leaveAfterRound: boolean;
  /**
   * Distinct de `leaveAfterRound` : celui-ci quitte la table, celui-là rend
   * seulement sa place et reste spectateur. Les confondre renverrait au salon
   * quelqu'un qui voulait juste regarder la manche suivante.
   */
  standAfterRound: boolean;
  /** Manches d'affilée sans miser, remis à zéro à chaque mise. */
  idleRounds: number;
  graceTimer: NodeJS.Timeout | null;
}

/**
 * Un spectateur.
 *
 * Il porte les mêmes champs de présence qu'un occupant — sockets et sursis de
 * déconnexion — parce qu'il consomme lui aussi le verrou « une seule activité à
 * la fois » : le libérer dès la première coupure réseau ferait perdre sa place
 * dans la file à quelqu'un dont le train passe sous un tunnel.
 */
interface Watcher extends PlayerIdentity {
  sockets: number;
  graceTimer: NodeJS.Timeout | null;
}

interface BlackjackTable {
  id: string;
  seats: (Occupant | null)[];
  watchers: Map<string, Watcher>;
  phase: BlackjackView["phase"];
  roundId: string | null;
  dealer: BlackjackCard[];
  turn: { seat: number; handIndex: number } | null;
  shoe: BlackjackEngineCard[];
  cursor: number;
  deadline: number | null;
  timer: NodeJS.Timeout | null;
  timerGeneration: number;
  version: number;
  createdAt: number;
  queue: Promise<void>;
}

export interface BlackjackNotifier {
  table(tableId: string): void;
  salon(): void;
  counts(): void;
}

const NO_NOTIFIER: BlackjackNotifier = { table: () => {}, salon: () => {}, counts: () => {} };
let notifier = NO_NOTIFIER;
const tables = new Map<string, BlackjackTable>();
const tableByUser = new Map<string, string>();

const durations = {
  betting: BLACKJACK_BETTING_MS,
  insurance: BLACKJACK_INSURANCE_MS,
  action: BLACKJACK_ACTION_MS,
  result: BLACKJACK_RESULT_MS,
  grace: BLACKJACK_DISCONNECT_GRACE_MS,
};

export function setBlackjackDurationsForTests(next: Partial<typeof durations>): void {
  Object.assign(durations, next);
}

export function setBlackjackNotifier(next: BlackjackNotifier): void {
  notifier = next;
}

function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}

function occupants(table: BlackjackTable): Occupant[] {
  return table.seats.filter((seat): seat is Occupant => seat !== null);
}

function occupant(table: BlackjackTable, userId: string): Occupant | null {
  return occupants(table).find((seat) => seat.userId === userId) ?? null;
}

/** Tout le monde à qui l'état de la table est destiné : les assis et ceux qui regardent. */
function audience(table: BlackjackTable): string[] {
  return [...occupants(table).map((seat) => seat.userId), ...table.watchers.keys()];
}

function freshOccupant(player: PlayerIdentity, seat: number, sockets: number): Occupant {
  return {
    ...player,
    seat,
    sockets,
    bet: null,
    insurance: 0,
    insuranceDecided: false,
    hands: [],
    roundNet: null,
    leaveAfterRound: false,
    standAfterRound: false,
    idleRounds: 0,
    graceTimer: null,
  };
}

/**
 * Détruit la table si plus personne n'y est, spectateurs compris.
 *
 * Ne pas compter les spectateurs détruirait la table sous les yeux du dernier
 * joueur qui vient de se lever pour regarder la manche suivante.
 */
function disposeIfDeserted(table: BlackjackTable): boolean {
  if (occupants(table).length > 0 || table.watchers.size > 0) return false;
  clearTimer(table);
  for (const watcher of table.watchers.values()) {
    if (watcher.graceTimer) clearTimeout(watcher.graceTimer);
  }
  tables.delete(table.id);
  return true;
}

/**
 * Rend un siège.
 *
 * `keepWatching` distingue les deux sorties possibles : se lever, qui laisse le
 * joueur à la table en spectateur et lui garde son verrou d'activité, et
 * quitter, qui rend tout. C'est le seul endroit où un siège est libéré.
 */
function vacateSeat(table: BlackjackTable, player: Occupant, keepWatching: boolean): void {
  if (player.graceTimer) clearTimeout(player.graceTimer);
  table.seats[player.seat] = null;

  if (keepWatching) {
    table.watchers.set(player.userId, {
      userId: player.userId,
      pseudo: player.pseudo,
      avatarSeed: player.avatarSeed,
      sockets: player.sockets,
      graceTimer: null,
    });
  } else {
    tableByUser.delete(player.userId);
    releaseActivity(player.userId, { kind: "table", id: table.id });
  }

  table.version += 1;
  disposeIfDeserted(table);
}

function draw(table: BlackjackTable): BlackjackEngineCard {
  const next = table.shoe[table.cursor];
  if (!next) throw new Error("SHOE_EXHAUSTED");
  table.cursor += 1;
  return next;
}

function freshShoe(): BlackjackEngineCard[] {
  return createShoe((maximum) => randomInt(maximum));
}

function clearTimer(table: BlackjackTable): void {
  if (table.timer) clearTimeout(table.timer);
  table.timer = null;
  table.deadline = null;
  table.timerGeneration += 1;
}

function schedule(table: BlackjackTable, duration: number, work: () => Promise<void>): void {
  clearTimer(table);
  table.deadline = Date.now() + duration;
  const generation = table.timerGeneration;
  table.timer = setTimeout(() => {
    if (table.timerGeneration !== generation) return;
    void enqueue(table, work).catch((error: unknown) => console.error("Minuterie blackjack", error));
  }, duration);
}

function enqueue<T>(table: BlackjackTable, work: () => Promise<T>): Promise<T> {
  const result = table.queue.then(work, work);
  table.queue = result.then(() => undefined, () => undefined);
  return result;
}

function publish(table: BlackjackTable): void {
  notifier.table(table.id);
  notifier.salon();
  notifier.counts();
}

export async function createBlackjackTable(player: PlayerIdentity): Promise<string> {
  if (tables.size >= 1) fail("CAPACITY_REACHED", "La table de Blackjack existe déjà. Rejoins-la.");
  if (tableByUser.has(player.userId)) fail("ALREADY_IN_GAME", "Tu es déjà à une table.");

  const id = randomUUID();
  if (!reserveActivity(player.userId, { kind: "table", id })) {
    fail("ALREADY_IN_GAME", "Tu joues déjà à un autre jeu.");
  }
  // Celui qui ouvre la table s'y assoit : une table ouverte sans personne
  // dessus n'attirerait aucun joueur, et personne ne miserait jamais le premier.
  const host = freshOccupant(player, 0, Math.max(1, connectionCount(player.userId)));
  const table: BlackjackTable = {
    id,
    seats: [host, null, null, null, null],
    watchers: new Map(),
    phase: "idle",
    roundId: null,
    dealer: [],
    turn: null,
    shoe: freshShoe(),
    cursor: 0,
    deadline: null,
    timer: null,
    timerGeneration: 0,
    version: 1,
    createdAt: Date.now(),
    queue: Promise.resolve(),
  };
  tables.set(id, table);
  tableByUser.set(player.userId, id);
  publish(table);
  return id;
}

/**
 * Entrer à la table — **en spectateur**, sans place.
 *
 * C'est ce que fait `tables:join` sur une table de blackjack, là où le même
 * message assoit d'office aux jeux de duel. La différence tient à la table
 * elle-même : cinq places et un ordre de jeu qui compte, donc le choix du siège
 * est un geste à part (`blackjack:sit`). S'asseoir d'office privait le joueur de
 * ce choix, et interdisait de simplement regarder.
 *
 * Une table complète reste ouverte aux spectateurs : c'est même là que le mode
 * prend tout son sens.
 */
export function watchBlackjackTable(player: PlayerIdentity, tableId: string): Promise<string> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);

  // Déjà à cette table, assis ou debout : l'entrée est idempotente. Deux onglets
  // ouverts sur la même table ne doivent pas produire deux spectateurs.
  if (tableByUser.get(player.userId) === tableId) return Promise.resolve(tableId);
  if (tableByUser.has(player.userId)) fail("ALREADY_IN_GAME", "Tu es déjà à une table.");
  if (table.watchers.size >= BLACKJACK_MAX_WATCHERS) {
    fail("BLACKJACK_WATCHERS_FULL", "Il y a déjà trop de spectateurs à cette table.");
  }
  if (!reserveActivity(player.userId, { kind: "table", id: tableId })) {
    fail("ALREADY_IN_GAME", "Tu joues déjà à un autre jeu.");
  }

  table.watchers.set(player.userId, {
    ...player,
    sockets: Math.max(1, connectionCount(player.userId)),
    graceTimer: null,
  });
  tableByUser.set(player.userId, tableId);
  table.version += 1;
  publish(table);
  return Promise.resolve(tableId);
}

/**
 * Prendre une place précise.
 *
 * Tout le corps est **synchrone** : on contrôle la place libre et on l'occupe
 * dans le même bloc, sans `await` au milieu. Node étant mono-thread, deux
 * demandes simultanées sur la même chaise ne peuvent pas passer toutes les deux
 * — c'est la règle déjà appliquée par `tables/manager.ts`, et la seule qui
 * tienne sans verrou applicatif.
 */
export function sitBlackjack(player: PlayerIdentity, tableId: string, seat: number): Promise<void> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  if (occupant(table, player.userId)) fail("BLACKJACK_ALREADY_SEATED", "Tu es déjà assis à cette table.");
  if (seat < 0 || seat >= table.seats.length) fail("BLACKJACK_SEAT_TAKEN", "Cette place n'existe pas.", 400);
  if (table.seats[seat] !== null) fail("BLACKJACK_SEAT_TAKEN", "Cette place vient d'être prise.");

  const watcher = table.watchers.get(player.userId);
  if (!watcher && !reserveActivity(player.userId, { kind: "table", id: tableId })) {
    fail("ALREADY_IN_GAME", "Tu joues déjà à un autre jeu.");
  }
  if (watcher?.graceTimer) clearTimeout(watcher.graceTimer);
  table.watchers.delete(player.userId);

  table.seats[seat] = freshOccupant(
    player,
    seat,
    watcher?.sockets ?? Math.max(1, connectionCount(player.userId)),
  );
  tableByUser.set(player.userId, tableId);
  table.version += 1;
  publish(table);
  return Promise.resolve();
}

/**
 * Rendre sa place sans quitter la table.
 *
 * Une mise engagée ne se reprend pas : le joueur se lèvera au règlement, comme
 * à une vraie table où l'on ne retire pas ses jetons d'une main en cours. C'est
 * `standAfterRound` qui porte cette attente, et `resetRound` qui l'exécute.
 */
export function standBlackjack(userId: string, tableId: string): Promise<void> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  const player = occupant(table, userId);
  if (!player) fail("BLACKJACK_NOT_SEATED", "Tu regardes cette table, tu n'y as pas de place.", 403);

  const engage = player.bet !== null || player.hands.length > 0;
  if (!engage) {
    vacateSeat(table, player, true);
    if (tables.has(table.id)) publish(table);
    return Promise.resolve();
  }

  player.standAfterRound = true;
  table.version += 1;
  publish(table);
  return Promise.resolve();
}

export function betBlackjack(userId: string, tableId: string, amount: number, version: number): Promise<void> {
  const table = tables.get(tableId);
  if (!table) return Promise.reject(new AppError(404, "TABLE_GONE", "Cette table n'existe plus."));
  return enqueue(table, async () => {
    if (version !== table.version) fail("STALE_STATE", "La table a changé entre-temps.");
    if (table.phase !== "idle" && table.phase !== "betting") fail("BLACKJACK_BETTING_CLOSED", "Les mises sont fermées.");
    if (!Number.isInteger(amount) || amount < 10 || amount > 2_500 || amount % 10 !== 0) {
      fail("BLACKJACK_BET_INVALID", "Cette mise n'est pas autorisée.", 400);
    }
    const player = occupant(table, userId);
    if (!player) fail("NOT_IN_GAME", "Tu n'es pas à cette table.", 403);
    if (player.bet !== null) fail("BLACKJACK_ALREADY_BET", "Ta mise est déjà engagée.");

    const first = table.phase === "idle";
    const roundId = first ? randomUUID() : table.roundId;
    if (!roundId) throw new Error("Manche Blackjack sans identifiant");

    const balance = await db.transaction(async (tx) => {
      if (first) {
        await tx.insert(matches).values({
          id: roundId,
          game: "blackjack",
          status: "betting",
          config: { tableId, ruleset: "blackjack-v1" },
        });
      }
      await tx.insert(matchPlayers).values({ matchId: roundId, userId, seat: player.seat });
      return debitInTx(tx, userId, amount, "blackjack_bet", roundId);
    });

    notifyWallet(userId, balance);
    player.bet = amount;
    player.hands = [];
    player.roundNet = null;
    table.roundId = roundId;
    table.phase = "betting";
    table.version += 1;
    if (first) schedule(table, durations.betting, () => deal(table));
    publish(table);
  });
}

function handFrom(cards: BlackjackEngineCard[], wager: number): Hand {
  const value = handValue(cards);
  return {
    cards,
    wager,
    fromSplit: false,
    splitAces: false,
    status: value.blackjack ? "stood" : "playing",
    payout: null,
    net: null,
    outcome: null,
    resultStatus: null,
  };
}

async function deal(table: BlackjackTable): Promise<void> {
  if (table.phase !== "betting") return;
  clearTimer(table);

  /**
   * Le décompte d'inactivité se fait ici, à la **fermeture** des mises, et non
   * au règlement : quelqu'un qui s'assoit en pleine manche n'était pas là quand
   * la fenêtre s'est fermée, et le punir pour une manche qu'on ne lui a jamais
   * proposée serait absurde. L'éviction elle-même attend `resetRound`, la table
   * ne pouvant pas perdre un siège au milieu d'une donne.
   */
  for (const player of occupants(table)) {
    if (player.bet === null) player.idleRounds += 1;
    else player.idleRounds = 0;
  }

  if (table.cursor >= Math.floor(table.shoe.length * 0.75) || table.shoe.length - table.cursor < 60) {
    table.shoe = freshShoe();
    table.cursor = 0;
  }
  const players = occupants(table).filter((entry) => entry.bet !== null);
  if (players.length === 0) return resetRound(table);

  const firstCards = new Map<number, BlackjackEngineCard>();
  for (const player of players) firstCards.set(player.seat, draw(table));
  table.dealer = [draw(table)];
  for (const player of players) {
    const first = firstCards.get(player.seat);
    if (!first || player.bet === null) throw new Error("Distribution incomplète");
    player.hands = [handFrom([first, draw(table)], player.bet)];
  }
  table.dealer.push(draw(table));
  table.version += 1;

  if (table.dealer[0]?.rank === "A") {
    table.phase = "insurance";
    for (const player of players) player.insuranceDecided = false;
    schedule(table, durations.insurance, () => finishInsurance(table));
    publish(table);
    return;
  }
  await afterPeek(table);
}

async function finishInsurance(table: BlackjackTable): Promise<void> {
  for (const player of occupants(table)) player.insuranceDecided = true;
  await afterPeek(table);
}

async function afterPeek(table: BlackjackTable): Promise<void> {
  clearTimer(table);
  if (handValue(table.dealer).blackjack) {
    await settle(table);
    return;
  }
  table.phase = "players";
  advanceTurn(table);
  publish(table);
}

function advanceTurn(table: BlackjackTable): void {
  clearTimer(table);
  const players = occupants(table).filter((entry) => entry.bet !== null).sort((a, b) => a.seat - b.seat);
  const current = table.turn;
  let passedCurrent = current === null;
  for (const player of players) {
    for (let handIndex = 0; handIndex < player.hands.length; handIndex += 1) {
      if (!passedCurrent) {
        if (player.seat === current?.seat && handIndex === current.handIndex) passedCurrent = true;
        continue;
      }
      const hand = player.hands[handIndex];
      if (hand?.status === "playing" && handValue(hand.cards, hand.fromSplit).total < 21) {
        table.turn = { seat: player.seat, handIndex };
        table.version += 1;
        schedule(table, durations.action, () => automaticStand(table));
        return;
      }
    }
  }
  table.turn = null;
  table.phase = "dealer";
  table.version += 1;
  void settle(table);
}

async function automaticStand(table: BlackjackTable): Promise<void> {
  const turn = table.turn;
  if (!turn) return;
  const hand = table.seats[turn.seat]?.hands[turn.handIndex];
  if (hand) hand.status = "stood";
  advanceTurn(table);
  publish(table);
}

export function insureBlackjack(userId: string, tableId: string, take: boolean, version: number): Promise<void> {
  const table = tables.get(tableId);
  if (!table) return Promise.reject(new AppError(404, "TABLE_GONE", "Cette table n'existe plus."));
  return enqueue(table, async () => {
    if (version !== table.version) fail("STALE_STATE", "La table a changé entre-temps.");
    if (table.phase !== "insurance") fail("BLACKJACK_INSURANCE_CLOSED", "L'assurance n'est plus proposée.");
    const player = occupant(table, userId);
    if (!player || player.bet === null) fail("NOT_IN_GAME", "Tu ne participes pas à cette manche.", 403);
    if (player.insuranceDecided) fail("BLACKJACK_INSURANCE_CLOSED", "Ton choix est déjà enregistré.");
    if (take) {
      const cost = player.bet / 2;
      const balance = await db.transaction((tx) => debitInTx(tx, userId, cost, "blackjack_bet", table.roundId ?? undefined));
      notifyWallet(userId, balance);
      player.insurance = cost;
    }
    player.insuranceDecided = true;
    table.version += 1;
    if (occupants(table).filter((entry) => entry.bet !== null).every((entry) => entry.insuranceDecided)) {
      await afterPeek(table);
    } else publish(table);
  });
}

export function actBlackjack(
  userId: string,
  tableId: string,
  handIndex: number,
  action: BlackjackAction,
  version: number,
): Promise<void> {
  const table = tables.get(tableId);
  if (!table) return Promise.reject(new AppError(404, "TABLE_GONE", "Cette table n'existe plus."));
  return enqueue(table, async () => {
    if (version !== table.version) fail("STALE_STATE", "La table a changé entre-temps.");
    if (table.phase !== "players") fail("BLACKJACK_WRONG_PHASE", "Cette action n'est pas disponible maintenant.");
    const player = occupant(table, userId);
    if (!player || table.turn?.seat !== player.seat || table.turn.handIndex !== handIndex) {
      fail("BLACKJACK_NOT_YOUR_TURN", "Ce n'est pas à cette main de jouer.");
    }
    const hand = player.hands[handIndex];
    if (!hand) fail("BLACKJACK_HAND_GONE", "Cette main n'existe plus.");
    const legal = legalBlackjackActions(hand, player.hands.length - 1, BLACKJACK_MAX_HANDS);
    if (!legal.includes(action)) fail("BLACKJACK_ACTION_INVALID", "Cette action n'est pas autorisée.");

    if (action === "hit") {
      hand.cards = [...hand.cards, draw(table)];
      const total = handValue(hand.cards, hand.fromSplit).total;
      if (total >= 21) {
        hand.status = total > 21 ? "busted" : "stood";
        advanceTurn(table);
      } else {
        table.version += 1;
        schedule(table, durations.action, () => automaticStand(table));
      }
    } else if (action === "stand") {
      hand.status = "stood";
      advanceTurn(table);
    } else {
      const roundId = table.roundId;
      if (!roundId) throw new Error("Action sans manche");
      const balance = await db.transaction((tx) => debitInTx(tx, userId, hand.wager, "blackjack_bet", roundId));
      notifyWallet(userId, balance);
      if (action === "double") {
        hand.wager *= 2;
        hand.cards = [...hand.cards, draw(table)];
        hand.status = handValue(hand.cards, hand.fromSplit).total > 21 ? "busted" : "stood";
      } else {
        const [left, right] = splitHand(hand, draw(table), draw(table));
        player.hands.splice(
          handIndex,
          1,
          { ...left, cards: [...left.cards], payout: null, net: null, outcome: null, resultStatus: null },
          { ...right, cards: [...right.cards], payout: null, net: null, outcome: null, resultStatus: null },
        );
        // La main gauche issue de la séparation doit être la prochaine jouée.
        // Repartir du début saute seulement les mains déjà terminées.
        table.turn = null;
      }
      advanceTurn(table);
    }
    publish(table);
  });
}

function outcomeFor(hand: Hand, dealerTotal: number, dealerBlackjack: boolean): Exclude<Hand["outcome"], null> {
  const value = handValue(hand.cards, hand.fromSplit);
  if (value.total > 21) return "loss";
  if (dealerBlackjack) return value.blackjack ? "push" : "loss";
  if (value.blackjack) return "blackjack";
  if (dealerTotal > 21 || value.total > dealerTotal) return "win";
  if (value.total === dealerTotal) return "push";
  return "loss";
}

async function settle(table: BlackjackTable): Promise<void> {
  clearTimer(table);
  table.phase = "dealer";
  const dealerBlackjack = handValue(table.dealer).blackjack;
  if (!dealerBlackjack) {
    const played = playDealer(table.dealer, table.shoe.slice(table.cursor));
    table.dealer = played.cards;
    table.cursor += played.consumed;
  }
  const dealerTotal = handValue(table.dealer).total;
  const roundId = table.roundId;
  if (!roundId) throw new Error("Règlement sans manche");
  const participants = occupants(table).filter((entry) => entry.bet !== null);

  const settlements = participants.map((player) => {
    let payout = dealerBlackjack && player.insurance > 0 ? blackjackPayout("insurance", player.insurance) : 0;
    for (const hand of player.hands) {
      const outcome = outcomeFor(hand, dealerTotal, dealerBlackjack);
      const handPayout = blackjackPayout(outcome, hand.wager);
      hand.outcome = outcome;
      hand.payout = handPayout;
      hand.net = handPayout - hand.wager;
      hand.resultStatus = outcome === "blackjack" ? "blackjack" : outcome === "win" ? "won" : outcome === "push" ? "push" : "lost";
      payout += handPayout;
    }
    const wager = player.hands.reduce((sum, hand) => sum + hand.wager, 0) + player.insurance;
    const net = payout - wager;
    player.roundNet = net;
    return { player, payout, net };
  });

  const balances = await db.transaction(async (tx) => {
    const result = new Map<string, number>();
    await tx.update(matches).set({ status: "finished", endedAt: new Date() }).where(eq(matches.id, roundId));
    for (const settlement of settlements) {
      const label = settlement.net > 0 ? "win" : settlement.net < 0 ? "loss" : "draw";
      if (settlement.payout > 0) {
        result.set(settlement.player.userId, await creditInTx(tx, settlement.player.userId, settlement.payout, "blackjack_payout", roundId));
      }
      await tx.update(matchPlayers).set({ result: label, chipsDelta: settlement.net }).where(
        and(eq(matchPlayers.matchId, roundId), eq(matchPlayers.userId, settlement.player.userId)),
      );
      await tx.insert(stats).values({
        userId: settlement.player.userId,
        game: "blackjack",
        played: 1,
        won: label === "win" ? 1 : 0,
        lost: label === "loss" ? 1 : 0,
        drawn: label === "draw" ? 1 : 0,
      }).onConflictDoUpdate({
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
    return result;
  });
  for (const [userId, balance] of balances) notifyWallet(userId, balance);
  table.phase = "result";
  table.turn = null;
  table.version += 1;
  schedule(table, durations.result, async () => resetRound(table));
  publish(table);
}

function resetRound(table: BlackjackTable): void {
  clearTimer(table);
  for (const player of occupants(table)) {
    player.bet = null;
    player.insurance = 0;
    player.insuranceDecided = false;
    player.hands = [];
    player.roundNet = null;
  }
  table.phase = "idle";
  table.roundId = null;
  table.dealer = [];
  table.turn = null;
  table.version += 1;

  // Trois sorties de siège, dans cet ordre : quitter la table, se lever pour
  // regarder, et l'éviction du joueur qui n'a pas misé depuis trois manches.
  // La dernière n'est pas une punition mais une libération : il n'existe qu'une
  // table de blackjack, et cinq places pour tout le site.
  for (const player of [...occupants(table)]) {
    if (player.leaveAfterRound) removePlayer(table, player);
    else if (player.standAfterRound) vacateSeat(table, player, true);
    else if (player.idleRounds >= BLACKJACK_IDLE_ROUNDS_MAX) vacateSeat(table, player, true);
  }

  if (!tables.has(table.id)) return;
  publish(table);
}

function handView(hand: Hand): BlackjackHandView {
  const value = handValue(hand.cards, hand.fromSplit);
  return {
    cards: hand.cards.map((card) => ({ ...card })),
    wager: hand.wager,
    total: value.total,
    soft: value.soft,
    status: hand.resultStatus ?? (value.blackjack ? "blackjack" : hand.status),
    payout: hand.payout,
    net: hand.net,
  };
}

export function viewBlackjack(tableId: string, userId: string | null): BlackjackView | null {
  const table = tables.get(tableId);
  if (!table) return null;
  const mine = userId ? occupant(table, userId) : null;
  const dealerValue = table.phase === "dealer" || table.phase === "result" ? handValue(table.dealer) : null;
  const first = table.dealer[0];
  const dealerCards = table.dealer.length === 0
    ? []
    : dealerValue
      ? table.dealer.map((card) => ({ ...card }))
      : [first ? { ...first } : null, null];
  let allowedActions: BlackjackAction[] = [];
  if (mine && table.phase === "players" && table.turn?.seat === mine.seat) {
    const hand = mine.hands[table.turn.handIndex];
    if (hand) allowedActions = legalBlackjackActions(hand, mine.hands.length - 1, BLACKJACK_MAX_HANDS);
  }
  return {
    id: table.id,
    game: "blackjack",
    phase: table.phase,
    seats: occupants(table).map((player) => ({
      seat: player.seat,
      userId: player.userId,
      pseudo: player.pseudo,
      avatarSeed: player.avatarSeed,
      connected: player.sockets > 0,
      participating: player.bet !== null,
      initialBet: player.bet,
      insurance: player.insurance,
      totalWager: player.hands.length > 0
        ? player.hands.reduce((sum, hand) => sum + hand.wager, 0) + player.insurance
        : (player.bet ?? 0) + player.insurance,
      hands: player.hands.map(handView),
      roundNet: player.roundNet,
      idleRounds: player.idleRounds,
      standingAfterRound: player.standAfterRound,
    })),
    maxSeats: 5,
    you: mine?.seat ?? null,
    watching: table.watchers.size,
    roundId: table.roundId,
    dealer: { cards: dealerCards, total: dealerValue?.total ?? null, soft: dealerValue?.soft ?? null },
    turn: table.turn ? { ...table.turn } : null,
    allowedActions,
    insuranceCost: mine?.bet && table.phase === "insurance" && !mine.insuranceDecided ? mine.bet / 2 : null,
    deadlineAt: table.deadline ? new Date(table.deadline).toISOString() : null,
    shoeRemaining: table.shoe.length - table.cursor,
    version: table.version,
    now: new Date().toISOString(),
  };
}

export function blackjackTableOf(userId: string): string | null {
  return tableByUser.get(userId) ?? null;
}

export function hasBlackjackTable(tableId: string): boolean {
  return tables.has(tableId);
}

/**
 * Corrige l'identité d'un joueur, assis comme spectateur.
 *
 * Les deux comptent : quitter un siège recopie l'identité dans `watchers`, donc
 * un spectateur qui se rassied repartirait sinon sous son ancien nom.
 */
export function updateBlackjackIdentity(
  userId: string,
  patch: { pseudo?: string; avatarSeed?: string },
): void {
  const tableId = tableByUser.get(userId);
  const table = tableId ? tables.get(tableId) : undefined;
  if (!table) return;

  for (const seat of table.seats) {
    if (seat?.userId === userId) Object.assign(seat, patch);
  }
  const watcher = table.watchers.get(userId);
  if (watcher) Object.assign(watcher, patch);
}

/** Quitter la table pour de bon : la place est rendue, le verrou d'activité aussi. */
function removePlayer(table: BlackjackTable, player: Occupant): void {
  vacateSeat(table, player, false);
  publish(table);
}

/** Un spectateur s'en va. */
function removeWatcher(table: BlackjackTable, userId: string): void {
  const watcher = table.watchers.get(userId);
  if (!watcher) return;
  if (watcher.graceTimer) clearTimeout(watcher.graceTimer);
  table.watchers.delete(userId);
  tableByUser.delete(userId);
  releaseActivity(userId, { kind: "table", id: table.id });
  table.version += 1;
  disposeIfDeserted(table);
  publish(table);
}

export async function leaveBlackjack(userId: string, tableId: string): Promise<void> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);

  // Un spectateur n'a rien engagé : il s'en va sans autre forme de procès.
  if (table.watchers.has(userId)) {
    removeWatcher(table, userId);
    return;
  }

  const player = occupant(table, userId);
  if (!player) fail("NOT_IN_GAME", "Tu n'es pas à cette table.", 403);

  if (table.phase === "idle" || (table.phase === "betting" && player.bet === null)) {
    removePlayer(table, player);
    return;
  }
  if (table.phase === "betting" && player.bet !== null) {
    const amount = player.bet;
    const roundId = table.roundId;
    if (!roundId) throw new Error("Remboursement sans manche");
    const balance = await db.transaction(async (tx) => {
      await tx.update(matchPlayers).set({ result: "cancelled", chipsDelta: 0 }).where(
        and(eq(matchPlayers.matchId, roundId), eq(matchPlayers.userId, userId)),
      );
      return creditInTx(tx, userId, amount, "blackjack_refund", roundId);
    });
    notifyWallet(userId, balance);
    player.bet = null;
    removePlayer(table, player);
    if (occupants(table).every((entry) => entry.bet === null)) {
      await db.update(matches).set({ status: "cancelled", endedAt: new Date() }).where(eq(matches.id, roundId));
      if (tables.has(table.id)) resetRound(table);
    }
    return;
  }

  player.leaveAfterRound = true;
  player.sockets = 0;
  if (table.turn?.seat === player.seat) await automaticStand(table);
  publish(table);
}

export function attachBlackjack(userId: string): string | null {
  const tableId = tableByUser.get(userId);
  const table = tableId ? tables.get(tableId) : null;
  if (!tableId || !table) return null;

  const present = occupant(table, userId) ?? table.watchers.get(userId);
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

export function detachBlackjack(userId: string): void {
  const tableId = tableByUser.get(userId);
  const table = tableId ? tables.get(tableId) : null;
  if (!table) return;

  const watcher = table.watchers.get(userId);
  if (watcher) {
    watcher.sockets = Math.max(0, watcher.sockets - 1);
    if (watcher.sockets > 0 || watcher.graceTimer) return;
    // Même sursis que pour un joueur : rien n'est en jeu, mais le spectateur
    // tient le verrou d'activité, et le lui reprendre à la première coupure
    // réseau lui ferait perdre la table sous un tunnel.
    watcher.graceTimer = setTimeout(() => {
      watcher.graceTimer = null;
      if (watcher.sockets > 0) return;
      removeWatcher(table, userId);
    }, durations.grace);
    return;
  }

  const player = occupant(table, userId);
  if (!player) return;
  player.sockets = Math.max(0, player.sockets - 1);
  if (player.sockets > 0 || player.graceTimer) return;
  table.version += 1;
  player.graceTimer = setTimeout(() => {
    player.graceTimer = null;
    if (player.sockets > 0) return;
    if (table.phase === "idle" || (table.phase === "betting" && player.bet === null)) {
      removePlayer(table, player);
    } else {
      player.leaveAfterRound = true;
      if (table.turn?.seat === player.seat) void automaticStand(table);
      publish(table);
    }
  }, durations.grace);
  publish(table);
}

/**
 * Destinataires de l'état de la table.
 *
 * Les spectateurs en font partie : sans eux dans cette liste, ils n'ont jamais
 * reçu la moindre carte et le mode spectateur n'existe pas.
 */
export function blackjackPlayersOf(tableId: string): string[] {
  const table = tables.get(tableId);
  return table ? audience(table) : [];
}

export function blackjackSalonSnapshot(): TableSummary | null {
  const table = tables.values().next().value as BlackjackTable | undefined;
  if (!table) return null;
  return {
    id: table.id,
    game: "blackjack",
    stake: null,
    status: table.phase === "idle" || table.phase === "betting" ? "waiting" : "playing",
    seats: occupants(table).map((player) => ({
      seat: player.seat,
      userId: player.userId,
      pseudo: player.pseudo,
      avatarSeed: player.avatarSeed,
      connected: player.sockets > 0,
    })),
    maxSeats: 5,
    createdAt: new Date(table.createdAt).toISOString(),
  };
}

export function blackjackCounts(): TableCounts {
  const table = tables.values().next().value as BlackjackTable | undefined;
  return {
    waiting: table && (table.phase === "idle" || table.phase === "betting") ? 1 : 0,
    playing: table && table.phase !== "idle" && table.phase !== "betting" ? 1 : 0,
    max: 1,
  };
}

/**
 * Rembourse les engagements dont la transaction de règlement n'a jamais abouti.
 *
 * Le corps vit dans `tables/recovery.ts` : la roulette a exactement le même
 * besoin, au nom du jeu près, et deux copies de cette logique divergeraient —
 * or c'est du code de reprise après incident, celui qu'on relit le moins et
 * dont on a le plus besoin qu'il soit juste.
 */
export function recoverBlackjackRounds(): Promise<void> {
  return recoverOpenRounds("blackjack", "blackjack_refund");
}

export function shutdownBlackjack(): void {
  for (const table of tables.values()) {
    clearTimer(table);
    for (const present of [...occupants(table), ...table.watchers.values()]) {
      if (present.graceTimer) clearTimeout(present.graceTimer);
      present.graceTimer = null;
    }
  }
}

export function resetBlackjackForTests(): void {
  shutdownBlackjack();
  for (const table of tables.values()) {
    for (const userId of audience(table)) {
      releaseActivity(userId, { kind: "table", id: table.id });
    }
  }
  tables.clear();
  tableByUser.clear();
  notifier = NO_NOTIFIER;
}
