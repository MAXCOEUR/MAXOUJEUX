import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schéma complet de MaxouJeux.
 *
 * Les tables des lots ultérieurs (matches, stats, motus, chat) sont créées dès
 * maintenant : une seule migration initiale vaut mieux que six migrations
 * successives sur une base déjà en production.
 */

const now = sql`now()`;

/**
 * Colonne binaire.
 *
 * Drizzle n'expose pas `bytea`. La normalisation en `Buffer` n'est pas
 * cosmétique : postgres-js rend déjà un `Buffer`, PGlite un `Uint8Array` nu.
 * Sans elle, `readUInt32LE` existe en production et manque en développement —
 * exactement le genre d'écart qui se découvre après déploiement.
 */
const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => Buffer.from(value),
});

// ---------------------------------------------------------------------------
// Comptes et sessions
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    pseudo: text("pseudo").notNull(),
    passwordHash: text("password_hash").notNull(),
    /**
     * Jeton d'avatar, fabriqué exclusivement par le serveur.
     *
     * Sans préfixe : avatar procédural, la valeur donne la teinte.
     * Préfixé `img:` : une image est stockée dans `user_avatars`, et la valeur
     * sert à la fois de teinte de repli et de version d'URL pour le cache.
     * Le format vit dans `packages/shared/src/avatar.ts`.
     */
    avatarSeed: text("avatar_seed").notNull(),
    /** Réservé : passera à true le jour où un SMTP sera branché. */
    emailVerified: boolean("email_verified").notNull().default(false),
    isBanned: boolean("is_banned").notNull().default(false),
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
    /**
     * Fermeture du compte, par anonymisation.
     *
     * La ligne est conservée : huit tables la référencent en cascade, et les
     * manches partagées avec d'autres joueurs perdraient leur sens si elle
     * disparaissait. Non nul = plus aucune connexion possible.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Unicité insensible à la casse : "Maxou" et "maxou" sont le même pseudo.
    uniqueIndex("users_email_lower_idx").on(sql`lower(${table.email})`),
    uniqueIndex("users_pseudo_lower_idx").on(sql`lower(${table.pseudo})`),
  ],
);

/**
 * Image d'avatar téléversée, 128×128 WebP.
 *
 * Table à part, et pas une colonne de `users` : `resolveSession` est rejouée à
 * chaque requête HTTP **et** à chaque poignée de main Socket.IO. Une colonne
 * binaire sur `users` finirait tôt ou tard dans un `select` distrait, et dix
 * kilo-octets par ligne à ce rythme se paient sur un NAS. Ici, la seule façon
 * de lire l'image est de nommer cette table.
 */
export const userAvatars = pgTable("user_avatars", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  image: bytea("image").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * SHA-256 du jeton envoyé au client. Le jeton en clair n'est jamais stocké :
     * une fuite de la base ne permet pas de rejouer les sessions.
     */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// Jetons virtuels
//
// Aucune passerelle de paiement, aucune conversion en argent réel : les
// MaxouCoin sont un score, pas une monnaie. C'est ce qui garde le site hors du
// champ de la réglementation ANJ sur les jeux d'argent.
//
// Aucun transfert entre comptes non plus : l'inscription étant sans vérification
// email, une fonction de don permettrait de récolter les bonus sur des comptes
// secondaires pour les siphonner vers le compte principal.
// ---------------------------------------------------------------------------

export const wallets = pgTable(
  "wallets",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    // Dernière ligne de défense : même un bug dans un moteur de jeu ne doit
    // pas pouvoir créer un solde négatif. Le service de porte-monnaie
    // conditionne déjà ses débits, cette contrainte les double.
    check("wallets_balance_non_negative", sql`${table.balance} >= 0`),
  ],
);

/**
 * Un encaissement de bonus quotidien, un par jour civil parisien.
 *
 * La clé primaire `(user_id, day)` est le mécanisme d'idempotence : sur deux
 * requêtes concurrentes, la seconde insertion viole la contrainte et devient un
 * refus propre. Aucun verrou applicatif n'est nécessaire.
 */
export const dailyClaims = pgTable(
  "daily_claims",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Jour civil Europe/Paris, au format `AAAA-MM-JJ`. */
    day: date("day").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    /** Série atteinte ce jour-là, conservée pour ne pas la recalculer. */
    streak: integer("streak").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);

export const walletTx = pgTable(
  "wallet_tx",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Positif à l'encaissement, négatif à la mise. */
    delta: bigint("delta", { mode: "number" }).notNull(),
    /** Solde après opération : rend l'historique auditable sans rejouer la somme. */
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    matchId: uuid("match_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [index("wallet_tx_user_created_idx").on(table.userId, table.createdAt)],
);

// ---------------------------------------------------------------------------
// Parties (lots 1 à 4)
// ---------------------------------------------------------------------------

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    game: text("game").notNull(),
    status: text("status").notNull().default("waiting"),
    config: jsonb("config").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [index("matches_game_status_idx").on(table.game, table.status)],
);

export const matchPlayers = pgTable(
  "match_players",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seat: integer("seat").notNull(),
    /** "win" | "loss" | "draw" | "abandon" */
    result: text("result"),
    chipsDelta: bigint("chips_delta", { mode: "number" }).notNull().default(0),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.userId] }),
    index("match_players_user_idx").on(table.userId),
  ],
);

export const stats = pgTable(
  "stats",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    game: text("game").notNull(),
    played: integer("played").notNull().default(0),
    won: integer("won").notNull().default(0),
    lost: integer("lost").notNull().default(0),
    drawn: integer("drawn").notNull().default(0),
    elo: integer("elo").notNull().default(1000),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.game] }),
    index("stats_game_elo_idx").on(table.game, table.elo),
  ],
);

// ---------------------------------------------------------------------------
// Motus (lot 2)
// ---------------------------------------------------------------------------

export const motusWords = pgTable(
  "motus_words",
  {
    word: text("word").primaryKey(),
    length: integer("length").notNull(),
    active: boolean("active").notNull().default(true),
    /** Sous-ensemble courant et familial pouvant être tiré comme solution. */
    isSolution: boolean("is_solution").notNull().default(false),
  },
  (table) => [index("motus_words_length_active_idx").on(table.length, table.active)],
);

/**
 * Le mot d'un créneau de 6 h — 00 h, 06 h, 12 h et 18 h, heure de Paris.
 *
 * `slot_start` est l'instant d'ouverture calculé par `currentMotusSlot()` du
 * paquet partagé : c'est la même borne des deux côtés, jamais recalculée en SQL.
 */
export const motusSlots = pgTable("motus_slots", {
  slotStart: timestamp("slot_start", { withTimezone: true }).primaryKey(),
  word: text("word").notNull(),
  length: integer("length").notNull(),
});

export const motusAttempts = pgTable(
  "motus_attempts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slotStart: timestamp("slot_start", { withTimezone: true }).notNull(),
    guesses: jsonb("guesses").notNull().default([]),
    solved: boolean("solved").notNull().default(false),
    /** Récompense effectivement versée. Empêche un second versement au même créneau. */
    reward: bigint("reward", { mode: "number" }).notNull().default(0),
    /** Version autoritaire, comparée à celle jointe à chaque proposition. */
    version: integer("version").notNull().default(0),
    /** Null tant que la tentative peut être reprise, même après son créneau. */
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.slotStart] }),
    // Une tentative suspendue reste la seule tentative Motus ouverte du compte.
    uniqueIndex("motus_attempts_user_active_idx")
      .on(table.userId)
      .where(sql`${table.finishedAt} is null`),
  ],
);

// ---------------------------------------------------------------------------
// Chat (lot 5)
// ---------------------------------------------------------------------------

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    room: text("room").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [index("chat_messages_room_created_idx").on(table.room, table.createdAt)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
