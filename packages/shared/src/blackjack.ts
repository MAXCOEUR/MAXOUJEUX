import { z } from "zod";

export const BLACKJACK_BETTING_MS = 20_000;
export const BLACKJACK_INSURANCE_MS = 15_000;
export const BLACKJACK_ACTION_MS = 30_000;
/** Règlement des gains avant la manche suivante. Voir `ROULETTE_RESULT_MS`. */
export const BLACKJACK_RESULT_MS = 2_000;
export const BLACKJACK_DISCONNECT_GRACE_MS = 45_000;
export const BLACKJACK_MAX_HANDS = 4;
/**
 * Mise minimale et pas entre deux mises.
 *
 * **Il n'y a plus de plafond** : le seul maximum est le solde du joueur. Le pas
 * de 10 n'en est pas un — il garantit que le 3:2 d'un blackjack tombe toujours
 * sur un entier.
 */
export const BLACKJACK_BET_MIN = 10;
export const BLACKJACK_BET_STEP = 10;

/** Jetons proposés d'un geste. La saisie libre reste ouverte au-delà. */
export const BLACKJACK_BET_OPTIONS = [10, 50, 100, 250, 500, 1_000, 2_500] as const;
export const BLACKJACK_MAX_SEATS = 5;

/**
 * Manches consécutives sans miser avant qu'un joueur assis soit levé.
 *
 * Il n'existe qu'une table de blackjack pour tout le site, et cinq places : un
 * siège tenu par quelqu'un qui ne mise jamais prive un vrai joueur. Sauter une
 * manche reste normal — on regarde le sabot, on va chercher à boire — d'où le
 * délai plutôt qu'une éviction immédiate.
 */
export const BLACKJACK_IDLE_ROUNDS_MAX = 3;

/**
 * Spectateurs simultanés.
 *
 * Chaque état publié calcule une vue par destinataire ; cette boucle n'a aucune
 * raison d'être illimitée sur un NAS à 512 Mo.
 */
export const BLACKJACK_MAX_WATCHERS = 20;

export const BLACKJACK_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const BLACKJACK_SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export const BLACKJACK_ACTIONS = ["hit", "stand", "double", "split"] as const;

export type BlackjackRank = (typeof BLACKJACK_RANKS)[number];
export type BlackjackSuit = (typeof BLACKJACK_SUITS)[number];
export type BlackjackAction = (typeof BLACKJACK_ACTIONS)[number];
export type BlackjackPhase = "idle" | "betting" | "insurance" | "players" | "dealer" | "result";
export type BlackjackHandStatus = "playing" | "stood" | "busted" | "blackjack" | "won" | "lost" | "push";

export interface BlackjackCard {
  rank: BlackjackRank;
  suit: BlackjackSuit;
}

export interface BlackjackHandView {
  cards: BlackjackCard[];
  wager: number;
  total: number;
  soft: boolean;
  status: BlackjackHandStatus;
  payout: number | null;
  net: number | null;
}

export interface BlackjackSeatView {
  seat: number;
  userId: string;
  pseudo: string;
  avatarSeed: string;
  connected: boolean;
  participating: boolean;
  initialBet: number | null;
  insurance: number;
  totalWager: number;
  hands: BlackjackHandView[];
  roundNet: number | null;
  /**
   * Manches d'affilée sans miser. Sert à prévenir avant de lever : un joueur
   * dépossédé de sa place sans préavis conclura à un bug.
   */
  idleRounds: number;
  /** Le joueur a demandé à se lever, mais sa mise est engagée : il partira au règlement. */
  standingAfterRound: boolean;
}

export interface BlackjackDealerView {
  /** `null` est le dos de la carte. Aucune donnée de la carte fermée ne transite. */
  cards: (BlackjackCard | null)[];
  total: number | null;
  soft: boolean | null;
}

export interface BlackjackView {
  id: string;
  game: "blackjack";
  phase: BlackjackPhase;
  seats: BlackjackSeatView[];
  maxSeats: 5;
  /** Numéro de siège du destinataire. `null` : il regarde sans jouer. */
  you: number | null;
  /** Spectateurs présents, soi-même compris. */
  watching: number;
  roundId: string | null;
  dealer: BlackjackDealerView;
  turn: { seat: number; handIndex: number } | null;
  allowedActions: BlackjackAction[];
  insuranceCost: number | null;
  deadlineAt: string | null;
  shoeRemaining: number;
  version: number;
  now: string;
}

export const blackjackTableRefSchema = z.object({ tableId: z.string().uuid() });

/**
 * Prendre une place.
 *
 * **Aucun numéro de version ici**, contrairement aux mises et aux actions. La
 * version change à chaque carte distribuée ; un garde de version ferait échouer
 * une prise de place au beau milieu d'une manche alors que la chaise est bel et
 * bien libre. La disponibilité se vérifie sur la carte des sièges, de façon
 * synchrone côté serveur — un garde de version ne protégerait de rien de plus.
 */
export const blackjackSitSchema = blackjackTableRefSchema.extend({
  seat: z.number().int().min(0).max(BLACKJACK_MAX_SEATS - 1),
});

const tableVersionSchema = z.object({
  tableId: z.string().uuid(),
  version: z.number().int().nonnegative(),
});

export const blackjackBetSchema = tableVersionSchema.extend({
  amount: z
    .number()
    .int()
    .min(BLACKJACK_BET_MIN)
    .refine((amount) => amount % BLACKJACK_BET_STEP === 0, {
      message: `La mise doit être un multiple de ${BLACKJACK_BET_STEP}.`,
    }),
});

export const blackjackInsuranceSchema = tableVersionSchema.extend({
  take: z.boolean(),
});

export const blackjackActionSchema = tableVersionSchema.extend({
  handIndex: z.number().int().min(0).max(BLACKJACK_MAX_HANDS - 1),
  action: z.enum(BLACKJACK_ACTIONS),
});

export type BlackjackBetInput = z.infer<typeof blackjackBetSchema>;
export type BlackjackInsuranceInput = z.infer<typeof blackjackInsuranceSchema>;
export type BlackjackActionInput = z.infer<typeof blackjackActionSchema>;
export type BlackjackSitInput = z.infer<typeof blackjackSitSchema>;
export type BlackjackTableRefInput = z.infer<typeof blackjackTableRefSchema>;

export const BLACKJACK_ERROR_LABELS = {
  BLACKJACK_BET_INVALID: "Cette mise n'est pas autorisée.",
  BLACKJACK_ALREADY_BET: "Ta mise est déjà engagée pour cette manche.",
  BLACKJACK_BETTING_CLOSED: "Les mises sont fermées pour cette manche.",
  BLACKJACK_INSURANCE_CLOSED: "L'assurance n'est plus proposée.",
  BLACKJACK_WRONG_PHASE: "Cette action n'est pas disponible maintenant.",
  BLACKJACK_NOT_YOUR_TURN: "Ce n'est pas à cette main de jouer.",
  BLACKJACK_HAND_GONE: "Cette main n'existe plus.",
  BLACKJACK_ACTION_INVALID: "Cette action n'est pas autorisée pour cette main.",
  BLACKJACK_SEAT_TAKEN: "Cette place vient d'être prise.",
  BLACKJACK_ALREADY_SEATED: "Tu es déjà assis à cette table.",
  BLACKJACK_NOT_SEATED: "Tu regardes cette table, tu n'y as pas de place.",
  BLACKJACK_WATCHERS_FULL: "Il y a déjà trop de spectateurs à cette table.",
} as const;

export type BlackjackErrorCode = keyof typeof BLACKJACK_ERROR_LABELS;
