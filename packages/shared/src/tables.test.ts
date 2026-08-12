import { describe, expect, it } from "vitest";
import { formatClock, formatDuration } from "./economy.js";
import { isValidStake, stakeSuggestions, winPayout } from "./tables.js";

describe("mises autorisées", () => {
  it("propose des paliers qui montent en puissance", () => {
    expect(stakeSuggestions("connect4")).toEqual([10, 50, 100, 250, 500, 1_000]);
    expect(stakeSuggestions("tictactoe")).toEqual([10, 50, 100, 250, 500, 1_000]);
  });

  it("accepte un palier proposé", () => {
    for (const stake of stakeSuggestions("connect4")) {
      expect(isValidStake("connect4", stake)).toBe(true);
    }
  });

  it("n'oppose plus aucun plafond : le solde est la seule limite", () => {
    // Ces trois montants étaient refusés du temps du plafond à 100 MC.
    expect(isValidStake("connect4", 110)).toBe(true);
    expect(isValidStake("connect4", 50_000)).toBe(true);
    expect(isValidStake("blackjack", 1_000_000)).toBe(true);
  });

  it("refuse une mise sous le minimum", () => {
    expect(isValidStake("connect4", 0)).toBe(false);
    expect(isValidStake("connect4", 9)).toBe(false);
    expect(isValidStake("connect4", -100)).toBe(false);
  });

  it("refuse une mise qui ne tombe pas sur le pas", () => {
    // C'est le cas qu'un client modifié tenterait : dans les bornes, hors barème.
    expect(isValidStake("connect4", 37)).toBe(false);
    expect(isValidStake("connect4", 95)).toBe(false);
  });

  it("refuse une mise fractionnaire", () => {
    expect(isValidStake("connect4", 10.5)).toBe(false);
    expect(isValidStake("connect4", Number.NaN)).toBe(false);
  });

  it("refuse un code de jeu inconnu", () => {
    // @ts-expect-error — on vérifie précisément le comportement hors du type.
    expect(isValidStake("echecs", 10)).toBe(false);
  });

  it("laisse Motus choisir sa mise", () => {
    // Le prix fixe de 100 MC a disparu : c'est une mise comme une autre.
    expect(isValidStake("motus", 10)).toBe(true);
    expect(isValidStake("motus", 100)).toBe(true);
    expect(isValidStake("motus", 5_000)).toBe(true);
    expect(isValidStake("motus", 5)).toBe(false);
    expect(isValidStake("motus", 55)).toBe(false);
  });
});

describe("versement au vainqueur", () => {
  it("verse 1,5 × la mise, mise comprise", () => {
    expect(winPayout("connect4", 10)).toBe(15);
    expect(winPayout("connect4", 100)).toBe(150);
    expect(winPayout("tictactoe", 40)).toBe(60);
  });

  it("retire bien la moitié de la mise du perdant de l'économie", () => {
    // Deux joueurs engagent 10 MC chacun : 20 MC sortent des porte-monnaie,
    // 15 MC y reviennent. Les 5 MC restants sont détruits, c'est voulu.
    const stake = 10;
    expect(stake * 2 - winPayout("connect4", stake)).toBe(5);
  });

  it("verse un montant entier pour toute mise au pas de 10", () => {
    // Le pas de 10 n'est pas un plafond déguisé : c'est lui qui garantit que le
    // multiplicateur de 1,5 ne tombe jamais sur une demi-pièce.
    for (let stake = 10; stake <= 10_000; stake += 10) {
      expect(Number.isInteger(winPayout("connect4", stake))).toBe(true);
    }
  });
});

describe("formatage des durées", () => {
  it("affiche toujours les secondes", () => {
    expect(formatDuration(14_232_000)).toBe("3 h 57 min 12 s");
    expect(formatDuration(760_000)).toBe("12 min 40 s");
    expect(formatDuration(40_000)).toBe("40 s");
  });

  it("arrondit vers le haut pour ne pas afficher zéro avant l'échéance", () => {
    // Avec Math.floor, 999 ms afficherait « 0 s » pendant une seconde entière.
    expect(formatDuration(999)).toBe("1 s");
    expect(formatDuration(1)).toBe("1 s");
    expect(formatDuration(0)).toBe("0 s");
  });

  it("ne renvoie jamais de durée négative", () => {
    expect(formatDuration(-5_000)).toBe("0 s");
  });

  it("passe proprement les frontières d'unité", () => {
    expect(formatDuration(59_000)).toBe("59 s");
    expect(formatDuration(60_000)).toBe("1 min 00 s");
    expect(formatDuration(3_599_000)).toBe("59 min 59 s");
    expect(formatDuration(3_600_000)).toBe("1 h 00 min 00 s");
  });

  it("donne une forme compacte pour les espaces contraints", () => {
    expect(formatClock(12_000)).toBe("0:12");
    expect(formatClock(247_000)).toBe("4:07");
    expect(formatClock(3_750_000)).toBe("1:02:30");
    expect(formatClock(0)).toBe("0:00");
  });
});
