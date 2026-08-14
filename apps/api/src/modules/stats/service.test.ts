import { achievementReward, parisDay } from "@maxoujeux/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { gameStatsDaily, stats, userAchievements } from "../../db/schema.js";
import { balanceOf, ledgerSum, trackCreated } from "../../test/fixtures.js";
import { leaderboard } from "./queries.js";
import { casinoOutcome, recordRoundInTx, type RoundInput } from "./service.js";

/**
 * Tests d'intégration des cumuls et des succès.
 *
 * **PGlite ne prouve rien sur la concurrence** : le scénario de la double prime
 * doit être rejoué contre un vrai PostgreSQL avant mise en production.
 *
 *   docker compose -f docker-compose.dev.yml up -d
 *   DATABASE_URL=postgres://maxoujeux:maxoujeux@localhost:5433/maxoujeux \
 *     pnpm --filter @maxoujeux/api test
 */

const created = trackCreated();

/** Enregistre une manche dans sa propre transaction, comme le ferait un jeu. */
function record(input: RoundInput) {
  return db.transaction((tx) => recordRoundInTx(tx, input));
}

async function dailyRow(userId: string, game: string, day: string) {
  const [row] = await db
    .select()
    .from(gameStatsDaily)
    .where(
      and(
        eq(gameStatsDaily.userId, userId),
        eq(gameStatsDaily.game, game),
        eq(gameStatsDaily.day, day),
      ),
    );
  return row;
}

async function totalRow(userId: string, game: string) {
  const [row] = await db
    .select()
    .from(stats)
    .where(and(eq(stats.userId, userId), eq(stats.game, game)));
  return row;
}

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await created.cleanup();
});

describe("enregistrement d'une manche", () => {
  it("écrit les mêmes montants dans le cumul du jour et dans le cumul de toujours", async () => {
    const userId = await created.user(10_000);
    const at = new Date("2026-08-12T12:00:00Z");
    const day = parisDay(at);

    await record({
      userId,
      game: "roulette",
      wagered: 200,
      returned: 400,
      outcome: "win",
      at,
    });

    const jour = await dailyRow(userId, "roulette", day);
    expect(jour).toMatchObject({ rounds: 1, wins: 1, wagered: 200, returned: 400, net: 200 });

    const toujours = await totalRow(userId, "roulette");
    expect(toujours).toMatchObject({ played: 1, won: 1, wagered: 200, returned: 400, net: 200 });
  });

  it("additionne les manches d'une même journée sans les écraser", async () => {
    const userId = await created.user(10_000);
    const at = new Date("2026-08-12T12:00:00Z");
    const day = parisDay(at);

    await record({ userId, game: "slots", wagered: 100, returned: 0, outcome: "loss", at });
    await record({ userId, game: "slots", wagered: 100, returned: 300, outcome: "win", at });

    const jour = await dailyRow(userId, "slots", day);
    expect(jour).toMatchObject({ rounds: 2, wins: 1, losses: 1, wagered: 200, returned: 300, net: 100 });
  });

  it("sépare deux journées civiles parisiennes", async () => {
    const userId = await created.user(10_000);
    // 23 h 30 UTC le 11 août : il est déjà 1 h 30 le 12 à Paris.
    const nuit = new Date("2026-08-11T23:30:00Z");
    const lendemain = new Date("2026-08-12T20:00:00Z");

    await record({ userId, game: "wheel", wagered: 50, returned: 0, outcome: "loss", at: nuit });
    await record({ userId, game: "wheel", wagered: 50, returned: 0, outcome: "loss", at: lendemain });

    expect(await dailyRow(userId, "wheel", "2026-08-11")).toBeUndefined();
    expect((await dailyRow(userId, "wheel", "2026-08-12"))?.rounds).toBe(2);
  });

  it("ne retient que le meilleur coup, jamais le dernier", async () => {
    const userId = await created.user(10_000);
    const at = new Date("2026-08-12T12:00:00Z");

    await record({ userId, game: "plinko", wagered: 100, returned: 5_000, outcome: "win", at });
    await record({ userId, game: "plinko", wagered: 100, returned: 150, outcome: "win", at });

    expect((await totalRow(userId, "plinko"))?.bestWin).toBe(4_900);
  });

  it("ne compte pas une manche perdue comme un meilleur coup", async () => {
    const userId = await created.user(10_000);
    const at = new Date("2026-08-12T12:00:00Z");

    await record({ userId, game: "plinko", wagered: 500, returned: 0, outcome: "loss", at });

    expect((await totalRow(userId, "plinko"))?.bestWin).toBe(0);
  });

  it("rompt la série à la première défaite mais garde le record", async () => {
    const userId = await created.user(10_000);
    const at = new Date("2026-08-12T12:00:00Z");

    for (let index = 0; index < 3; index += 1) {
      await record({ userId, game: "tictactoe", wagered: 10, returned: 15, outcome: "win", at });
    }
    await record({ userId, game: "tictactoe", wagered: 10, returned: 0, outcome: "loss", at });

    const row = await totalRow(userId, "tictactoe");
    expect(row?.winStreak).toBe(0);
    expect(row?.bestWinStreak).toBe(3);
  });

  it("n'inscrit un record Motus que sur une grille trouvée", async () => {
    const userId = await created.user(10_000);
    const at = new Date("2026-08-12T12:00:00Z");

    // Perdue au sixième essai : ni le chrono ni le nombre d'essais ne comptent.
    await record({
      userId,
      game: "motus",
      wagered: 100,
      returned: 0,
      outcome: "loss",
      attempts: 6,
      durationMs: 20_000,
      at,
    });

    let row = await totalRow(userId, "motus");
    expect(row?.bestAttempts).toBeNull();
    expect(row?.bestTimeMs).toBeNull();

    await record({
      userId,
      game: "motus",
      wagered: 100,
      returned: 350,
      outcome: "win",
      attempts: 3,
      durationMs: 90_000,
      at,
    });

    row = await totalRow(userId, "motus");
    expect(row?.bestAttempts).toBe(3);
    expect(row?.bestTimeMs).toBe(90_000);
  });

  it("garde le plus petit nombre d'essais et le meilleur chrono", async () => {
    const userId = await created.user(10_000);
    const at = new Date("2026-08-12T12:00:00Z");
    const grille = (attempts: number, durationMs: number): RoundInput => ({
      userId,
      game: "motus",
      wagered: 100,
      returned: 350,
      outcome: "win",
      attempts,
      durationMs,
      at,
    });

    await record(grille(2, 60_000));
    await record(grille(4, 20_000));

    const row = await totalRow(userId, "motus");
    expect(row?.bestAttempts).toBe(2);
    expect(row?.bestTimeMs).toBe(20_000);
  });
});

describe("verdict d'une manche de casino", () => {
  it("ne compte pour une victoire que si le joueur ressort gagnant", () => {
    expect(casinoOutcome(100, 300)).toBe("win");
    expect(casinoOutcome(100, 100)).toBe("draw");
    expect(casinoOutcome(100, 0)).toBe("loss");
  });
});

describe("succès", () => {
  it("verse la prime au franchissement du palier, et une seule fois", async () => {
    const userId = await created.user(10_000);
    const at = new Date("2026-08-12T12:00:00Z");
    const gain: RoundInput = {
      userId,
      game: "connect4",
      wagered: 10,
      returned: 15,
      outcome: "win",
      at,
    };

    // Le gain de la partie est versé par le jeu, pas ici : le seul mouvement de
    // solde attendu de ce service est la prime du succès.
    const premier = await record(gain);
    expect(premier.unlocked).toContain("premier_gain");
    expect(await balanceOf(userId)).toBe(10_000 + achievementReward("premier_gain"));

    // Deuxième victoire : le succès est déjà débloqué, aucune seconde prime.
    const second = await record(gain);
    expect(second.unlocked).not.toContain("premier_gain");
    expect(await balanceOf(userId)).toBe(10_000 + achievementReward("premier_gain"));
  });

  it("inscrit la prime au journal du porte-monnaie", async () => {
    const userId = await created.user(10_000);
    const at = new Date("2026-08-12T12:00:00Z");

    await record({ userId, game: "wheel", wagered: 100, returned: 300, outcome: "win", at });

    // Le service n'écrit pas le gain du jeu, seulement la prime : le journal ne
    // doit donc porter que celle-ci.
    expect(await ledgerSum(userId)).toBe(achievementReward("premier_gain"));
  });

  it("fait avancer la barre d'un succès non encore atteint", async () => {
    const userId = await created.user(10_000);
    const at = new Date("2026-08-12T12:00:00Z");

    await record({ userId, game: "slots", wagered: 100, returned: 0, outcome: "loss", at });

    const [row] = await db
      .select()
      .from(userAchievements)
      .where(and(eq(userAchievements.userId, userId), eq(userAchievements.code, "manches_100")));

    expect(row?.progress).toBe(1);
    expect(row?.unlockedAt).toBeNull();
  });

  /**
   * Deux manches simultanées peuvent franchir le même palier. La clause
   * `unlocked_at is null` de l'UPDATE doit faire que la seconde ne récupère
   * aucune ligne — et donc ne verse rien.
   *
   * PGlite sérialise les requêtes : ce test ne prouve la garantie que sur un
   * vrai PostgreSQL. Il vaut malgré tout comme non-régression fonctionnelle.
   */
  it("ne verse pas deux primes sur deux manches concurrentes", async () => {
    const userId = await created.user(10_000);
    const at = new Date("2026-08-12T12:00:00Z");
    const gain: RoundInput = {
      userId,
      game: "blackjack",
      wagered: 10,
      returned: 20,
      outcome: "win",
      at,
    };

    const [a, b] = await Promise.all([record(gain), record(gain)]);
    const debloques = [...a.unlocked, ...b.unlocked].filter((code) => code === "premier_gain");

    expect(debloques).toHaveLength(1);
    expect(await ledgerSum(userId)).toBe(achievementReward("premier_gain"));
  });
});

describe("classement", () => {
  it("rend son rang au joueur même hors du haut de tableau", async () => {
    // Journée qui n'appartient qu'à ce test : les manches jouées plus haut dans
    // le fichier fausseraient le rang et le total.
    const at = new Date("2026-09-20T12:00:00Z");
    // Vingt-cinq joueurs devant, pour dépasser les vingt lignes affichées.
    const devant: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      devant.push(await created.user(10_000));
    }
    const dernier = await created.user(10_000);

    for (const [index, userId] of devant.entries()) {
      await record({
        userId,
        game: "connect4",
        wagered: 100,
        returned: 200 + index * 10,
        outcome: "win",
        at,
      });
    }
    // Le nôtre perd : il finit derrière tout le monde.
    await record({
      userId: dernier,
      game: "connect4",
      wagered: 100,
      returned: 0,
      outcome: "loss",
      at,
    });

    const board = await leaderboard(dernier, "connect4", "day", "fortune", at);

    expect(board.rows).toHaveLength(20);
    expect(board.rows.some((row) => row.userId === dernier)).toBe(false);
    // L'essentiel : la ligne du demandeur existe, avec son rang réel.
    expect(board.me?.userId).toBe(dernier);
    expect(board.me?.rank).toBe(26);
    expect(board.total).toBe(26);
  });

  it("écarte du rendement les joueurs qui n'ont pas assez joué", async () => {
    const at = new Date("2026-08-12T12:00:00Z");
    const occasionnel = await created.user(10_000);

    await record({
      userId: occasionnel,
      game: "wheel",
      wagered: 10,
      returned: 200,
      outcome: "win",
      at,
    });

    const fortune = await leaderboard(occasionnel, "wheel", "day", "fortune", at);
    expect(fortune.me).not.toBeNull();

    // Une seule manche à +1 900 % ne peut pas coiffer le classement du rendement.
    const rendement = await leaderboard(occasionnel, "wheel", "day", "rendement", at);
    expect(rendement.me).toBeNull();
  });

  it("ne mélange pas les jeux quand un jeu est demandé", async () => {
    const at = new Date("2026-08-12T12:00:00Z");
    const userId = await created.user(10_000);

    await record({ userId, game: "slots", wagered: 100, returned: 900, outcome: "win", at });

    const surSlots = await leaderboard(userId, "slots", "day", "fortune", at);
    const surPoker = await leaderboard(userId, "poker", "day", "fortune", at);

    expect(surSlots.me?.net).toBe(800);
    expect(surPoker.me).toBeNull();
  });

  it("ne retient pas une manche hors de la période demandée", async () => {
    const veille = new Date("2026-08-11T12:00:00Z");
    const aujourdhui = new Date("2026-08-12T12:00:00Z");
    const userId = await created.user(10_000);

    await record({ userId, game: "plinko", wagered: 100, returned: 500, outcome: "win", at: veille });

    const jour = await leaderboard(userId, "plinko", "day", "fortune", aujourdhui);
    const semaine = await leaderboard(userId, "plinko", "week", "fortune", aujourdhui);

    expect(jour.me).toBeNull();
    expect(semaine.me?.net).toBe(400);
  });
});
