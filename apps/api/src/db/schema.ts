import { sql } from "drizzle-orm";
import type { BanKind, UserRole } from "@maxoujeux/shared";
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
    role: text("role").$type<UserRole>().notNull().default("player"),
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
    uniqueIndex("users_single_admin_idx").on(table.role).where(sql`${table.role} = 'admin'`),
    check("users_role_valid", sql`${table.role} in ('player', 'moderator', 'admin')`),
    check(
      "users_admin_compat_synced",
      sql`${table.isAdmin} = (${table.role} = 'admin')`,
    ),
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
    deviceHash: text("device_hash"),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

/** Connexions observées, utilisables comme cibles de modération. */
export const accountAccesses = pgTable(
  "account_accesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ip: text("ip").notNull(),
    /** HMAC-SHA-256 de l'empreinte navigateur. Jamais le visitorId brut. */
    deviceHash: text("device_hash"),
    userAgent: text("user_agent"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(now),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [index("account_accesses_user_seen_idx").on(table.userId, table.lastSeenAt)],
);

/** Bannissements réversibles. Une révocation conserve la ligne d'audit. */
export const moderationBans = pgTable(
  "moderation_bans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<BanKind>().notNull(),
    /** Identifiant du compte pour un ban compte, conservé même après suppression. */
    targetUserId: uuid("target_user_id"),
    /** userId, IP normalisée ou HMAC machine selon `kind`. */
    targetValue: text("target_value").notNull(),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by"),
  },
  (table) => [
    check("moderation_bans_kind_valid", sql`${table.kind} in ('account', 'ip', 'device')`),
    index("moderation_bans_target_idx").on(table.kind, table.targetValue),
    index("moderation_bans_account_idx").on(table.targetUserId, table.createdAt),
  ],
);

/** Journal des actions sensibles du personnel, sans secret ni mot de passe. */
export const staffAuditLog = pgTable(
  "staff_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),
    targetUserId: uuid("target_user_id"),
    details: jsonb("details").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [index("staff_audit_log_actor_created_idx").on(table.actorUserId, table.createdAt)],
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

/**
 * Cumuls **depuis toujours**, un poste par joueur et par jeu.
 *
 * Sert les classements « depuis toujours » et les profils sans avoir à sommer
 * `game_stats_daily` sur des années de lignes. Les deux tables sont écrites dans
 * la même transaction par `modules/stats/service.ts` : aucune ne peut avancer
 * sans l'autre.
 *
 * Il n'y a **pas** de colonne d'Elo. Elle a existé, n'a jamais été écrite, et le
 * classement ne repose plus sur un score de compétence : sur neuf jeux dont sept
 * relèvent du hasard, un Elo mesurerait surtout la chance.
 */
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
    /** Total engagé et total encaissé, mises comprises. */
    wagered: bigint("wagered", { mode: "number" }).notNull().default(0),
    returned: bigint("returned", { mode: "number" }).notNull().default(0),
    /**
     * `returned - wagered`, entretenu en même temps que les deux.
     *
     * Redondant par construction, mais c'est la colonne sur laquelle porte le
     * tri de tous les classements : la calculer à la volée interdirait l'index.
     */
    net: bigint("net", { mode: "number" }).notNull().default(0),
    /** Meilleur gain **net** sur une seule manche. */
    bestWin: bigint("best_win", { mode: "number" }).notNull().default(0),
    /** Victoires consécutives en cours, remises à zéro à la première défaite. */
    winStreak: integer("win_streak").notNull().default(0),
    bestWinStreak: integer("best_win_streak").notNull().default(0),
    /** Motus : meilleur chrono et meilleur nombre d'essais. Nuls ailleurs. */
    bestTimeMs: bigint("best_time_ms", { mode: "number" }),
    bestAttempts: integer("best_attempts"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.game] }),
    index("stats_game_net_idx").on(table.game, table.net),
  ],
);

/**
 * Les mêmes cumuls, découpés par **jour civil parisien**.
 *
 * C'est la table qui rend les classements par période possibles : jour, semaine,
 * mois et année sont tous une somme sur une plage de `day`. Les bornes viennent
 * de `periodRange()` du paquet partagé, jamais d'un `date_trunc` SQL — celui-ci
 * travaillerait dans le fuseau du serveur PostgreSQL.
 *
 * Sommer `wallet_tx` aurait évité cette table, mais ne dit rien du nombre de
 * manches : le blackjack débite plusieurs fois par manche, et le poker joue ses
 * mains en jetons sans toucher au porte-monnaie.
 */
export const gameStatsDaily = pgTable(
  "game_stats_daily",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    game: text("game").notNull(),
    /** Jour civil Europe/Paris, au format `AAAA-MM-JJ`, comme `daily_claims`. */
    day: date("day").notNull(),
    rounds: integer("rounds").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    wagered: bigint("wagered", { mode: "number" }).notNull().default(0),
    returned: bigint("returned", { mode: "number" }).notNull().default(0),
    net: bigint("net", { mode: "number" }).notNull().default(0),
    bestWin: bigint("best_win", { mode: "number" }).notNull().default(0),
    /** Temps de jeu cumulé, en millisecondes. Renseigné par le Motus. */
    durationMs: bigint("duration_ms", { mode: "number" }).notNull().default(0),
    bestTimeMs: bigint("best_time_ms", { mode: "number" }),
    bestAttempts: integer("best_attempts"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.game, table.day] }),
    // Classement d'un jeu sur une période : on filtre par jeu et plage de jours.
    index("game_stats_daily_game_day_idx").on(table.game, table.day),
    // Classement global sur une période : la plage de jours seule.
    index("game_stats_daily_day_idx").on(table.day),
  ],
);

/**
 * Progression et déblocage des succès.
 *
 * `progress` ne conserve que le **maximum jamais atteint** : une évaluation
 * rejouée après une reprise ne fait donc jamais reculer une barre. `unlocked_at`
 * non nul vaut « prime déjà versée » — c'est la clause `unlocked_at is null` de
 * l'UPDATE de déblocage qui garantit qu'elle ne l'est qu'une fois.
 */
export const userAchievements = pgTable(
  "user_achievements",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Code du catalogue de `packages/shared/src/achievements.ts`. */
    code: text("code").notNull(),
    progress: integer("progress").notNull().default(0),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.code] }),
    index("user_achievements_unlocked_idx")
      .on(table.userId, table.unlockedAt)
      .where(sql`${table.unlockedAt} is not null`),
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
 * Le mot d'un créneau de 12 h — 00 h et 12 h, heure civile de Paris.
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
    /**
     * Mise engagée sur cette tentative.
     *
     * Portée par la ligne et non par une constante : la mise est libre depuis
     * que le prix fixe a disparu, et le barème verse un multiple de ce montant.
     * La valeur par défaut est l'ancien prix, pour que les tentatives d'avant la
     * migration gardent un versement cohérent.
     */
    stake: bigint("stake", { mode: "number" }).notNull().default(100),
    /**
     * Départ du chrono, pour le classement à l'essai puis au temps.
     *
     * Distinct de `updated_at`, qui bouge à chaque proposition : seul l'instant
     * du premier engagement mesure la réflexion du joueur.
     */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(now),
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
// Roue de la fortune (lot 4)
// ---------------------------------------------------------------------------

/**
 * Historique des lancers de roue.
 *
 * C'est cette table, et non un minuteur en mémoire, qui porte la règle du lancer
 * quotidien : un redémarrage de l'API ne doit pas offrir un second lancer. Le
 * dernier `spun_at` du compte suffit à trancher — il est comparé au jour civil
 * parisien courant, pas à un délai écoulé.
 *
 * Chaque ligne conserve aussi de quoi rejouer l'économie : mise, secteur atteint
 * et versement. Un multiplicateur mal réglé se retrouve alors dans l'historique
 * plutôt que seulement dans les soldes.
 */
export const wheelSpins = pgTable(
  "wheel_spins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stake: bigint("stake", { mode: "number" }).notNull(),
    /** Index du secteur atteint : il commande l'angle d'arrêt à l'écran. */
    segment: integer("segment").notNull(),
    /** Multiplicateur en dixièmes, recopié pour survivre à un changement de barème. */
    multiplierTenths: integer("multiplier_tenths").notNull(),
    payout: bigint("payout", { mode: "number" }).notNull(),
    spunAt: timestamp("spun_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [index("wheel_spins_user_spun_idx").on(table.userId, table.spunAt)],
);

// ---------------------------------------------------------------------------
// Plinko (lot 5)
// ---------------------------------------------------------------------------

/**
 * Historique des chutes de Plinko.
 *
 * Le trajet est conservé tel qu'il a été tiré : c'est la seule façon de
 * reconstituer une partie contestée, l'animation du front n'étant qu'un rejeu
 * de ces douze rebonds.
 */
export const plinkoDrops = pgTable(
  "plinko_drops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stake: bigint("stake", { mode: "number" }).notNull(),
    risk: text("risk").notNull(),
    /** Fente d'arrivée, de 0 à 12. */
    slot: integer("slot").notNull(),
    /** Les douze rebonds, dans l'ordre. */
    path: jsonb("path").notNull(),
    multiplierTenths: integer("multiplier_tenths").notNull(),
    payout: bigint("payout", { mode: "number" }).notNull(),
    droppedAt: timestamp("dropped_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [index("plinko_drops_user_dropped_idx").on(table.userId, table.droppedAt)],
);

// ---------------------------------------------------------------------------
// Machine à sous (lot 6)
// ---------------------------------------------------------------------------

/**
 * Historique des tirages de machine à sous.
 *
 * La ligne tirée est conservée telle quelle : c'est la seule façon de
 * reconstituer un tirage contesté, l'animation des rouleaux n'étant qu'un rejeu
 * de ces trois symboles.
 */
export const slotSpins = pgTable(
  "slot_spins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stake: bigint("stake", { mode: "number" }).notNull(),
    /** Les trois symboles, de gauche à droite, par leur index de barème. */
    reels: jsonb("reels").notNull(),
    /** `triple`, `pair` ou `none` : ce que la ligne a payé. */
    kind: text("kind").notNull(),
    /** Multiplicateur en dixièmes, recopié pour survivre à un changement de barème. */
    multiplierTenths: integer("multiplier_tenths").notNull(),
    payout: bigint("payout", { mode: "number" }).notNull(),
    spunAt: timestamp("spun_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [index("slot_spins_user_spun_idx").on(table.userId, table.spunAt)],
);

// ---------------------------------------------------------------------------
// Chat (lot 8)
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
