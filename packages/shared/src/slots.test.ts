import { describe, expect, it } from "vitest";
import {
  SLOTS_REELS,
  SLOTS_REEL_WEIGHT,
  SLOTS_SPIN_MS,
  SLOT_SYMBOLS,
  slotSymbolProbability,
  slotsHitRate,
  slotsOutcome,
  slotsPayout,
  slotsReelStopAt,
  slotsReturnToPlayer,
} from "./slots.js";

/** Index d'un symbole par son code, pour des tests qui se lisent. */
function sym(code: string): number {
  const index = SLOT_SYMBOLS.findIndex((symbol) => symbol.code === code);
  if (index < 0) throw new Error(`Symbole inconnu : ${code}`);
  return index;
}

describe("barème de la machine", () => {
  it("redistribue entre 95 et 97 %", () => {
    // Garde-fou de l'économie : retoucher un poids ou un multiplicateur sans
    // refaire le calcul doit casser ici, pas six mois plus tard dans les soldes.
    const rtp = slotsReturnToPlayer();
    expect(rtp).toBeGreaterThanOrEqual(0.95);
    expect(rtp).toBeLessThanOrEqual(0.97);
    expect(rtp).toBeCloseTo(0.9585, 4);
  });

  it("répartit cent poids sur six symboles", () => {
    expect(SLOT_SYMBOLS).toHaveLength(6);
    expect(SLOTS_REEL_WEIGHT).toBe(100);
  });

  it("classe les symboles du plus commun au plus rare", () => {
    for (let i = 1; i < SLOT_SYMBOLS.length; i += 1) {
      const precedent = SLOT_SYMBOLS[i - 1];
      const courant = SLOT_SYMBOLS[i];
      expect(courant?.weight).toBeLessThan(precedent?.weight ?? 0);
      // Plus c'est rare, plus ça paie : l'inverse serait un barème cassé.
      expect(courant?.tripleTenths).toBeGreaterThan(precedent?.tripleTenths ?? 0);
    }
  });

  it("paie plus d'un tour sur deux, grâce aux paires", () => {
    // Sans les paires, la machine ne paierait qu'un tour sur cinq et serait
    // insupportable à jouer.
    const taux = slotsHitRate();
    expect(taux).toBeGreaterThan(0.5);
    expect(taux).toBeCloseTo(0.611, 2);
  });

  it("garde le MAXOU triple exceptionnel", () => {
    const chance = slotSymbolProbability(sym("maxou")) ** 3;
    expect(chance).toBeCloseTo(1e-6, 9);
  });

  it("expose des probabilités qui totalisent 1", () => {
    const total = SLOT_SYMBOLS.reduce((sum, _, index) => sum + slotSymbolProbability(index), 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("ligne de gain", () => {
  it("paie le triple sur trois symboles identiques", () => {
    const couronne = sym("couronne");
    expect(slotsOutcome([couronne, couronne, couronne])).toEqual({
      kind: "triple",
      symbol: couronne,
      multiplierTenths: 130,
    });
  });

  it("paie la paire du symbole apparié, où qu'il soit sur la ligne", () => {
    const diamant = sym("diamant");
    const cerise = sym("cerise");
    for (const ligne of [
      [diamant, diamant, cerise],
      [diamant, cerise, diamant],
      [cerise, diamant, diamant],
    ]) {
      const resultat = slotsOutcome(ligne);
      expect(resultat.kind).toBe("pair");
      expect(resultat.symbol).toBe(diamant);
      expect(resultat.multiplierTenths).toBe(45);
    }
  });

  it("ne paie rien sur trois symboles différents", () => {
    expect(slotsOutcome([sym("cerise"), sym("cloche"), sym("sac")])).toEqual({
      kind: "none",
      symbol: null,
      multiplierTenths: 0,
    });
  });

  it("refuse une ligne qui n'a pas le bon nombre de rouleaux", () => {
    expect(() => slotsOutcome([0, 0])).toThrow();
    expect(() => slotsOutcome([0, 0, 0, 0])).toThrow();
  });
});

describe("versement", () => {
  it("rend un montant entier pour toute mise autorisée", () => {
    for (let stake = 10; stake <= 100; stake += 10) {
      for (const symbol of SLOT_SYMBOLS) {
        expect(Number.isInteger(slotsPayout(stake, symbol.tripleTenths))).toBe(true);
        expect(Number.isInteger(slotsPayout(stake, symbol.pairTenths))).toBe(true);
      }
    }
  });

  it("refuse un versement non entier plutôt que de l'arrondir", () => {
    expect(() => slotsPayout(5, 15)).toThrow();
  });

  it("plafonne le jackpot à 15 000 MaxouCoin", () => {
    // Mise maximale de 100 et ×150 : c'est le plus gros gain possible du site.
    expect(slotsPayout(100, 1_500)).toBe(15_000);
  });
});

describe("arrêt des rouleaux", () => {
  it("échelonne les arrêts et finit sur la durée annoncée", () => {
    expect(slotsReelStopAt(SLOTS_REELS - 1)).toBe(SLOTS_SPIN_MS);
    expect(slotsReelStopAt(0)).toBeLessThan(slotsReelStopAt(1));
    expect(slotsReelStopAt(1)).toBeLessThan(slotsReelStopAt(2));
  });
});
