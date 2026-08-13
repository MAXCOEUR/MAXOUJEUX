import { describe, expect, it } from "vitest";
import {
  PLINKO_RISKS,
  PLINKO_ROWS,
  PLINKO_SLOTS,
  plinkoMultiplier,
  plinkoPayout,
  plinkoProbability,
  plinkoReturnToPlayer,
  plinkoTable,
} from "./plinko.js";

describe("planche", () => {
  it("donne treize fentes pour douze rangées", () => {
    expect(PLINKO_SLOTS).toBe(PLINKO_ROWS + 1);
    for (const risk of PLINKO_RISKS) {
      expect(plinkoTable(risk)).toHaveLength(PLINKO_SLOTS);
    }
  });

  it("reste symétrique sur les trois risques", () => {
    for (const risk of PLINKO_RISKS) {
      const table = plinkoTable(risk);
      expect([...table].reverse()).toEqual([...table]);
    }
  });

  it("suit une loi binomiale dont les probabilités totalisent 1", () => {
    let total = 0;
    for (let slot = 0; slot < PLINKO_SLOTS; slot += 1) total += plinkoProbability(slot);
    expect(total).toBeCloseTo(1, 12);
    // Une bille sur 4 096 touche le bord, 924 sur 4 096 le centre.
    expect(plinkoProbability(0)).toBeCloseTo(1 / 4096, 12);
    expect(plinkoProbability(6)).toBeCloseTo(924 / 4096, 12);
  });
});

describe("barèmes", () => {
  it("redistribuent tous entre 90 et 95 %", () => {
    for (const risk of PLINKO_RISKS) {
      const rtp = plinkoReturnToPlayer(risk);
      expect(rtp).toBeGreaterThanOrEqual(0.9);
      expect(rtp).toBeLessThanOrEqual(0.95);
    }
  });

  it("valent les taux annoncés au cahier des charges", () => {
    expect(plinkoReturnToPlayer("low")).toBeCloseTo(0.9165, 3);
    expect(plinkoReturnToPlayer("medium")).toBeCloseTo(0.9125, 3);
    expect(plinkoReturnToPlayer("high")).toBeCloseTo(0.913, 3);
  });

  it("montent en amplitude avec le risque sans changer la fréquence", () => {
    // Le risque déplace la valeur des fentes, pas la planche : la probabilité
    // de rendre au moins la mise doit rester identique aux trois niveaux.
    const frequences = PLINKO_RISKS.map((risk) => {
      const table = plinkoTable(risk);
      return table.reduce(
        (total, tenths, slot) => total + (tenths >= 10 ? plinkoProbability(slot) : 0),
        0,
      );
    });
    expect(frequences[1]).toBeCloseTo(frequences[0] ?? 0, 12);
    expect(frequences[2]).toBeCloseTo(frequences[0] ?? 0, 12);

    expect(plinkoMultiplier("high", 0)).toBeGreaterThan(plinkoMultiplier("low", 0));
    expect(plinkoMultiplier("high", 6)).toBeLessThan(plinkoMultiplier("low", 6));
  });

  it("punissent le centre et paient les bords", () => {
    for (const risk of PLINKO_RISKS) {
      const table = plinkoTable(risk);
      expect(plinkoMultiplier(risk, 6)).toBeLessThan(10);
      expect(table[0]).toBe(Math.max(...table));
    }
  });
});

describe("versement", () => {
  it("rend un montant entier pour toute mise autorisée", () => {
    for (let stake = 10; stake <= 500; stake += 10) {
      for (const risk of PLINKO_RISKS) {
        for (let slot = 0; slot < PLINKO_SLOTS; slot += 1) {
          const payout = plinkoPayout(stake, plinkoMultiplier(risk, slot));
          expect(Number.isInteger(payout)).toBe(true);
        }
      }
    }
  });

  it("refuse un versement non entier plutôt que de l'arrondir", () => {
    expect(() => plinkoPayout(5, 11)).toThrow();
  });
});
