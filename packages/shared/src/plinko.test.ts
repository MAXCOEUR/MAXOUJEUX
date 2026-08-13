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

  it("répartit les billes sur une distribution complète et symétrique", () => {
    let total = 0;
    for (let slot = 0; slot < PLINKO_SLOTS; slot += 1) total += plinkoProbability(slot);
    expect(total).toBeCloseTo(1, 12);

    // La poussée vers l'extérieur ne favorise aucun côté : la planche reste
    // rigoureusement symétrique.
    for (let slot = 0; slot < PLINKO_SLOTS; slot += 1) {
      expect(plinkoProbability(slot)).toBeCloseTo(plinkoProbability(PLINKO_SLOTS - 1 - slot), 12);
    }

    // Le centre reste le plus probable — c'est une planche de Plinko, pas une
    // roulette — mais sans écraser le reste.
    for (let slot = 0; slot < 6; slot += 1) {
      expect(plinkoProbability(slot)).toBeLessThan(plinkoProbability(slot + 1));
    }
  });

  it("dégarnit le centre par rapport à une planche non biaisée", () => {
    // Sans poussée, la loi binomiale envoie 61 % des billes dans les trois
    // fentes centrales, et le jeu devient monotone. On vise la moitié.
    const centre = plinkoProbability(5) + plinkoProbability(6) + plinkoProbability(7);
    expect(centre).toBeGreaterThan(0.45);
    expect(centre).toBeLessThan(0.55);
    // Autrement dit : une bille sur deux sort du centre, contre 39 % avant.
    expect(1 - centre).toBeGreaterThan(0.45);
  });
});

describe("barèmes", () => {
  it("redistribuent tous entre 95 et 97 %", () => {
    // Plus généreux qu'un vrai casino — volontairement — mais la maison garde
    // un avantage : sans lui, la masse de MaxouCoin n'aurait plus de fond.
    for (const risk of PLINKO_RISKS) {
      const rtp = plinkoReturnToPlayer(risk);
      expect(rtp).toBeGreaterThanOrEqual(0.95);
      expect(rtp).toBeLessThanOrEqual(0.97);
    }
  });

  it("valent les taux annoncés au cahier des charges", () => {
    expect(plinkoReturnToPlayer("low")).toBeCloseTo(0.9568, 3);
    expect(plinkoReturnToPlayer("medium")).toBeCloseTo(0.9565, 3);
    expect(plinkoReturnToPlayer("high")).toBeCloseTo(0.9539, 3);
  });

  it("découpe la planche en moitié perdante, quart rendu, quart gagnant", () => {
    // La structure du jeu, et ce qui le rend lisible : une bille sur deux fait
    // perdre, une sur quatre rend la mise, une sur quatre paie.
    for (const risk of PLINKO_RISKS) {
      let perte = 0;
      let rendue = 0;
      let gain = 0;
      for (let slot = 0; slot < PLINKO_SLOTS; slot += 1) {
        const tenths = plinkoMultiplier(risk, slot);
        const chance = plinkoProbability(slot);
        if (tenths < 10) perte += chance;
        else if (tenths === 10) rendue += chance;
        else gain += chance;
      }
      expect(perte).toBeCloseTo(0.5, 1);
      expect(rendue).toBeCloseTo(0.25, 1);
      expect(gain).toBeCloseTo(0.25, 1);
    }
  });

  it("fait peur au centre, d'autant plus que le risque monte", () => {
    // Le centre est l'endroit où la bille tombe le plus souvent : c'est là que
    // le barème doit se voir.
    expect(plinkoMultiplier("low", 6)).toBe(7);
    expect(plinkoMultiplier("medium", 6)).toBe(4);
    expect(plinkoMultiplier("high", 6)).toBe(2);
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
    // Les bords paient moins qu'avant : ils sortent dix fois plus souvent.
    expect(plinkoMultiplier("high", 0)).toBeLessThanOrEqual(200);
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
