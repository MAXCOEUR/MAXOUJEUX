/**
 * Contrat des tables et des parties — lot 1.
 *
 * Ce fichier est la frontière entre le front et l'API : les types décrivent ce
 * qui transite réellement sur la socket, les schémas Zod sont utilisés par le
 * front pour un retour immédiat **et rejoués par le serveur**, qui ne fait
 * jamais confiance au client.
 *
 * Les durées sont ici et nulle part ailleurs : le front en a besoin pour
 * dimensionner l'anneau de temps, le serveur pour armer ses minuteries. Deux
 * constantes séparées finiraient par diverger d'une seconde, et l'anneau se
 * viderait avant le forfait — ou l'inverse.
 */

import { z } from "zod";
import { getGame, type GameCode } from "./games.js";

/** Temps accordé pour jouer un coup. Passé ce délai, le joueur perd la partie. */
export const TURN_MS = 30_000;

/**
 * Sursis après la perte de la dernière socket d'un joueur.
 *
 * Un rechargement de page, un tunnel de métro ou un passage du Wi-Fi à la 4G
 * ne doivent pas coûter une mise. Au-delà, la partie est déclarée abandonnée.
 */
export const GRACE_MS = 45_000;

/**
 * Durée de vie d'une table qui n'a jamais trouvé d'adversaire.
 *
 * Sans ce délai, un joueur qui ouvre une table puis ferme l'onglet immobilise
 * une place du plafond et laisse sa mise bloquée indéfiniment.
 */
export const WAITING_TTL_MS = 600_000;

/** Sièges d'une table de duel. Le siège 0 joue toujours en premier. */
export type Seat = 0 | 1;

/** Contenu d'une case : le siège qui l'occupe, ou rien. */
export type Cell = Seat | null;

export type TableStatus = "waiting" | "playing" | "finished" | "cancelled";

/** Cause de la fin d'une partie. */
export type EndReason = "line" | "draw" | "timeout" | "abandon";

export interface TableSeat {
  seat: Seat;
  userId: string;
  pseudo: string;
  avatarSeed: string;
  /**
   * Le joueur a-t-il au moins une socket ouverte ?
   * Un siège déconnecté est en sursis (`GRACE_MS`), pas encore perdu.
   */
  connected: boolean;
}

/** Table telle qu'elle apparaît dans la liste d'un salon. */
export interface TableSummary {
  id: string;
  game: GameCode;
  stake: number;
  status: TableStatus;
  seats: TableSeat[];
  maxSeats: number;
  createdAt: string;
}

/**
 * Le destinataire est-il assis à cette table ?
 *
 * Calculé côté client : le front connaît son propre identifiant, et faire
 * porter l'information par l'instantané obligerait le serveur à émettre un
 * message personnalisé par socket au lieu d'un seul par salon.
 */
export function isMyTable(table: TableSummary, userId: string): boolean {
  return table.seats.some((seat) => seat.userId === userId);
}

/** Instantané complet d'un salon, poussé à tous ses observateurs. */
export interface SalonSnapshot {
  game: GameCode;
  tables: TableSummary[];
  /** Tables vivantes et plafond du jeu, pour afficher « 3 / 10 ». */
  used: number;
  max: number;
  /**
   * Horloge du serveur au moment de l'envoi.
   * Le front s'en sert pour corriger la dérive de l'horloge locale : un
   * téléphone réglé trente secondes en avance afficherait sinon un tour déjà
   * expiré alors que le serveur attend encore.
   */
  now: string;
}

/** Comptage par jeu affiché sur les cartes du lobby. */
export interface TableCounts {
  waiting: number;
  playing: number;
  max: number;
}

export interface MatchOutcome {
  reason: EndReason;
  /** `null` en cas d'égalité. */
  winnerSeat: Seat | null;
  /** Gain net par siège, en MaxouCoin. Négatif pour une mise perdue. */
  deltas: { seat: Seat; delta: number }[];
}

/**
 * État d'une partie, **filtré pour son destinataire**.
 *
 * Le Puissance 4 et le Morpion n'ont aucune information cachée : la vue est
 * donc identique pour les deux joueurs, à l'exception de `you`. La signature
 * reste celle qu'imposeront le Motus et le poker, pour que la couche transport
 * n'ait pas à changer de forme au lot 4.
 */
export interface MatchView {
  id: string;
  game: GameCode;
  stake: number;
  /** Somme engagée sur la table, en MaxouCoin. */
  pot: number;
  status: TableStatus;
  seats: TableSeat[];
  /** Siège du destinataire. `null` pour un spectateur — non utilisé au lot 1. */
  you: Seat | null;

  rows: number;
  cols: number;
  /** Grille aplatie : index = ligne × `cols` + colonne, ligne 0 en haut. */
  cells: Cell[];
  /** Siège au trait, `null` si la partie n'est pas en cours. */
  turn: Seat | null;
  /** Cases alignées, une fois la partie gagnée. */
  winningLine: number[] | null;
  /** Dernier coup joué, pour n'animer que celui-là. */
  lastMove: { index: number; seat: Seat } | null;

  /** Échéance du tour courant, en ISO. C'est le serveur qui tranche. */
  deadlineAt: string | null;
  /** Durée nominale d'un tour, pour dimensionner l'anneau de temps. */
  turnMs: number;

  outcome: MatchOutcome | null;

  /**
   * Numéro de séquence croissant.
   *
   * Sert deux fois : le client rejette un état plus vieux que celui qu'il
   * affiche (les messages peuvent se croiser après une reconnexion), et le
   * serveur rejette un coup calculé sur un état périmé.
   */
  version: number;
  now: string;
}

// ---------------------------------------------------------------------------
// Codes d'erreur métier
// ---------------------------------------------------------------------------

export const TABLE_ERROR_CODES = [
  "TABLE_FULL",
  "TABLE_GONE",
  "CAPACITY_REACHED",
  "ALREADY_IN_GAME",
  "NOT_IN_GAME",
  "STAKE_INVALID",
  "STALE_STATE",
  "NOT_YOUR_TURN",
  "ILLEGAL_MOVE",
  "GAME_OVER",
] as const;

export type TableErrorCode = (typeof TABLE_ERROR_CODES)[number];

/**
 * Messages affichés au joueur. Un « erreur » générique ne dit pas s'il faut
 * réessayer, encaisser son bonus ou attendre : chaque cas a son message.
 */
export const TABLE_ERROR_LABELS: Record<TableErrorCode, string> = {
  TABLE_FULL: "Quelqu'un a été plus rapide, cette table est complète.",
  TABLE_GONE: "Cette table n'existe plus.",
  CAPACITY_REACHED: "Toutes les tables de ce jeu sont prises. Rejoins-en une ou reviens dans un instant.",
  ALREADY_IN_GAME: "Tu es déjà à une table. Termine ta partie avant d'en ouvrir une autre.",
  NOT_IN_GAME: "Tu n'es pas à cette table.",
  STAKE_INVALID: "Cette mise n'est pas autorisée.",
  STALE_STATE: "La partie a avancé entre-temps. Regarde le plateau.",
  NOT_YOUR_TURN: "Ce n'est pas ton tour.",
  ILLEGAL_MOVE: "Ce coup n'est pas jouable.",
  GAME_OVER: "La partie est terminée.",
};

/**
 * Réponse à une intention, transportée par l'accusé de réception Socket.IO.
 *
 * Un ack plutôt qu'un événement d'erreur global : le front doit savoir
 * *quelle* action a été refusée pour l'afficher sous le bouton concerné, et non
 * dans une notification détachée du geste.
 */
export type ActionReply<T = null> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

// ---------------------------------------------------------------------------
// Validation des intentions
// ---------------------------------------------------------------------------

/** Jeux ouverts au lot 1. Les autres codes sont refusés par le serveur. */
export const DUEL_GAMES = ["connect4", "tictactoe"] as const;
export type DuelGame = (typeof DUEL_GAMES)[number];

export const createTableSchema = z.object({
  game: z.enum(DUEL_GAMES),
  stake: z.number().int(),
});

export const tableRefSchema = z.object({
  tableId: z.string().uuid(),
});

export const playSchema = tableRefSchema.extend({
  /** Colonne pour le Puissance 4, index de case pour le Morpion. */
  move: z.number().int().min(0).max(41),
  /** Version d'état sur laquelle le joueur a cliqué. */
  version: z.number().int().nonnegative(),
});

export const watchSchema = z.object({
  game: z.enum(DUEL_GAMES),
});

export type CreateTableInput = z.infer<typeof createTableSchema>;
export type TableRefInput = z.infer<typeof tableRefSchema>;
export type PlayInput = z.infer<typeof playSchema>;

/**
 * Mises proposées pour un jeu, du minimum au maximum par pas.
 *
 * Le front construit son sélecteur là-dessus et le serveur valide contre la
 * même liste : impossible d'engager 37 MaxouCoin en modifiant la requête.
 */
export function stakeOptions(game: GameCode): number[] {
  const definition = getGame(game);
  if (!definition) return [];
  const { min, max, step } = definition.wager;
  if (!step || step <= 0) return min === max ? [min] : [min, max];

  const options: number[] = [];
  for (let value = min; value <= max; value += step) options.push(value);
  return options;
}

/**
 * La mise est-elle autorisée pour ce jeu ?
 *
 * Le front s'en sert pour griser un bouton, le serveur pour refuser une
 * requête forgée. Les deux appellent la même fonction : un contrôle client
 * seul ne protège de rien.
 */
export function isValidStake(game: GameCode, stake: number): boolean {
  const definition = getGame(game);
  if (!definition) return false;
  if (!Number.isInteger(stake)) return false;

  const { min, max, step } = definition.wager;
  if (stake < min || stake > max) return false;
  return !step || (stake - min) % step === 0;
}

/** Gain brut versé au vainqueur, mise comprise. */
export function winPayout(game: GameCode, stake: number): number {
  const multiplier = getGame(game)?.wager.winMultiplier ?? 1;
  // Le pas de 10 MC garantit un résultat entier avec un multiplicateur de 1,5.
  // Un barème futur qui casserait cette propriété doit échouer bruyamment
  // plutôt que d'arrondir en silence au détriment du joueur.
  const payout = stake * multiplier;
  if (!Number.isInteger(payout)) {
    throw new Error(`Gain non entier pour une mise de ${stake} (× ${multiplier})`);
  }
  return payout;
}
