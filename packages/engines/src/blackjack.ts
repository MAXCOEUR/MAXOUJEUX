export const BLACKJACK_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const BLACKJACK_SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;

export type BlackjackRank = (typeof BLACKJACK_RANKS)[number];
export type BlackjackSuit = (typeof BLACKJACK_SUITS)[number];
export type BlackjackAction = "hit" | "stand" | "double" | "split";
export type BlackjackHandStatus = "playing" | "stood" | "busted";
export type BlackjackOutcome = "blackjack" | "win" | "push" | "loss" | "insurance";

export interface BlackjackEngineCard {
  readonly rank: BlackjackRank;
  readonly suit: BlackjackSuit;
}

export interface BlackjackEngineHand {
  readonly cards: readonly BlackjackEngineCard[];
  readonly wager: number;
  readonly fromSplit: boolean;
  readonly splitAces: boolean;
  readonly status: BlackjackHandStatus;
}

export interface HandValue {
  total: number;
  soft: boolean;
  blackjack: boolean;
}

function rankValue(rank: BlackjackRank): number {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J") return 10;
  return Number(rank);
}

export function handValue(cards: readonly BlackjackEngineCard[], fromSplit = false): HandValue {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += rankValue(card.rank);
    if (card.rank === "A") aces += 1;
  }

  let lowAces = 0;
  while (total > 21 && lowAces < aces) {
    total -= 10;
    lowAces += 1;
  }

  const soft = aces > lowAces;
  const blackjack = !fromSplit && cards.length === 2 && total === 21;
  return { total, soft, blackjack };
}

function sameSplitValue(left: BlackjackRank, right: BlackjackRank): boolean {
  return rankValue(left) === rankValue(right);
}

export function legalBlackjackActions(
  hand: BlackjackEngineHand,
  otherHands: number,
  maximumHands = 4,
): BlackjackAction[] {
  if (hand.status !== "playing" || handValue(hand.cards, hand.fromSplit).total >= 21) return [];

  if (hand.splitAces) {
    const first = hand.cards[0];
    const second = hand.cards[1];
    return hand.cards.length === 2 &&
      otherHands + 1 < maximumHands &&
      first?.rank === "A" &&
      second?.rank === "A"
      ? ["split"]
      : [];
  }

  const actions: BlackjackAction[] = ["hit", "stand"];
  if (hand.cards.length === 2 && !hand.splitAces) actions.push("double");
  const first = hand.cards[0];
  const second = hand.cards[1];
  if (
    hand.cards.length === 2 &&
    otherHands + 1 < maximumHands &&
    first &&
    second &&
    sameSplitValue(first.rank, second.rank)
  ) {
    actions.push("split");
  }
  return actions;
}

export function splitHand(
  hand: BlackjackEngineHand,
  leftCard: BlackjackEngineCard,
  rightCard: BlackjackEngineCard,
): [BlackjackEngineHand, BlackjackEngineHand] {
  const left = hand.cards[0];
  const right = hand.cards[1];
  if (!left || !right || hand.cards.length !== 2 || !sameSplitValue(left.rank, right.rank)) {
    throw new Error("SPLIT_NOT_ALLOWED");
  }

  const splitAces = left.rank === "A";
  return [
    {
      cards: [left, leftCard],
      wager: hand.wager,
      fromSplit: true,
      splitAces,
      status: splitAces && leftCard.rank !== "A" ? "stood" : "playing",
    },
    {
      cards: [right, rightCard],
      wager: hand.wager,
      fromSplit: true,
      splitAces,
      status: splitAces && rightCard.rank !== "A" ? "stood" : "playing",
    },
  ];
}

export function playDealer(
  initialCards: readonly BlackjackEngineCard[],
  shoe: readonly BlackjackEngineCard[],
): { cards: BlackjackEngineCard[]; consumed: number } {
  const cards = [...initialCards];
  let consumed = 0;
  while (handValue(cards).total < 17) {
    const next = shoe[consumed];
    if (!next) throw new Error("SHOE_EXHAUSTED");
    cards.push(next);
    consumed += 1;
  }
  return { cards, consumed };
}

/** Versement brut, mise comprise. */
export function blackjackPayout(outcome: BlackjackOutcome, wager: number): number {
  if (outcome === "blackjack") return wager * 2.5;
  if (outcome === "win") return wager * 2;
  if (outcome === "push") return wager;
  if (outcome === "insurance") return wager * 3;
  return 0;
}

export type RandomIndex = (maximumExclusive: number) => number;

/**
 * Nombre de jeux dans le sabot.
 *
 * Exporté et non écrit en dur dans la signature : le front affiche l'usure du
 * sabot en proportion de sa taille de départ, et recopier « 6 » là-bas ferait
 * mentir la jauge le jour où la table passerait à huit jeux.
 */
export const BLACKJACK_SHOE_DECKS = 6;

export function createShoe(randomIndex: RandomIndex, decks = BLACKJACK_SHOE_DECKS): BlackjackEngineCard[] {
  const cards: BlackjackEngineCard[] = [];
  for (let deck = 0; deck < decks; deck += 1) {
    for (const suit of BLACKJACK_SUITS) {
      for (const rank of BLACKJACK_RANKS) cards.push({ rank, suit });
    }
  }

  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new Error("RANDOM_INDEX_INVALID");
    }
    const current = cards[index];
    const replacement = cards[swapIndex];
    if (!current || !replacement) throw new Error("SHOE_CORRUPTED");
    cards[index] = replacement;
    cards[swapIndex] = current;
  }
  return cards;
}
