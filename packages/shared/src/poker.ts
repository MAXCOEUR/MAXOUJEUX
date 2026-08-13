import { z } from "zod";

/**
 * Texas Hold'em — contrat partagé.
 *
 * Les cartes, le classement des mains et les libellés vivent ici plutôt que
 * dans le moteur : le front doit pouvoir écrire « Full aux rois par les huit »
 * sans dépendre des règles, et le moteur doit parler le même langage de cartes
 * que l'écran.
 */

/** Rangs par force croissante : l'index **est** la force. */
export const POKER_RANKS = [
  "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A",
] as const;

export const POKER_SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;

export type PokerRank = (typeof POKER_RANKS)[number];
export type PokerSuit = (typeof POKER_SUITS)[number];

export interface PokerCard {
  rank: PokerRank;
  suit: PokerSuit;
}

/** Catégories de la plus faible à la plus forte : l'index sert au score. */
export const POKER_CATEGORIES = [
  "carte-haute",
  "paire",
  "double-paire",
  "brelan",
  "suite",
  "couleur",
  "full",
  "carre",
  "quinte-flush",
] as const;

export type PokerCategory = (typeof POKER_CATEGORIES)[number];

export const POKER_CATEGORY_LABELS: Record<PokerCategory, string> = {
  "carte-haute": "Carte haute",
  paire: "Paire",
  "double-paire": "Double paire",
  brelan: "Brelan",
  suite: "Suite",
  couleur: "Couleur",
  full: "Full",
  carre: "Carré",
  "quinte-flush": "Quinte flush",
};

/**
 * Les combinaisons **du plus fort au plus faible**, telles qu'on les affiche.
 *
 * L'ordre du tableau est celui du tableau d'aide à l'écran : c'est la seule
 * source, pour qu'une retouche du classement ne laisse pas une aide fausse.
 */
export const POKER_RANKING = [...POKER_CATEGORIES].reverse() as readonly PokerCategory[];

export const POKER_RANK_LABELS: Record<PokerRank, string> = {
  "2": "deux", "3": "trois", "4": "quatre", "5": "cinq", "6": "six", "7": "sept",
  "8": "huit", "9": "neuf", "10": "dix", J: "valet", Q: "dame", K: "roi", A: "as",
};

/** Nom d'un rang par son index de force. */
export function pokerRankLabel(index: number): string {
  const rank = POKER_RANKS[index];
  return rank ? POKER_RANK_LABELS[rank] : "";
}

export interface PokerHandRankView {
  category: PokerCategory;
  /** Rangs signifiants, du plus déterminant au moins. */
  ranks: number[];
}

/**
 * Écrit une main en toutes lettres.
 *
 * « Quinte flush royale » est un cas d'affichage, pas une catégorie : le
 * classement ne la distingue pas d'une quinte flush à l'as, et l'inventer
 * casserait la comparaison des mains.
 */
export function pokerHandLabel(rank: PokerHandRankView): string {
  const [premier, second] = rank.ranks;
  const nom = (index: number | undefined) => (index === undefined ? "" : pokerRankLabel(index));

  switch (rank.category) {
    case "quinte-flush":
      return premier === 12 ? "Quinte flush royale" : `Quinte flush au ${nom(premier)}`;
    case "carre":
      return `Carré de ${nom(premier)}s`;
    case "full":
      return `Full aux ${nom(premier)}s par les ${nom(second)}s`;
    case "couleur":
      return `Couleur à l'${nom(premier) === "as" ? "as" : nom(premier)}`;
    case "suite":
      return `Suite au ${nom(premier)}`;
    case "brelan":
      return `Brelan de ${nom(premier)}s`;
    case "double-paire":
      return `Deux paires, ${nom(premier)}s et ${nom(second)}s`;
    case "paire":
      return `Paire de ${nom(premier)}s`;
    case "carte-haute":
      return `${nom(premier)?.charAt(0).toUpperCase()}${nom(premier)?.slice(1)} haut`;
  }
}

// ---------------------------------------------------------------------------
// Durées et plafonds
// ---------------------------------------------------------------------------

export const POKER_MIN_SEATS = 2;
export const POKER_MAX_SEATS = 9;
/** Temps de décision. À l'expiration : check si c'est gratuit, sinon couche. */
export const POKER_ACTION_MS = 30_000;
/** Respiration entre deux rues, pour que le tableau se lise. */
export const POKER_STREET_PAUSE_MS = 1_400;
/** Récapitulatif de fin de coup — et fenêtre de recave. */
export const POKER_HAND_BREAK_MS = 6_000;
export const POKER_DISCONNECT_GRACE_MS = 45_000;
export const POKER_MAX_WATCHERS = 20;
/** Mains à zéro jeton avant d'être levé de table. */
export const POKER_BROKE_HANDS_MAX = 3;
export const POKER_BLIND_MIN = 5;

export type PokerActionKind = "fold" | "check" | "call" | "bet" | "raise" | "allin";
export const POKER_ACTION_KINDS = ["fold", "check", "call", "bet", "raise", "allin"] as const;

export const POKER_ACTION_LABELS: Record<PokerActionKind, string> = {
  fold: "Se couche",
  check: "Parole",
  call: "Suit",
  bet: "Mise",
  raise: "Relance",
  allin: "Tapis",
};

export type PokerPhase =
  | "waiting"
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "payout";

export const POKER_PHASE_LABELS: Record<PokerPhase, string> = {
  waiting: "En attente de joueurs",
  preflop: "Préflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Abattage",
  payout: "Fin du coup",
};

// ---------------------------------------------------------------------------
// Réglages de la table
// ---------------------------------------------------------------------------

export interface PokerTableConfig {
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  /** `null` : pas de plafond de cave. */
  maxBuyIn: number | null;
  seats: number;
}

export const pokerTableConfigSchema = z
  .object({
    smallBlind: z.number().int().min(POKER_BLIND_MIN),
    bigBlind: z.number().int().min(POKER_BLIND_MIN * 2),
    minBuyIn: z.number().int().positive(),
    maxBuyIn: z.number().int().positive().nullable(),
    seats: z.number().int().min(POKER_MIN_SEATS).max(POKER_MAX_SEATS),
  })
  .refine((config) => config.bigBlind === config.smallBlind * 2, {
    message: "La grosse blinde vaut le double de la petite.",
    path: ["bigBlind"],
  })
  .refine((config) => config.minBuyIn >= config.bigBlind * 10, {
    message: "La cave minimale doit couvrir au moins dix grosses blindes.",
    path: ["minBuyIn"],
  })
  .refine((config) => config.maxBuyIn === null || config.maxBuyIn >= config.minBuyIn, {
    message: "La cave maximale ne peut pas être inférieure à la minimale.",
    path: ["maxBuyIn"],
  });

/** Réglages par défaut proposés à l'ouverture. */
export const POKER_DEFAULT_CONFIG: PokerTableConfig = {
  smallBlind: 10,
  bigBlind: 20,
  minBuyIn: 500,
  maxBuyIn: 5_000,
  seats: 6,
};

// ---------------------------------------------------------------------------
// Vue, filtrée par destinataire
// ---------------------------------------------------------------------------

export type PokerSeatStatus =
  | "active"
  | "folded"
  | "allin"
  | "sitting-out"
  | "waiting"
  | "broke";

export interface PokerSeatView {
  seat: number;
  userId: string;
  pseudo: string;
  avatarSeed: string;
  connected: boolean;
  stack: number;
  /** Engagé sur la rue en cours, posé devant le siège. */
  committed: number;
  status: PokerSeatStatus;
  /**
   * Cartes privées.
   *
   * `null` partout sauf pour leur propriétaire, ou à l'abattage pour ceux qui
   * ont abattu. Une carte cachée ne quitte jamais le serveur : le masquage
   * n'est pas un effet de style côté client.
   */
  cards: (PokerCard | null)[];
  /** Renseigné à l'abattage seulement. */
  hand: PokerHandRankView | null;
  handLabel: string | null;
  /** Les cinq cartes qui composent la main, pour les mettre en avant. */
  bestCards: PokerCard[] | null;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  lastAction: { kind: PokerActionKind; amount: number } | null;
  /** Gain du coup, une fois la main terminée. */
  won: number | null;
  leavingAfterHand: boolean;
}

export interface PokerWatcherView {
  userId: string;
  pseudo: string;
  avatarSeed: string;
}

export interface PokerPotView {
  amount: number;
  eligible: number[];
}

export interface PokerView {
  id: string;
  game: "poker";
  phase: PokerPhase;
  config: PokerTableConfig;
  /** Blindes qui prendront effet à la main suivante, si le créateur les a changées. */
  pendingConfig: PokerTableConfig | null;
  seats: PokerSeatView[];
  maxSeats: number;
  watchers: PokerWatcherView[];
  /** Siège du destinataire. `null` : il regarde. */
  you: number | null;
  isHost: boolean;
  board: PokerCard[];
  pots: PokerPotView[];
  potTotal: number;
  turn: number | null;
  /** Renseigné uniquement quand c'est au destinataire de parler. */
  allowed: {
    actions: PokerActionKind[];
    callAmount: number;
    minRaiseTo: number;
    maxRaiseTo: number;
  } | null;
  /** Bornes de cave si le destinataire peut se caver maintenant. */
  buyInRange: { min: number; max: number | null } | null;
  deadlineAt: string | null;
  actionMs: number;
  version: number;
  now: string;
}

// ---------------------------------------------------------------------------
// Intentions
// ---------------------------------------------------------------------------

const tableRef = z.object({ tableId: z.string().uuid() });

/**
 * Prendre une place.
 *
 * Aucun numéro de version : la version change à chaque carte distribuée, et un
 * garde de version ferait échouer une prise de place au milieu d'une main alors
 * que la chaise est libre. Même raison qu'au blackjack.
 */
export const pokerSitSchema = tableRef.extend({
  seat: z.number().int().min(0).max(POKER_MAX_SEATS - 1),
  buyIn: z.number().int().positive(),
});

export const pokerRebuySchema = tableRef.extend({
  amount: z.number().int().positive(),
});

export const pokerActSchema = tableRef.extend({
  version: z.number().int().nonnegative(),
  action: z.enum(POKER_ACTION_KINDS),
  /** Montant **total** visé pour une mise ou une relance, jamais un delta. */
  amount: z.number().int().nonnegative().optional(),
});

export const pokerBlindsSchema = tableRef.extend({
  smallBlind: z.number().int().min(POKER_BLIND_MIN),
  bigBlind: z.number().int().min(POKER_BLIND_MIN * 2),
});

export const pokerTableRefSchema = tableRef;
export const pokerSitOutSchema = tableRef.extend({ out: z.boolean() });

export type PokerSitInput = z.infer<typeof pokerSitSchema>;
export type PokerRebuyInput = z.infer<typeof pokerRebuySchema>;
export type PokerActInput = z.infer<typeof pokerActSchema>;
export type PokerBlindsInput = z.infer<typeof pokerBlindsSchema>;
export type PokerTableRefInput = z.infer<typeof pokerTableRefSchema>;
export type PokerSitOutInput = z.infer<typeof pokerSitOutSchema>;

export const POKER_ERROR_LABELS = {
  POKER_SEAT_TAKEN: "Cette place vient d'être prise.",
  POKER_ALREADY_SEATED: "Tu es déjà assis à cette table.",
  POKER_NOT_SEATED: "Tu n'es pas assis à cette table.",
  POKER_NOT_YOUR_TURN: "Ce n'est pas à toi de parler.",
  POKER_ACTION_INVALID: "Cette action n'est pas permise ici.",
  POKER_BUYIN_INVALID: "Cette cave n'est pas dans les bornes de la table.",
  POKER_REBUY_CLOSED: "On ne se recave qu'entre deux mains.",
  POKER_NOT_HOST: "Seul le créateur de la table règle les blindes.",
  POKER_WATCHERS_FULL: "Il y a déjà trop de spectateurs à cette table.",
} as const;
