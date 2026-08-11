import { z } from "zod";

export const BLACKJACK_BETTING_MS = 20_000;
export const BLACKJACK_INSURANCE_MS = 15_000;
export const BLACKJACK_ACTION_MS = 30_000;
export const BLACKJACK_RESULT_MS = 8_000;
export const BLACKJACK_DISCONNECT_GRACE_MS = 45_000;
export const BLACKJACK_MAX_HANDS = 4;
export const BLACKJACK_BET_OPTIONS = [10, 50, 100, 250, 500, 1_000, 2_500] as const;

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
  you: number | null;
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

const tableVersionSchema = z.object({
  tableId: z.string().uuid(),
  version: z.number().int().nonnegative(),
});

export const blackjackBetSchema = tableVersionSchema.extend({
  amount: z.number().int().min(10).max(2_500).refine((amount) => amount % 10 === 0),
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

export const BLACKJACK_ERROR_LABELS = {
  BLACKJACK_BET_INVALID: "Cette mise n'est pas autorisée.",
  BLACKJACK_ALREADY_BET: "Ta mise est déjà engagée pour cette manche.",
  BLACKJACK_BETTING_CLOSED: "Les mises sont fermées pour cette manche.",
  BLACKJACK_INSURANCE_CLOSED: "L'assurance n'est plus proposée.",
  BLACKJACK_WRONG_PHASE: "Cette action n'est pas disponible maintenant.",
  BLACKJACK_NOT_YOUR_TURN: "Ce n'est pas à cette main de jouer.",
  BLACKJACK_HAND_GONE: "Cette main n'existe plus.",
  BLACKJACK_ACTION_INVALID: "Cette action n'est pas autorisée pour cette main.",
} as const;

export type BlackjackErrorCode = keyof typeof BLACKJACK_ERROR_LABELS;
