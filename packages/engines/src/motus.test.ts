import { describe, expect, it } from "vitest";
import { evaluateMotusGuess, normalizeMotusDraft, normalizeMotusWord } from "./motus.js";

describe("normalisation Motus", () => {
  it("ignore la casse, les accents et la cédille", () => {
    expect(normalizeMotusWord("  ÉcOÇe  ")).toBe("ECOCE");
  });

  it("refuse les séparateurs et les caractères non alphabétiques", () => {
    expect(() => normalizeMotusWord("arc-en")).toThrow(/lettres/i);
    expect(() => normalizeMotusWord("l'été")).toThrow(/lettres/i);
  });

  it("nettoie une saisie en cours sans lever d'erreur", () => {
    expect(normalizeMotusDraft("Élé-phant 42", 8)).toBe("ELEPHANT");
  });
});

describe("évaluation Motus", () => {
  it("marque les positions exactes avant les lettres présentes", () => {
    expect(evaluateMotusGuess("SALLE", "ALLER")).toEqual({
      guess: "ALLER",
      marks: ["present", "present", "correct", "present", "absent"],
      solved: false,
    });
  });

  it("ne surconsomme pas une lettre doublée", () => {
    expect(evaluateMotusGuess("POMME", "MAMMA")).toEqual({
      guess: "MAMMA",
      marks: ["absent", "absent", "correct", "correct", "absent"],
      solved: false,
    });
  });

  it("reconnaît une solution malgré les accents saisis", () => {
    expect(evaluateMotusGuess("ECOLE", "école")).toEqual({
      guess: "ECOLE",
      marks: ["correct", "correct", "correct", "correct", "correct"],
      solved: true,
    });
  });

  it("refuse deux mots de longueurs différentes", () => {
    expect(() => evaluateMotusGuess("SALLE", "SALONNE")).toThrow(/longueur/i);
  });

  it("ne renvoie jamais le mot secret", () => {
    const result = evaluateMotusGuess("SALLE", "SABLE");
    expect(result).not.toHaveProperty("secret");
    expect(JSON.stringify(result)).not.toContain("SALLE");
  });
});
