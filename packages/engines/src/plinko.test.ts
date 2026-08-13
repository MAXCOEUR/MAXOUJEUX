import { PLINKO_ROWS, PLINKO_SLOTS, plinkoMultiplier, plinkoProbability } from "@maxoujeux/shared";
import { describe, expect, it } from "vitest";
import { dropPlinkoBall, plinkoSlotOf } from "./plinko.js";

/**
 * Aleas imposes.
 *
 * Le rebond se joue desormais sur dix mille : `randomIndex(10_000) < seuil`
 * envoie a droite. Un tirage de 0 va donc toujours a droite, et 9 999 toujours
 * a gauche — l'inverse du pile ou face d'avant.
 */
const toujours = (value: number) => () => value;

describe("chute de la bille", () => {
  it("tombe à gauche quand tous les rebonds vont à gauche", () => {
    const drop = dropPlinkoBall(toujours(9_999), "high");
    expect(drop.path).toHaveLength(PLINKO_ROWS);
    expect(drop.path.every((step) => step === "left")).toBe(true);
    expect(drop.slot).toBe(0);
    expect(drop.multiplierTenths).toBe(plinkoMultiplier("high", 0));
  });

  it("tombe à droite quand tous les rebonds vont à droite", () => {
    const drop = dropPlinkoBall(toujours(0), "low");
    expect(drop.slot).toBe(PLINKO_SLOTS - 1);
    expect(drop.multiplierTenths).toBe(plinkoMultiplier("low", PLINKO_SLOTS - 1));
  });

  it("compte la fente comme le nombre de rebonds à droite", () => {
    let appel = 0;
    // Alternance stricte : six rebonds à droite sur douze, donc la fente 6.
    const drop = dropPlinkoBall(() => (appel++ % 2 === 0 ? 0 : 9_999), "medium");
    expect(drop.slot).toBe(6);
    expect(plinkoSlotOf(drop.path)).toBe(drop.slot);
  });

  it("garde un trajet cohérent avec la fente annoncée", () => {
    let graine = 7;
    const pseudoAleatoire = (borne: number) => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return graine % borne;
    };
    for (let essai = 0; essai < 200; essai += 1) {
      const drop = dropPlinkoBall(pseudoAleatoire, "medium");
      expect(drop.path).toHaveLength(PLINKO_ROWS);
      expect(plinkoSlotOf(drop.path)).toBe(drop.slot);
      expect(drop.slot).toBeGreaterThanOrEqual(0);
      expect(drop.slot).toBeLessThan(PLINKO_SLOTS);
    }
  });

  it("suit la loi binomiale sur un grand nombre de chutes", () => {
    // Générateur congruentiel : reproductible, donc ce test ne peut pas
    // devenir instable d'une exécution à l'autre.
    let graine = 12345;
    const pseudoAleatoire = (borne: number) => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return Math.floor((graine / 2147483648) * borne);
    };

    const tirages = 40_000;
    const comptes = new Array<number>(PLINKO_SLOTS).fill(0);
    for (let essai = 0; essai < tirages; essai += 1) {
      const drop = dropPlinkoBall(pseudoAleatoire, "low");
      comptes[drop.slot] = (comptes[drop.slot] ?? 0) + 1;
    }

    // La fente centrale doit dominer, les bords rester exceptionnels.
    const centre = (comptes[6] ?? 0) / tirages;
    expect(centre).toBeCloseTo(plinkoProbability(6), 1);
    expect((comptes[0] ?? 0) / tirages).toBeLessThan(0.01);
    expect(comptes.reduce((total, compte) => total + compte, 0)).toBe(tirages);
  });
});
