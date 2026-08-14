import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_REWARDS,
  achievementReward,
  evaluateAchievements,
  evaluateDailyStreak,
  type AchievementContext,
  type AchievementTotals,
  type RoundFlag,
} from "./achievements.js";
import { GAME_CODES } from "./games.js";

const AUCUN_CUMUL: AchievementTotals = {
  rounds: 0,
  wins: 0,
  net: 0,
  wagered: 0,
  bestWin: 0,
  winStreak: 0,
};

function contexte(patch: Partial<AchievementContext> = {}): AchievementContext {
  return {
    game: "connect4",
    round: { net: 0, outcome: "loss", attempts: null, durationMs: null, hour: 14 },
    flags: [],
    gameTotals: { ...AUCUN_CUMUL },
    overall: { ...AUCUN_CUMUL, gamesPlayed: 0, gamesWon: 0 },
    balance: 0,
    ...patch,
  };
}

/** Avancement d'un succès dans le résultat de l'évaluation, ou 0 s'il est absent. */
function avancement(progress: { code: string; progress: number }[], code: string): number {
  return progress.find((entry) => entry.code === code)?.progress ?? 0;
}

describe("catalogue", () => {
  it("n'a aucun code en double", () => {
    const codes = ACHIEVEMENTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("ne référence que des jeux du catalogue", () => {
    for (const achievement of ACHIEVEMENTS) {
      if (achievement.game === null) continue;
      expect(GAME_CODES).toContain(achievement.game);
    }
  });

  it("donne un palier atteignable à chaque succès", () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.goal).toBeGreaterThan(0);
    }
  });

  it("verse la prime de son palier, et rien pour un code inconnu", () => {
    expect(achievementReward("premier_gain")).toBe(ACHIEVEMENT_REWARDS.bronze);
    expect(achievementReward("fortune_1m")).toBe(ACHIEVEMENT_REWARDS.or);
    expect(achievementReward("code-qui-n-existe-pas")).toBe(0);
  });

  /**
   * Garde-fou d'équilibrage : le catalogue entier ne doit pas représenter une
   * source de MaxouCoin comparable au bonus quotidien sur la durée. À 2 000 MC
   * par jour au plafond, 200 000 MC valent cent jours de jeu.
   */
  it("reste sous 200 000 MaxouCoin distribuables au total", () => {
    const total = ACHIEVEMENTS.reduce((sum, a) => sum + ACHIEVEMENT_REWARDS[a.tier], 0);
    expect(total).toBeLessThanOrEqual(200_000);
  });
});

describe("succès cumulatifs", () => {
  it("avance au rythme des cumuls, sans attendre le palier", () => {
    const progress = evaluateAchievements(
      contexte({
        overall: { ...AUCUN_CUMUL, rounds: 47, wagered: 12_000, gamesPlayed: 3, gamesWon: 1 },
      }),
    );
    expect(avancement(progress, "manches_100")).toBe(47);
    expect(avancement(progress, "mise_100k")).toBe(12_000);
  });

  it("ne fait jamais reculer un cumul de gains sous zéro", () => {
    // Un joueur qui perd plus qu'il ne gagne a un net négatif : la barre du
    // succès de fortune doit rester à zéro, pas afficher un nombre négatif.
    const progress = evaluateAchievements(
      contexte({ overall: { ...AUCUN_CUMUL, net: -5_000, rounds: 10, gamesPlayed: 1, gamesWon: 0 } }),
    );
    expect(avancement(progress, "fortune_10k")).toBe(0);
  });

  it("compte les jeux distincts pour le grand chelem", () => {
    const progress = evaluateAchievements(
      contexte({ overall: { ...AUCUN_CUMUL, rounds: 50, gamesPlayed: 9, gamesWon: 9 } }),
    );
    expect(avancement(progress, "touche_a_tout")).toBe(9);
    expect(avancement(progress, "grand_chelem")).toBe(9);
  });

  it("mesure la série de victoires jeu par jeu", () => {
    const progress = evaluateAchievements(
      contexte({
        round: { net: 10, outcome: "win", attempts: null, durationMs: null, hour: 14 },
        gameTotals: { ...AUCUN_CUMUL, rounds: 7, wins: 7, winStreak: 7 },
        overall: { ...AUCUN_CUMUL, rounds: 20, wins: 7, gamesPlayed: 3, gamesWon: 1 },
      }),
    );
    expect(avancement(progress, "serie_5_victoires")).toBe(7);
    expect(avancement(progress, "serie_10_victoires")).toBe(7);
  });
});

describe("succès ponctuels", () => {
  it("retient le meilleur coup une fois le seuil franchi", () => {
    const progress = evaluateAchievements(
      contexte({
        overall: { ...AUCUN_CUMUL, bestWin: 12_000, rounds: 1, gamesPlayed: 1, gamesWon: 1 },
      }),
    );
    expect(avancement(progress, "coup_1000")).toBe(1);
    expect(avancement(progress, "coup_10000")).toBe(1);
    expect(avancement(progress, "coup_50000")).toBe(0);
  });

  it("ne décerne la nuit blanche qu'entre deux et cinq heures", () => {
    const nuit = (hour: number) =>
      avancement(
        evaluateAchievements(
          contexte({ round: { net: 0, outcome: "loss", attempts: null, durationMs: null, hour } }),
        ),
        "nuit_blanche",
      );
    expect(nuit(1)).toBe(0);
    expect(nuit(3)).toBe(1);
    expect(nuit(5)).toBe(0);
  });

  it("suit les coups d'éclat signalés par le jeu", () => {
    const avec = (flags: RoundFlag[], game: AchievementContext["game"] = "plinko") =>
      evaluateAchievements(contexte({ game, flags }));

    expect(avancement(avec(["plinko_max"]), "plinko_max")).toBe(1);
    expect(avancement(avec(["slots_jackpot"], "slots"), "slots_maxou")).toBe(1);
    expect(avancement(avec(["poker_quads"], "poker"), "poker_carre")).toBe(1);
    expect(avancement(avec([], "plinko"), "plinko_max")).toBe(0);
  });
});

describe("Motus", () => {
  it("décerne l'éclair sous trente secondes, sur une grille trouvée seulement", () => {
    const grille = (outcome: "win" | "loss", durationMs: number) =>
      avancement(
        evaluateAchievements(
          contexte({
            game: "motus",
            round: { net: 0, outcome, attempts: 3, durationMs, hour: 14 },
            gameTotals: { ...AUCUN_CUMUL, rounds: 1, wins: outcome === "win" ? 1 : 0 },
          }),
        ),
        "motus_eclair",
      );

    expect(grille("win", 20_000)).toBe(1);
    expect(grille("win", 45_000)).toBe(0);
    // Perdre vite n'est pas un exploit.
    expect(grille("loss", 20_000)).toBe(0);
  });

  it("ne compte le succès du premier essai que sur le signal du jeu", () => {
    const context = contexte({
      game: "motus",
      flags: ["motus_first_guess"],
      round: { net: 500, outcome: "win", attempts: 1, durationMs: 60_000, hour: 14 },
      gameTotals: { ...AUCUN_CUMUL, rounds: 1, wins: 1, winStreak: 1 },
    });
    expect(avancement(evaluateAchievements(context), "motus_un_essai")).toBe(1);
  });

  it("n'attribue aucun succès d'adresse d'un autre jeu", () => {
    const progress = evaluateAchievements(
      contexte({ game: "motus", gameTotals: { ...AUCUN_CUMUL, rounds: 40, wins: 40 } }),
    );
    expect(avancement(progress, "connect4_10")).toBe(0);
    expect(avancement(progress, "blackjack_100")).toBe(0);
  });
});

describe("assiduité", () => {
  it("reporte la série sur les quatre paliers", () => {
    const progress = evaluateDailyStreak(12);
    expect(avancement(progress, "serie_3")).toBe(12);
    expect(avancement(progress, "serie_100")).toBe(12);
  });

  it("n'évalue rien sans série", () => {
    expect(evaluateDailyStreak(0)).toEqual([]);
  });
});
