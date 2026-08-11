import { describe, expect, it } from "vitest";
import { motusGuessSchema, MOTUS_WORD_LENGTHS } from "./motus.js";

describe("contrat Motus", () => {
  it("n'autorise que les longueurs jouables", () => {
    expect(MOTUS_WORD_LENGTHS).toEqual([5, 6, 7, 8]);
  });

  it("valide une intention accompagnée de sa version", () => {
    expect(motusGuessSchema.parse({ guess: "école", version: 2 })).toEqual({
      guess: "école",
      version: 2,
    });
  });

  it("refuse une version négative et une saisie vide", () => {
    expect(motusGuessSchema.safeParse({ guess: "", version: 0 }).success).toBe(false);
    expect(motusGuessSchema.safeParse({ guess: "école", version: -1 }).success).toBe(false);
  });
});
