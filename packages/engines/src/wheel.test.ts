import { WHEEL_SEGMENTS, WHEEL_TOTAL_WEIGHT, wheelReturnToPlayer } from "@maxoujeux/shared";
import { describe, expect, it } from "vitest";
import { spinWheel } from "./wheel.js";

/** Aléa imposé : le test choisit le billet, donc le secteur. */
const ticket = (value: number) => () => value;

describe("tirage de la roue", () => {
  it("rend le premier secteur pour le billet zéro", () => {
    expect(spinWheel(ticket(0))).toBe(0);
  });

  it("bascule au secteur suivant au poids exact du précédent", () => {
    const premier = WHEEL_SEGMENTS[0]?.weight ?? 0;
    expect(spinWheel(ticket(premier - 1))).toBe(0);
    expect(spinWheel(ticket(premier))).toBe(1);
  });

  it("rend le dernier secteur pour le dernier billet", () => {
    expect(spinWheel(ticket(WHEEL_TOTAL_WEIGHT - 1))).toBe(WHEEL_SEGMENTS.length - 1);
  });

  it("couvre tous les secteurs et respecte leurs poids", () => {
    // Balayage exhaustif des mille billets : chaque secteur doit sortir
    // exactement autant de fois que son poids l'annonce.
    const comptes = new Array<number>(WHEEL_SEGMENTS.length).fill(0);
    for (let billet = 0; billet < WHEEL_TOTAL_WEIGHT; billet += 1) {
      const index = spinWheel(ticket(billet));
      comptes[index] = (comptes[index] ?? 0) + 1;
    }
    expect(comptes).toEqual(WHEEL_SEGMENTS.map((segment) => segment.weight));
  });

  it("refuse un billet hors borne plutôt que d'inventer un secteur", () => {
    expect(() => spinWheel(ticket(WHEEL_TOTAL_WEIGHT))).toThrow();
  });

  it("redistribue bien 92 % sur un balayage exhaustif", () => {
    // Vérification par le tirage et non par la formule : si `spinWheel`
    // décalait les secteurs d'un cran, le barème resterait juste mais le jeu
    // paierait autre chose. Ce test attrape ce décalage.
    let versé = 0;
    for (let billet = 0; billet < WHEEL_TOTAL_WEIGHT; billet += 1) {
      const segment = WHEEL_SEGMENTS[spinWheel(ticket(billet))];
      versé += (segment?.multiplierTenths ?? 0) / 10;
    }
    expect(versé / WHEEL_TOTAL_WEIGHT).toBeCloseTo(wheelReturnToPlayer(), 10);
  });
});
