import { randomInt, randomUUID } from "node:crypto";
import {
  GRACE_MS,
  SLOTS_ERROR_LABELS,
  SLOTS_SPIN_MS,
  getGame,
  isValidStake,
  slotsPayout,
  type SlotsPlayer,
  type SlotsSpinResult,
  type SlotsTableView,
  type TableCounts,
  type TableSummary,
} from "@maxoujeux/shared";
import { spinSlots } from "@maxoujeux/engines";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { slotSpins, wallets } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { notifyWallet } from "../../realtime/notify.js";
import { connectionCount } from "../../realtime/presence.js";
import { releaseActivity, reserveActivity } from "../games/activity.js";
import { creditInTx, debitInTx } from "../wallet/service.js";

/**
 * Machine à sous — dix machines, ouvertes au regard des autres.
 *
 * Une machine appartient à un joueur : lui seul tire. N'importe qui peut la
 * regarder, exactement comme au Plinko — un seul siège, des spectateurs
 * bienvenus.
 *
 * Différence avec le Plinko : les rouleaux **occupent** la machine pendant leur
 * rotation. Il n'y a donc pas de cadence à imposer, l'animation en tient lieu :
 * on ne relance pas tant que le troisième rouleau n'est pas tombé.
 *
 * Comme partout, le tirage est réglé **au départ**, en une transaction. Les 2,4
 * secondes de rotation ne sont qu'un rejeu d'une ligne déjà décidée : régler à
 * l'arrêt rendrait le solde dépendant d'un onglet resté ouvert.
 */

export interface PlayerIdentity {
  userId: string;
  pseudo: string;
  avatarSeed: string;
}

interface Spin extends SlotsSpinResult {
  /** Instant du tirage, en millisecondes locales : sert à libérer la machine. */
  at: number;
}

interface SlotsTable {
  id: string;
  owner: PlayerIdentity;
  spinning: Spin | null;
  history: SlotsSpinResult[];
  watchers: Map<string, PlayerIdentity>;
  wagered: number;
  returned: number;
  version: number;
  createdAt: number;
  /** Sérialise les tirages d'une même machine, comme la file des autres tables. */
  queue: Promise<void>;
  timer: NodeJS.Timeout | null;
}

export interface SlotsNotifier {
  table(tableId: string): void;
  /**
   * La machine a fermé.
   *
   * L'audience est passée en argument parce qu'à cet instant la machine n'est
   * plus dans l'état : la redemander ne rendrait qu'une liste vide, et personne
   * ne serait prévenu.
   */
  closed(tableId: string, audience: string[]): void;
  salon(): void;
  counts(): void;
}

const NO_NOTIFIER: SlotsNotifier = {
  table: () => {},
  closed: () => {},
  salon: () => {},
  counts: () => {},
};
let notifier: SlotsNotifier = NO_NOTIFIER;

const tables = new Map<string, SlotsTable>();
/** Une seule machine par compte, propriétaire ou spectateur. */
const tableByUser = new Map<string, string>();

const MAX_TABLES = getGame("slots")?.maxTables ?? 10;
/** Tirages conservés pour la frise. Volontairement court : c'est un aperçu. */
const HISTORY_MAX = 8;

let randomIndex: (maximumExclusive: number) => number = (maximum) => randomInt(maximum);
let spinMs = SLOTS_SPIN_MS;

export function setSlotsNotifier(next: SlotsNotifier): void {
  notifier = next;
}

/** Aléa imposé par les tests, sans détourner le hasard du processus. */
export function setSlotsRandomForTests(next: typeof randomIndex): void {
  randomIndex = next;
}

/** Raccourcit la rotation. Réservé aux tests. */
export function setSlotsSpinMsForTests(next: number): void {
  spinMs = next;
}

function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}

function publish(table: SlotsTable): void {
  notifier.table(table.id);
  notifier.salon();
  notifier.counts();
}

function toPlayer(player: PlayerIdentity): SlotsPlayer {
  return { userId: player.userId, pseudo: player.pseudo, avatarSeed: player.avatarSeed };
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

/**
 * Ouvre une machine.
 *
 * Tout le corps est **synchrone** : le plafond est contrôlé et consommé dans le
 * même bloc, sans `await` au milieu. Deux ouvertures simultanées ne peuvent donc
 * pas franchir la dixième place.
 */
export function openSlotsTable(player: PlayerIdentity): Promise<string> {
  const existing = tableByUser.get(player.userId);
  if (existing) {
    // Rouvrir sa propre machine est sans effet — c'est le cas d'un second
    // onglet. Un spectateur, lui, doit se voir refuser : sinon il récupérerait
    // la machine qu'il est en train de regarder.
    if (tables.get(existing)?.owner.userId === player.userId) return Promise.resolve(existing);
    // Simple spectateur : ouvrir la sienne le fait sortir de celle qu'il
    // regardait, plutôt que de lui opposer un refus qu'il ne comprendrait pas.
    leaveSlotsTable(player.userId, existing);
  }

  if (tables.size >= MAX_TABLES) {
    fail(
      "CAPACITY_REACHED",
      `Les ${MAX_TABLES} machines sont prises. Rejoins-en une pour regarder.`,
    );
  }

  const id = randomUUID();
  if (!reserveActivity(player.userId, { kind: "table", id })) {
    fail("ALREADY_IN_GAME", "Tu joues déjà à un autre jeu.");
  }

  const table: SlotsTable = {
    id,
    owner: player,
    spinning: null,
    history: [],
    watchers: new Map(),
    wagered: 0,
    returned: 0,
    version: 1,
    createdAt: Date.now(),
    queue: Promise.resolve(),
    timer: null,
  };
  tables.set(id, table);
  tableByUser.set(player.userId, id);
  publish(table);
  return Promise.resolve(id);
}

/**
 * Regarder une machine.
 *
 * Regarder est libre et ne consomme **aucun** verrou : on peut suivre la partie
 * d'un autre en ayant la sienne en cours ailleurs. La seule contrainte est
 * d'être présent à un endroit à la fois.
 */
export function watchSlotsTable(player: PlayerIdentity, tableId: string): Promise<string> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette machine n'existe plus.", 404);

  if (tableByUser.get(player.userId) === tableId) return Promise.resolve(tableId);
  // Regarder est **libre** : aucun verrou d'activité n'est pris. Un joueur assis
  // au blackjack peut donc venir voir jouer quelqu'un d'autre sans perdre sa
  // place. Il ne peut en revanche être présent qu'à un endroit à la fois : on
  // le retire proprement de là où il était.
  const precedent = tableByUser.get(player.userId);
  if (precedent) {
    // Sauf s'il s'agit de la sienne : partir la fermerait, et personne ne
    // s'attend à perdre sa machine en allant voir celle du voisin.
    if (tables.get(precedent)?.owner.userId === player.userId) {
      fail("ALREADY_IN_GAME", "Ferme ta machine avant d'en regarder une autre.");
    }
    leaveSlotsTable(player.userId, precedent);
  }

  table.watchers.set(player.userId, player);
  tableByUser.set(player.userId, tableId);
  table.version += 1;
  publish(table);
  return Promise.resolve(tableId);
}

/**
 * Quitter une machine.
 *
 * Le départ du propriétaire la ferme : plus personne ne peut tirer, et la
 * laisser ouverte occuperait une des dix places pour un spectacle terminé.
 */
export function leaveSlotsTable(userId: string, tableId: string): void {
  const table = tables.get(tableId);
  if (!table) return;

  if (table.owner.userId === userId) {
    close(table);
    return;
  }

  if (!table.watchers.delete(userId)) return;
  tableByUser.delete(userId);
  // Rien à relâcher : un spectateur n'a jamais pris le verrou d'activité.
  table.version += 1;
  publish(table);
}

function close(table: SlotsTable): void {
  if (table.timer) clearTimeout(table.timer);
  const audience = [table.owner.userId, ...table.watchers.keys()];
  tables.delete(table.id);

  for (const userId of audience) tableByUser.delete(userId);
  // Le propriétaire est le seul à avoir pris le verrou d'activité.
  releaseActivity(table.owner.userId, { kind: "table", id: table.id });

  notifier.closed(table.id, audience);
  notifier.salon();
  notifier.counts();
}

// ---------------------------------------------------------------------------
// Jeu
// ---------------------------------------------------------------------------

function ownedBy(tableId: string, userId: string): SlotsTable {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette machine n'existe plus.", 404);
  if (table.owner.userId !== userId) {
    fail("SLOTS_NOT_OWNER", SLOTS_ERROR_LABELS.SLOTS_NOT_OWNER, 403);
  }
  return table;
}

/** Les rouleaux tournent-ils encore ? */
function isSpinning(table: SlotsTable, now: number): boolean {
  return table.spinning !== null && now - table.spinning.at < spinMs;
}

/**
 * Tire les rouleaux.
 *
 * Le contrôle d'occupation est **synchrone et fait avant tout `await`** : c'est
 * ce qui empêche dix clics de passer ensemble pendant que la première
 * transaction est en vol.
 */
export async function spinReels(
  userId: string,
  tableId: string,
  stake: number,
  now = Date.now(),
): Promise<void> {
  const table = ownedBy(tableId, userId);
  if (!isValidStake("slots", stake)) {
    fail("SLOTS_STAKE_INVALID", SLOTS_ERROR_LABELS.SLOTS_STAKE_INVALID, 400);
  }
  if (isSpinning(table, now)) fail("SLOTS_BUSY", SLOTS_ERROR_LABELS.SLOTS_BUSY);

  // Réservation immédiate de la machine : le tirage définitif remplacera cette
  // ligne, elle n'existe que pour fermer la porte pendant la transaction.
  const reservation: Spin = {
    id: "",
    reels: [],
    kind: "none",
    symbol: null,
    multiplierTenths: 0,
    stake,
    payout: 0,
    spunAt: new Date(now).toISOString(),
    at: now,
  };
  table.spinning = reservation;

  let balance: number | null = null;
  try {
    const spin = await enqueue(table, async () =>
      db.transaction(async (tx) => {
        // Le verrou sérialise les débits d'un même compte : deux tirages
        // rapprochés ne doivent pas lire le même solde.
        await tx.execute(
          sql`select ${wallets.userId} from ${wallets} where ${wallets.userId} = ${userId} for update`,
        );

        balance = await debitInTx(tx, userId, stake, "slots_stake");

        const result = spinSlots(randomIndex);
        const payout = slotsPayout(stake, result.outcome.multiplierTenths);
        const spunAt = new Date(now);

        const [inserted] = await tx
          .insert(slotSpins)
          .values({
            userId,
            stake,
            reels: result.reels,
            kind: result.outcome.kind,
            multiplierTenths: result.outcome.multiplierTenths,
            payout,
            spunAt,
          })
          .returning({ id: slotSpins.id });
        if (!inserted) throw new Error("Tirage de machine non enregistré");

        if (payout > 0) balance = await creditInTx(tx, userId, payout, "slots_reward");

        const view: Spin = {
          id: inserted.id,
          reels: result.reels,
          kind: result.outcome.kind,
          symbol: result.outcome.symbol,
          multiplierTenths: result.outcome.multiplierTenths,
          stake,
          payout,
          spunAt: spunAt.toISOString(),
          at: now,
        };
        return view;
      }),
    );

    table.spinning = spin;
    table.version += 1;

    // La machine se libère seule à la fin de la rotation : personne n'a à
    // envoyer un « c'est fini » que le client pourrait ne jamais émettre. Le
    // dernier tirage rejoint alors la frise.
    if (table.timer) clearTimeout(table.timer);
    table.timer = setTimeout(() => {
      table.timer = null;
      if (!tables.has(table.id) || table.spinning?.id !== spin.id) return;
      // Le tour ne compte qu'une fois les rouleaux arrêtés : additionner au
      // départ ferait bouger le bilan avant la révélation, et le joueur lirait
      // son gain dans le tableau de score au lieu de le voir tomber.
      table.wagered += spin.stake;
      table.returned += spin.payout;
      table.history.unshift(stripped(spin));
      if (table.history.length > HISTORY_MAX) table.history.length = HISTORY_MAX;
      table.spinning = null;
      table.version += 1;
      publish(table);
    }, spinMs);
    table.timer.unref?.();

    publish(table);
  } catch (error) {
    // Tirage refusé : la machine doit redevenir disponible immédiatement, sinon
    // une mise invalide la bloquerait deux secondes pour rien.
    if (table.spinning === reservation) {
      table.spinning = null;
      table.version += 1;
      publish(table);
    }
    throw error;
  }

  // Le porte-monnaie est déjà à jour en base ; seule l'**annonce** attend l'arrêt
  // des rouleaux. Sans ce délai, le solde affiché révélerait le gain pendant
  // qu'ils tournent encore.
  if (balance !== null) {
    const attente = setTimeout(() => {
      pending.delete(attente);
      notifyWallet(userId, balance as number);
    }, spinMs);
    attente.unref?.();
    pending.add(attente);
  }
}

/** Annonces de solde en attente, à purger si le processus s'arrête. */
const pending = new Set<NodeJS.Timeout>();

/** L'instant local du tirage ne sort pas du serveur : le client suit `spunAt`. */
function stripped({ at: _at, ...spin }: Spin): SlotsSpinResult {
  return spin;
}

function enqueue<T>(table: SlotsTable, work: () => Promise<T>): Promise<T> {
  const result = table.queue.then(work, work);
  table.queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export function viewSlots(
  tableId: string,
  _userId: string | null,
  now = Date.now(),
): SlotsTableView | null {
  const table = tables.get(tableId);
  if (!table) return null;

  return {
    id: table.id,
    owner: toPlayer(table.owner),
    // Une rotation terminée n'est plus « en cours », même si la minuterie n'a
    // pas encore tourné : sans ce filtre, un spectateur arrivé en retard
    // relancerait une animation déjà finie.
    spinning: table.spinning && isSpinning(table, now) ? stripped(table.spinning) : null,
    history: [...table.history],
    watchers: [...table.watchers.values()].map(toPlayer),
    wagered: table.wagered,
    returned: table.returned,
    version: table.version,
    now: new Date(now).toISOString(),
  };
}

export function slotsTableOf(userId: string): string | null {
  return tableByUser.get(userId) ?? null;
}

export function hasSlotsTable(tableId: string): boolean {
  return tables.has(tableId);
}

/** Comptes qui doivent recevoir l'état d'une machine. */
export function slotsAudienceOf(tableId: string): string[] {
  const table = tables.get(tableId);
  if (!table) return [];
  return [table.owner.userId, ...table.watchers.keys()];
}

/** Un changement de pseudo ou d'avatar doit se voir sans quitter la machine. */
export function updateSlotsIdentity(userId: string, patch: Partial<PlayerIdentity>): void {
  const tableId = tableByUser.get(userId);
  if (!tableId) return;
  const table = tables.get(tableId);
  if (!table) return;

  if (table.owner.userId === userId) table.owner = { ...table.owner, ...patch };
  const watcher = table.watchers.get(userId);
  if (watcher) table.watchers.set(userId, { ...watcher, ...patch });

  table.version += 1;
  publish(table);
}

/** Les machines, pour le salon du jeu. */
export function slotsSalonSnapshot(): TableSummary[] {
  return [...tables.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((table) => ({
      id: table.id,
      game: "slots" as const,
      // La mise se choisit tour par tour : aucune valeur ne vaut pour la machine.
      stake: null,
      status: "playing" as const,
      seats: [
        {
          seat: 0,
          userId: table.owner.userId,
          pseudo: table.owner.pseudo,
          avatarSeed: table.owner.avatarSeed,
          connected: true,
        },
      ],
      maxSeats: 1,
      createdAt: new Date(table.createdAt).toISOString(),
    }));
}

export function slotsCounts(): TableCounts {
  return { waiting: 0, playing: tables.size, max: MAX_TABLES };
}

// ---------------------------------------------------------------------------
// Connexions
// ---------------------------------------------------------------------------

/** Sursis avant qu'une machine sans socket ne soit fermée. */
const graceTimers = new Map<string, NodeJS.Timeout>();

function clearGrace(userId: string): void {
  const timer = graceTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    graceTimers.delete(userId);
  }
}

/**
 * Une socket du joueur s'ouvre.
 * @returns la machine à laquelle le rattacher, ou `null`.
 */
export function attachSlots(userId: string): string | null {
  const tableId = tableByUser.get(userId);
  if (!tableId) return null;
  clearGrace(userId);
  return tableId;
}

/**
 * Une socket du joueur se ferme.
 *
 * Le sursis évite qu'un rechargement de page ne ferme la machine — et ne libère
 * sa place — pendant les deux secondes du rechargement. Passé ce délai sans
 * retour, la place est rendue : dix machines, ce n'est pas beaucoup.
 */
export function detachSlots(userId: string, graceMs = GRACE_MS): void {
  const tableId = tableByUser.get(userId);
  if (!tableId) return;
  if (connectionCount(userId) > 0) return;

  clearGrace(userId);
  const timer = setTimeout(() => {
    graceTimers.delete(userId);
    if (connectionCount(userId) > 0) return;
    if (tableByUser.get(userId) === tableId) leaveSlotsTable(userId, tableId);
  }, graceMs);
  timer.unref?.();
  graceTimers.set(userId, timer);
}

export function shutdownSlots(): void {
  for (const timer of pending) clearTimeout(timer);
  pending.clear();
  for (const timer of graceTimers.values()) clearTimeout(timer);
  graceTimers.clear();
  for (const table of tables.values()) {
    if (table.timer) clearTimeout(table.timer);
    releaseActivity(table.owner.userId, { kind: "table", id: table.id });
  }
  tables.clear();
  tableByUser.clear();
  notifier = NO_NOTIFIER;
}

/** Remise à zéro entre deux fichiers de test. */
export function resetSlotsForTests(): void {
  shutdownSlots();
  randomIndex = (maximum) => randomInt(maximum);
  spinMs = SLOTS_SPIN_MS;
}
