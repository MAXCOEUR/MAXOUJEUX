import { describe, expect, it } from "vitest";
import {
  formatMotusShare,
  motusGuessSchema,
  MOTUS_WORD_LENGTHS,
  type MotusView,
} from "./motus.js";

function terminalView(overrides: Partial<MotusView> = {}): MotusView {
  return {
    slotStart: "2026-08-11T12:00:00.000Z",
    slotEnd: "2026-08-11T18:00:00.000Z",
    nextSlotAt: "2026-08-11T18:00:00.000Z",
    isCurrentSlot: true,
    canStartCurrent: false,
    length: 5,
    guesses: [
      {
        guess: "SABLE",
        marks: ["correct", "absent", "present", "absent", "correct"],
      },
    ],
    attemptsLeft: 5,
    status: "won",
    endReason: "solved",
    stake: 100,
    payout: 600,
    net: 500,
    version: 1,
    now: "2026-08-11T12:05:00.000Z",
    ...overrides,
  };
}

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

describe("partage Motus", () => {
  it("partage une victoire sans les lettres proposées", () => {
    const text = formatMotusShare(terminalView(), "https://maxoujeux.example/");

    expect(text).toBe(
      "MaxouJeux Motus — 1/6\n\n🟩⬛🟨⬛🟩\n\nhttps://maxoujeux.example/jeu/motus",
    );
    expect(text).not.toContain("SABLE");
  });

  it("partage un échec au sixième essai", () => {
    const view = terminalView({
      status: "lost",
      endReason: "attempts",
      guesses: Array.from({ length: 6 }, () => ({
        guess: "SABLE",
        marks: ["absent", "absent", "absent", "absent", "absent"],
      })),
      attemptsLeft: 0,
    });

    expect(formatMotusShare(view, "https://jeu.test")).toMatch(
      /^MaxouJeux Motus — X\/6\n\n(?:⬛⬛⬛⬛⬛\n){5}⬛⬛⬛⬛⬛/,
    );
  });

  it("partage un abandon avant le premier essai", () => {
    const view = terminalView({
      status: "lost",
      endReason: "abandoned",
      guesses: [],
      attemptsLeft: 6,
    });

    expect(formatMotusShare(view, "https://jeu.test")).toBe(
      "MaxouJeux Motus — Abandon — 0/6\n\nhttps://jeu.test/jeu/motus",
    );
  });

  it("refuse une partie non terminée", () => {
    expect(() =>
      formatMotusShare(terminalView({ status: "playing", endReason: null }), "https://jeu.test"),
    ).toThrow(/terminée/i);
  });
});
