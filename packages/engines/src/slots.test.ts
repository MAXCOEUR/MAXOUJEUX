import {
  SLOTS_REELS,
  SLOTS_REEL_WEIGHT,
  SLOT_SYMBOLS,
  slotsReturnToPlayer,
} from "@maxoujeux/shared";
import { describe, expect, it } from "vitest";
import { spinSlots } from "./slots.js";

/** Aléa imposé : le test choisit le billet, donc le symbole. */
const ticket = (value: number) => () => value;

/** Billet menant à un symbole donné, calculé depuis les poids du barème. */
function ticketFor(index: number): number {
  let total = 0;
  for (let i = 0; i < index; i += 1) total += SLOT_SYMBOLS[i]?.weight ?? 0;
  return total;
}

function sym(code: string): number {
  const index = SLOT_SYMBOLS.findIndex((symbol) => symbol.code === code);
  if (index < 0) throw new Error(`Symbole inconnu : ${code}`);
  return index;
}

describe("tirage des rouleaux", () => {
  it("rend trois rouleaux", () => {
    const spin = spinSlots(ticket(0));
    expect(spin.reels).toHaveLength(SLOTS_REELS);
  });

  it("aligne le symbole imposé sur les trois rouleaux", () => {
    const maxou = sym("maxou");
    const spin = spinSlots(ticket(ticketFor(maxou)));
    expect(spin.reels).toEqual([maxou, maxou, maxou]);
    expect(spin.outcome).toEqual({ kind: "triple", symbol: maxou, multiplierTenths: 1_500 });
  });

  it("tire les rouleaux indépendamment les uns des autres", () => {
    // Trois billets différents, un par rouleau : la ligne doit les refléter
    // dans l'ordre, sinon un seul tirage servirait pour les trois.
    const attendus = [sym("cerise"), sym("diamant"), sym("couronne")];
    let appel = 0;
    const spin = spinSlots(() => ticketFor(attendus[appel++] ?? 0));
    expect(spin.reels).toEqual(attendus);
    expect(spin.outcome.kind).toBe("none");
  });

  it("bascule au symbole suivant au poids exact du précédent", () => {
    const premier = SLOT_SYMBOLS[0]?.weight ?? 0;
    expect(spinSlots(ticket(premier - 1)).reels[0]).toBe(0);
    expect(spinSlots(ticket(premier)).reels[0]).toBe(1);
  });

  it("refuse un billet hors borne plutôt que d'inventer un symbole", () => {
    expect(() => spinSlots(ticket(SLOTS_REEL_WEIGHT))).toThrow();
  });

  it("respecte les poids sur un balayage exhaustif d'un rouleau", () => {
    const comptes = new Array<number>(SLOT_SYMBOLS.length).fill(0);
    for (let billet = 0; billet < SLOTS_REEL_WEIGHT; billet += 1) {
      const index = spinSlots(ticket(billet)).reels[0] ?? -1;
      comptes[index] = (comptes[index] ?? 0) + 1;
    }
    expect(comptes).toEqual(SLOT_SYMBOLS.map((symbol) => symbol.weight));
  });

  it("redistribue le taux annoncé sur un grand nombre de tirages", () => {
    // Vérification par le tirage et non par la formule : si `spinSlots`
    // décalait les symboles d'un cran, le barème resterait juste mais la
    // machine paierait autre chose. Générateur reproductible, donc ce test ne
    // peut pas devenir instable.
    let graine = 987_654_321;
    const pseudoAleatoire = (borne: number) => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return Math.floor((graine / 2147483648) * borne);
    };

    const tirages = 200_000;
    let versé = 0;
    for (let i = 0; i < tirages; i += 1) {
      versé += spinSlots(pseudoAleatoire).outcome.multiplierTenths / 10;
    }
    // Tolérance large : le MAXOU triple sort une fois sur un million, sa
    // présence ou son absence déplace le résultat de plusieurs points.
    expect(versé / tirages).toBeGreaterThan(slotsReturnToPlayer() - 0.1);
    expect(versé / tirages).toBeLessThan(slotsReturnToPlayer() + 0.1);
  });
});
