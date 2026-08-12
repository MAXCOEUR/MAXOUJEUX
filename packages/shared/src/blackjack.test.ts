import { describe, expect, it } from "vitest";
import {
  BLACKJACK_BETTING_MS,
  BLACKJACK_BET_OPTIONS,
  blackjackActionSchema,
  blackjackBetSchema,
  blackjackInsuranceSchema,
} from "./blackjack.js";

describe("intentions Blackjack", () => {
  it("accepte toute mise d'au moins 10 MC par pas de 10, sans plafond", () => {
    const bet = (amount: number) =>
      blackjackBetSchema.safeParse({ tableId: crypto.randomUUID(), amount, version: 0 }).success;

    expect(bet(10)).toBe(true);
    expect(bet(2_500)).toBe(true);
    // Au-dessus de l'ancien plafond : c'est désormais le solde qui tranche.
    expect(bet(1_000_000)).toBe(true);
    expect(bet(25)).toBe(false);
    expect(bet(0)).toBe(false);
    expect(BLACKJACK_BET_OPTIONS).toEqual([10, 50, 100, 250, 500, 1_000, 2_500]);
  });

  it("valide les décisions d'assurance et de main avec leur version", () => {
    const tableId = crypto.randomUUID();
    expect(blackjackInsuranceSchema.parse({ tableId, take: true, version: 3 }).take).toBe(true);
    expect(blackjackActionSchema.parse({ tableId, handIndex: 2, action: "split", version: 4 }).handIndex).toBe(2);
    expect(blackjackActionSchema.safeParse({ tableId, handIndex: 4, action: "hit", version: 4 }).success).toBe(false);
  });

  it("laisse vingt secondes aux joueurs pour miser", () => {
    expect(BLACKJACK_BETTING_MS).toBe(20_000);
  });
});
