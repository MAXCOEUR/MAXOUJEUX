import { describe, expect, it } from "vitest";
import {
  blackjackPayout,
  handValue,
  legalBlackjackActions,
  playDealer,
  splitHand,
  type BlackjackEngineHand,
} from "./blackjack.js";

const card = (rank: BlackjackEngineHand["cards"][number]["rank"]): BlackjackEngineHand["cards"][number] => ({
  rank,
  suit: "spades",
});

const hand = (ranks: BlackjackEngineHand["cards"][number]["rank"][], wager = 100): BlackjackEngineHand => ({
  cards: ranks.map(card),
  wager,
  fromSplit: false,
  splitAces: false,
  status: "playing",
});

describe("valeur d'une main", () => {
  it("rabaisse les As jusqu'à éviter le dépassement", () => {
    expect(handValue([card("A"), card("A"), card("9")])).toEqual({ total: 21, soft: true, blackjack: false });
    expect(handValue([card("A"), card("9"), card("5")])).toEqual({ total: 15, soft: false, blackjack: false });
  });

  it("ne considère naturel qu'un 21 initial non séparé", () => {
    expect(handValue([card("A"), card("K")]).blackjack).toBe(true);
    expect(handValue([card("A"), card("K")], true).blackjack).toBe(false);
  });
});

describe("actions", () => {
  it("autorise double et séparation de deux cartes de même valeur", () => {
    expect(legalBlackjackActions(hand(["K", "Q"]), 0, 4)).toEqual([
      "hit",
      "stand",
      "double",
      "split",
    ]);
  });

  it("sépare une paire en deux mains avec une carte chacune", () => {
    const result = splitHand(hand(["8", "8"]), card("3"), card("K"));
    expect(result.map((entry) => entry.cards.map((entryCard) => entryCard.rank))).toEqual([
      ["8", "3"],
      ["8", "K"],
    ]);
    expect(result.every((entry) => entry.fromSplit && entry.wager === 100)).toBe(true);
  });

  it("laisse uniquement un nouvel As séparable après une séparation d'As", () => {
    const [left, right] = splitHand(hand(["A", "A"]), card("A"), card("9"));
    expect(left.status).toBe("playing");
    expect(legalBlackjackActions(left, 1, 4)).toEqual(["split"]);
    expect(right.status).toBe("stood");
  });
});

describe("croupier et règlement", () => {
  it("reste sur un 17 souple", () => {
    const result = playDealer([card("A"), card("6")], [card("2")]);
    expect(result.cards.map((entry) => entry.rank)).toEqual(["A", "6"]);
  });

  it("paie blackjack 3:2, victoire 1:1, égalité et assurance 2:1", () => {
    expect(blackjackPayout("blackjack", 100)).toBe(250);
    expect(blackjackPayout("win", 100)).toBe(200);
    expect(blackjackPayout("push", 100)).toBe(100);
    expect(blackjackPayout("loss", 100)).toBe(0);
    expect(blackjackPayout("insurance", 50)).toBe(150);
  });
});
