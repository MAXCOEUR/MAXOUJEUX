import { randomInt, randomUUID } from "node:crypto";
import {
  PLINKO_ERROR_LABELS,
  PLINKO_FALL_MS,
  PLINKO_MAX_BALLS,
  GRACE_MS,
  PLINKO_MIN_INTERVAL_MS,
  PLINKO_SLOTS,
  getGame,
  isValidStake,
  plinkoPayout,
  type PlinkoBallView,
  type PlinkoRisk,
  type PlinkoTableView,
  type PlinkoWatcher,
  type TableCounts,
  type TableSummary,
} from "@maxoujeux/shared";
import { dropPlinkoBall } from "@maxoujeux/engines";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { plinkoDrops, wallets } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { notifyWallet } from "../../realtime/notify.js";
import { connectionCount } from "../../realtime/presence.js";
import { releaseActivity, reserveActivity } from "../games/activity.js";
import {
  casinoOutcome,
  publishRoundReceipt,
  recordRoundInTx,
  type RoundReceipt,
} from "../stats/service.js";
import { creditInTx, debitInTx } from "../wallet/service.js";

/**
 * Plinko — des tables individuelles, ouvertes au regard des autres.
 *
 * Une table appartient à un joueur : lui seul lâche des billes et choisit le
 * risque. N'importe qui peut la regarder — c'est le même partage que le
 * Blackjack entre un siège et un spectateur, à ceci près qu'ici il n'y a qu'un
 * seul siège.
 *
 * Les billes s'enchaînent : plusieurs tombent en même temps, et l'état les
 * porte toutes. Chaque bille est **réglée à son lâcher**, en une transaction ;
 * la chute à l'écran n'est qu'un rejeu du trajet déjà tiré. Faire l'inverse —
 * régler à l'atterrissage — rendrait le solde dépendant d'une animation, donc
 * d'un onglet resté ouvert.
 */

export interface PlayerIdentity {
  userId: string;
  pseudo: string;
  avatarSeed: string;
}

interface Ball extends PlinkoBallView {
  /** Instant du lâcher, en millisecondes locales : sert à la purge. */
  at: number;
}

interface PlinkoTable {
  id: string;
  owner: PlayerIdentity;
  risk: PlinkoRisk;
  balls: Ball[];
  watchers: Map<string, PlayerIdentity>;
  wagered: number;
  returned: number;
  lastDropAt: number;
  version: number;
  createdAt: number;
  /** Sérialise les lâchers d'une même table, comme la file des autres tables. */
  queue: Promise<void>;
  sweeper: NodeJS.Timeout | null;
}

export interface PlinkoNotifier {
  table(tableId: string): void;
  /**
   * La table a fermé.
   *
   * L'audience est passée en argument parce qu'à cet instant la table n'est
   * plus dans l'état : la redemander ne rendrait qu'une liste vide, et personne
   * ne serait prévenu.
   */
  closed(tableId: string, audience: string[]): void;
  salon(): void;
  counts(): void;
}

const NO_NOTIFIER: PlinkoNotifier = {
  table: () => {},
  closed: () => {},
  salon: () => {},
  counts: () => {},
};
let notifier: PlinkoNotifier = NO_NOTIFIER;

const tables = new Map<string, PlinkoTable>();
/** Une seule table par compte, propriétaire ou spectateur. */
const tableByUser = new Map<string, string>();

const MAX_TABLES = getGame("plinko")?.maxTables ?? 10;

let randomIndex: (maximumExclusive: number) => number = (maximum) => randomInt(maximum);

export function setPlinkoNotifier(next: PlinkoNotifier): void {
  notifier = next;
}

/** Aléa imposé par les tests, sans détourner le hasard du processus. */
export function setPlinkoRandomForTests(next: typeof randomIndex): void {
  randomIndex = next;
}

function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}

function publish(table: PlinkoTable): void {
  notifier.table(table.id);
  notifier.salon();
  notifier.counts();
}

function toWatcher(player: PlayerIdentity): PlinkoWatcher {
  return { userId: player.userId, pseudo: player.pseudo, avatarSeed: player.avatarSeed };
}

/**
 * Retire les billes retombées.
 *
 * Sans purge, l'état d'une table grossirait indéfiniment et un spectateur
 * arrivant en cours de partie recevrait des billes déjà atterries, qu'il
 * afficherait empilées en bas de la planche.
 */
function sweep(table: PlinkoTable, now: number): boolean {
  const before = table.balls.length;
  const restantes: Ball[] = [];

  for (const ball of table.balls) {
    if (now - ball.at < PLINKO_FALL_MS) {
      restantes.push(ball);
      continue;
    }
    // La bille vient de toucher le fond : **c'est maintenant** qu'elle compte.
    // Additionner au lâcher ferait bouger le bilan avant l'atterrissage, et le
    // joueur lirait son gain dans le tableau de score au lieu de le voir tomber.
    table.wagered += ball.stake;
    table.returned += ball.payout;
  }

  table.balls = restantes;
  return table.balls.length !== before;
}

function scheduleSweep(table: PlinkoTable): void {
  if (table.sweeper) return;
  table.sweeper = setTimeout(() => {
    table.sweeper = null;
    if (!tables.has(table.id)) return;
    if (sweep(table, Date.now())) {
      table.version += 1;
      publish(table);
    }
    if (table.balls.length > 0) scheduleSweep(table);
  }, PLINKO_FALL_MS + 100);
  // Un balai en attente ne doit pas retenir le processus à l'arrêt.
  table.sweeper.unref?.();
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

/**
 * Ouvre une table.
 *
 * Tout le corps est **synchrone** : le plafond de tables est contrôlé et
 * consommé dans le même bloc, sans `await` au milieu. Deux ouvertures
 * simultanées ne peuvent donc pas franchir la dixième place.
 */
export function openPlinkoTable(player: PlayerIdentity): Promise<string> {
  const existing = tableByUser.get(player.userId);
  if (existing) {
    // Rouvrir sa propre table est sans effet — c'est le cas d'un second
    // onglet. En revanche, un spectateur qui demande une table doit se voir
    // refuser : sinon il récupérerait celle qu'il est en train de regarder.
    if (tables.get(existing)?.owner.userId === player.userId) return Promise.resolve(existing);
    // Simple spectateur : ouvrir la sienne le fait sortir de celle qu'il
    // regardait, plutôt que de lui opposer un refus qu'il ne comprendrait pas.
    leavePlinkoTable(player.userId, existing);
  }

  if (tables.size >= MAX_TABLES) {
    fail("CAPACITY_REACHED", `Les ${MAX_TABLES} tables de Plinko sont prises. Rejoins-en une pour regarder.`);
  }

  const id = randomUUID();
  if (!reserveActivity(player.userId, { kind: "table", id })) {
    fail("ALREADY_IN_GAME", "Tu joues déjà à un autre jeu.");
  }

  const table: PlinkoTable = {
    id,
    owner: player,
    risk: "medium",
    balls: [],
    watchers: new Map(),
    wagered: 0,
    returned: 0,
    lastDropAt: 0,
    version: 1,
    createdAt: Date.now(),
    queue: Promise.resolve(),
    sweeper: null,
  };
  tables.set(id, table);
  tableByUser.set(player.userId, id);
  publish(table);
  return Promise.resolve(id);
}

/**
 * Regarder une table.
 *
 * Regarder est libre et ne consomme **aucun** verrou : on peut suivre la partie
 * d'un autre en ayant la sienne en cours ailleurs. La seule contrainte est
 * d'être présent à un endroit à la fois — sinon le client recevrait deux états
 * concurrents pour un seul écran.
 */
export function watchPlinkoTable(player: PlayerIdentity, tableId: string): Promise<string> {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);

  if (tableByUser.get(player.userId) === tableId) return Promise.resolve(tableId);
  // Regarder est **libre** : aucun verrou d'activité n'est pris. Un joueur assis
  // au blackjack peut donc venir voir jouer quelqu'un d'autre sans perdre sa
  // place. Il ne peut en revanche être présent qu'à un endroit à la fois : on
  // le retire proprement de là où il était.
  const precedent = tableByUser.get(player.userId);
  if (precedent) {
    // Sauf s'il s'agit de la sienne : partir la fermerait, et personne ne
    // s'attend à perdre sa table en allant voir celle du voisin.
    if (tables.get(precedent)?.owner.userId === player.userId) {
      fail("ALREADY_IN_GAME", "Ferme ta table avant d'en regarder une autre.");
    }
    leavePlinkoTable(player.userId, precedent);
  }

  table.watchers.set(player.userId, player);
  tableByUser.set(player.userId, tableId);
  table.version += 1;
  publish(table);
  return Promise.resolve(tableId);
}

/**
 * Quitter une table.
 *
 * Le départ du propriétaire ferme la table : elle n'a plus personne pour
 * lâcher des billes, et la laisser ouverte occuperait une des dix places pour
 * un spectacle terminé.
 */
export function leavePlinkoTable(userId: string, tableId: string): void {
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

function close(table: PlinkoTable): void {
  if (table.sweeper) clearTimeout(table.sweeper);
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

function ownedBy(tableId: string, userId: string): PlinkoTable {
  const table = tables.get(tableId);
  if (!table) fail("TABLE_GONE", "Cette table n'existe plus.", 404);
  if (table.owner.userId !== userId) {
    fail("PLINKO_NOT_OWNER", PLINKO_ERROR_LABELS.PLINKO_NOT_OWNER, 403);
  }
  return table;
}

export function setPlinkoRisk(userId: string, tableId: string, risk: PlinkoRisk): void {
  const table = ownedBy(tableId, userId);
  if (table.risk === risk) return;
  table.risk = risk;
  table.version += 1;
  publish(table);
}

/**
 * Lâche une bille.
 *
 * Les contrôles de cadence et de saturation sont **synchrones et faits avant
 * tout `await`** : c'est ce qui empêche vingt clics de passer ensemble pendant
 * que la première transaction est en vol.
 */
export async function dropBall(
  userId: string,
  tableId: string,
  stake: number,
  now = Date.now(),
): Promise<void> {
  const table = ownedBy(tableId, userId);
  if (!isValidStake("plinko", stake)) {
    fail("PLINKO_STAKE_INVALID", PLINKO_ERROR_LABELS.PLINKO_STAKE_INVALID, 400);
  }

  sweep(table, now);
  if (table.balls.length >= PLINKO_MAX_BALLS) {
    fail("PLINKO_TOO_MANY_BALLS", PLINKO_ERROR_LABELS.PLINKO_TOO_MANY_BALLS);
  }
  if (now - table.lastDropAt < PLINKO_MIN_INTERVAL_MS) {
    fail("PLINKO_TOO_FAST", PLINKO_ERROR_LABELS.PLINKO_TOO_FAST, 429);
  }
  // Réservation de la cadence avant le premier `await` : sans elle, deux
  // lâchers simultanés liraient tous deux l'ancienne valeur.
  table.lastDropAt = now;

  const risk = table.risk;
  let balance: number | null = null;
  let receipt: RoundReceipt | null = null;

  try {
    const ball = await enqueue(table, async () => {
      return db.transaction(async (tx) => {
        // Le verrou sérialise les débits d'un même compte : deux billes lâchées
        // coup sur coup ne doivent pas lire le même solde.
        await tx.execute(
          sql`select ${wallets.userId} from ${wallets} where ${wallets.userId} = ${userId} for update`,
        );

        balance = await debitInTx(tx, userId, stake, "plinko_stake");

        const drop = dropPlinkoBall(randomIndex, risk);
        const payout = plinkoPayout(stake, drop.multiplierTenths);
        const droppedAt = new Date(now);

        const [inserted] = await tx
          .insert(plinkoDrops)
          .values({
            userId,
            stake,
            risk,
            slot: drop.slot,
            path: drop.path,
            multiplierTenths: drop.multiplierTenths,
            payout,
            droppedAt,
          })
          .returning({ id: plinkoDrops.id });
        if (!inserted) throw new Error("Chute de Plinko non enregistrée");

        if (payout > 0) balance = await creditInTx(tx, userId, payout, "plinko_reward");

        receipt = await recordRoundInTx(tx, {
          userId,
          game: "plinko",
          wagered: stake,
          returned: payout,
          outcome: casinoOutcome(stake, payout),
          // Les deux fentes du bord sont les plus payantes et les plus rares :
          // douze rebonds du même côté, une chance sur 4 096.
          flags: drop.slot === 0 || drop.slot === PLINKO_SLOTS - 1 ? ["plinko_max"] : [],
          at: droppedAt,
        });

        const view: Ball = {
          id: inserted.id,
          risk,
          path: drop.path,
          slot: drop.slot,
          multiplierTenths: drop.multiplierTenths,
          stake,
          payout,
          droppedAt: droppedAt.toISOString(),
          at: now,
        };
        return view;
      });
    });

    table.balls.push(ball);
    table.version += 1;
    scheduleSweep(table);
    publish(table);
  } catch (error) {
    // Une bille refusée ne doit pas bloquer la suivante derrière la cadence.
    table.lastDropAt = 0;
    throw error;
  }

  // Le porte-monnaie est déjà à jour en base ; seule l'**annonce** attend la fin
  // de la chute. Sans ce délai, le solde affiché révélerait le gain pendant que
  // la bille tombe encore — et une bannière de succès ferait de même.
  if (balance !== null || receipt !== null) annonceDifferee(userId, balance, receipt);
}

/** Annonces de solde en attente, à purger si le processus s'arrête. */
const pending = new Set<NodeJS.Timeout>();

function annonceDifferee(
  userId: string,
  balance: number | null,
  receipt: RoundReceipt | null,
): void {
  const timer = setTimeout(() => {
    pending.delete(timer);
    if (balance !== null) notifyWallet(userId, balance);
    // En dernier : si une prime de succès a été versée, c'est ce solde qui fait foi.
    publishRoundReceipt(receipt);
  }, PLINKO_FALL_MS);
  timer.unref?.();
  pending.add(timer);
}

function enqueue<T>(table: PlinkoTable, work: () => Promise<T>): Promise<T> {
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

export function viewPlinko(tableId: string, _userId: string | null, now = Date.now()): PlinkoTableView | null {
  const table = tables.get(tableId);
  if (!table) return null;
  sweep(table, now);

  return {
    id: table.id,
    owner: toWatcher(table.owner),
    risk: table.risk,
    // `at` reste côté serveur : le client se repère sur `droppedAt` et sur
    // l'horloge serveur déjà synchronisée, pas sur une durée locale.
    balls: table.balls.map(({ at: _at, ...ball }) => ball),
    watchers: [...table.watchers.values()].map(toWatcher),
    wagered: table.wagered,
    returned: table.returned,
    version: table.version,
    now: new Date(now).toISOString(),
  };
}

export function plinkoTableOf(userId: string): string | null {
  return tableByUser.get(userId) ?? null;
}

// ---------------------------------------------------------------------------
// Connexions
// ---------------------------------------------------------------------------

/** Sursis avant qu'une table sans socket ne soit fermée. */
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
 * @returns la planche à laquelle le rattacher, ou `null`.
 */
export function attachPlinko(userId: string): string | null {
  const tableId = tableByUser.get(userId);
  if (!tableId) return null;
  // Retour avant la fin du sursis : rien n'a été perdu, la table est intacte.
  clearGrace(userId);
  return tableId;
}

/**
 * Une socket du joueur se ferme.
 *
 * Le sursis évite qu'un rechargement de page ne ferme la table — et donc ne
 * libère sa place pour quelqu'un d'autre pendant les deux secondes de
 * rechargement. Passé ce délai sans retour, la place doit être rendue : dix
 * tables, ce n'est pas beaucoup.
 */
export function detachPlinko(userId: string, graceMs = GRACE_MS): void {
  const tableId = tableByUser.get(userId);
  if (!tableId) return;
  if (connectionCount(userId) > 0) return;

  clearGrace(userId);
  const timer = setTimeout(() => {
    graceTimers.delete(userId);
    if (connectionCount(userId) > 0) return;
    const current = tableByUser.get(userId);
    if (current === tableId) leavePlinkoTable(userId, tableId);
  }, graceMs);
  timer.unref?.();
  graceTimers.set(userId, timer);
}

export function hasPlinkoTable(tableId: string): boolean {
  return tables.has(tableId);
}

/** Comptes qui doivent recevoir l'état d'une table. */
export function plinkoAudienceOf(tableId: string): string[] {
  const table = tables.get(tableId);
  if (!table) return [];
  return [table.owner.userId, ...table.watchers.keys()];
}

/** Un changement de pseudo ou d'avatar doit se voir sans quitter la table. */
export function updatePlinkoIdentity(userId: string, patch: Partial<PlayerIdentity>): void {
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

/** Les tables, pour le salon du jeu. */
export function plinkoSalonSnapshot(): TableSummary[] {
  return [...tables.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((table) => ({
      id: table.id,
      game: "plinko" as const,
      // La mise se choisit bille par bille : aucune valeur ne vaut pour la table.
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

export function plinkoCounts(): TableCounts {
  return { waiting: 0, playing: tables.size, max: MAX_TABLES };
}

export function shutdownPlinko(): void {
  for (const timer of pending) clearTimeout(timer);
  pending.clear();
  for (const timer of graceTimers.values()) clearTimeout(timer);
  graceTimers.clear();
  for (const table of tables.values()) {
    if (table.sweeper) clearTimeout(table.sweeper);
    releaseActivity(table.owner.userId, { kind: "table", id: table.id });
  }
  tables.clear();
  tableByUser.clear();
  notifier = NO_NOTIFIER;
}

/** Remise à zéro entre deux fichiers de test, sans toucher au notifieur global. */
export function resetPlinkoForTests(): void {
  shutdownPlinko();
  randomIndex = (maximum) => randomInt(maximum);
}
