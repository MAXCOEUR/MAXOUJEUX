import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { pocketIndex } from "@maxoujeux/engines";
import { spotKey, type RouletteSpot } from "@maxoujeux/shared";
import { db, runMigrations } from "../../db/index.js";
import { matches } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { balanceOf, ledgerSum, trackCreated } from "../../test/fixtures.js";
import type { PlayerIdentity } from "../tables/manager.js";
import {
  betRoulette,
  clearRoulette,
  createRouletteTable,
  joinRouletteTable,
  leaveRoulette,
  recoverRouletteRounds,
  resetRouletteForTests,
  setRouletteDurationsForTests,
  setRouletteRandomForTests,
  viewRoulette,
} from "./service.js";

const created = trackCreated();

const plein = (number: number): RouletteSpot => ({ kind: "straight", number });

async function player(balance = 5_000): Promise<PlayerIdentity> {
  const userId = await created.user(balance);
  return { userId, pseudo: `rl_${userId.slice(0, 6)}`, avatarSeed: userId.slice(0, 8) };
}

async function errorOf(work: () => Promise<unknown>): Promise<AppError> {
  try {
    await work();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("aucune erreur");
}

/** Impose le numéro qui sortira. Sans cela, aucun règlement n'est vérifiable. */
function forceResult(value: number): void {
  setRouletteRandomForTests(() => pocketIndex(value));
}

/** Attend qu'une condition devienne vraie, ou échoue au bout du délai. */
async function until(check: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<void> {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition jamais atteinte");
}

async function matchStatus(roundId: string): Promise<string | undefined> {
  const [row] = await db.select({ status: matches.status }).from(matches).where(eq(matches.id, roundId));
  return row?.status;
}

/** Millisecondes restantes avant la fin de la phase, vues du joueur. */
function restant(tableId: string, userId: string): number {
  const deadline = viewRoulette(tableId, userId)?.deadlineAt;
  if (!deadline) throw new Error("échéance absente");
  return new Date(deadline).getTime() - Date.now();
}

/** Identifiant du tour en cours, enregistré pour le nettoyage. */
function currentRound(tableId: string, userId: string): string {
  const roundId = viewRoulette(tableId, userId)?.roundId;
  if (!roundId) throw new Error("tour absent");
  created.match(roundId);
  return roundId;
}

beforeAll(() => runMigrations(), 60_000);
afterEach(() => {
  resetRouletteForTests();
  setRouletteDurationsForTests({
    betting: 30_000,
    allBetsPlaced: 3_000,
    spin: 7_000,
    result: 8_000,
    grace: 45_000,
  });
});
afterAll(() => created.cleanup());

describe("table de roulette", () => {
  it("entrer à la table n'engage rien et ne donne pas de siège", async () => {
    const host = await player();
    const tableId = await createRouletteTable(host);
    const invite = await player();
    await joinRouletteTable(invite, tableId);

    const vue = viewRoulette(tableId, invite.userId);
    expect(vue).toMatchObject({ game: "roulette", phase: "idle", you: invite.userId, maxPlayers: 8 });
    expect(vue?.players).toHaveLength(2);
    expect(vue?.bets).toEqual([]);
    expect(await balanceOf(invite.userId)).toBe(5_000);
  });

  it("refuse un neuvième joueur", async () => {
    const host = await player();
    const tableId = await createRouletteTable(host);
    for (let index = 1; index < 8; index += 1) await joinRouletteTable(await player(), tableId);

    const surnumeraire = await player();
    expect((await errorOf(() => joinRouletteTable(surnumeraire, tableId))).code).toBe("TABLE_FULL");
  });

  it("débite le total d'un coup et le montre à toute la table", async () => {
    const host = await player();
    const tableId = await createRouletteTable(host);
    const temoin = await player();
    await joinRouletteTable(temoin, tableId);

    await betRoulette(host.userId, tableId, [
      { spot: { kind: "red" }, amount: 100 },
      { spot: plein(17), amount: 20 },
    ]);
    currentRound(tableId, host.userId);

    expect(await balanceOf(host.userId)).toBe(4_880);
    expect(await ledgerSum(host.userId)).toBe(-120);

    // Le témoin voit le tas, sans voir sa propre part dedans.
    const vue = viewRoulette(tableId, temoin.userId);
    expect(vue?.phase).toBe("betting");
    const rouge = vue?.bets.find((bet) => spotKey(bet.spot) === "red");
    expect(rouge).toMatchObject({ total: 100, mine: 0 });
    // Le miseur, lui, retrouve sa part.
    const sienne = viewRoulette(tableId, host.userId)?.bets.find((bet) => spotKey(bet.spot) === "red");
    expect(sienne).toMatchObject({ total: 100, mine: 100 });
  });

  it("cumule les jetons des joueurs sur une même case", async () => {
    const host = await player();
    const tableId = await createRouletteTable(host);
    const invite = await player();
    await joinRouletteTable(invite, tableId);

    await betRoulette(host.userId, tableId, [{ spot: { kind: "black" }, amount: 50 }]);
    currentRound(tableId, host.userId);
    await betRoulette(invite.userId, tableId, [{ spot: { kind: "black" }, amount: 30 }]);

    const vue = viewRoulette(tableId, invite.userId);
    expect(vue?.bets.find((bet) => spotKey(bet.spot) === "black")).toMatchObject({ total: 80, mine: 30 });
  });

  it("écourte la fenêtre dès que tous les joueurs ont misé", async () => {
    const host = await player();
    const invite = await player();
    const tableId = await createRouletteTable(host);
    await joinRouletteTable(invite, tableId);

    await betRoulette(host.userId, tableId, [{ spot: { kind: "red" }, amount: 10 }]);
    currentRound(tableId, host.userId);
    const apresLaPremiere = restant(tableId, host.userId);

    await betRoulette(invite.userId, tableId, [{ spot: { kind: "black" }, amount: 10 }]);
    const apresLaSeconde = restant(tableId, host.userId);

    // La fenêtre entière court tant qu'un joueur n'a pas posé ses jetons.
    expect(apresLaPremiere).toBeGreaterThan(10_000);
    // Puis elle tombe au strict nécessaire : plus personne n'est attendu.
    expect(apresLaSeconde).toBeLessThanOrEqual(3_000);
  });

  it("n'écourte rien tant qu'un joueur regarde sans miser", async () => {
    const host = await player();
    const spectateur = await player();
    const tableId = await createRouletteTable(host);
    await joinRouletteTable(spectateur, tableId);

    await betRoulette(host.userId, tableId, [{ spot: { kind: "red" }, amount: 10 }]);
    currentRound(tableId, host.userId);

    // Le voisin a encore toute la fenêtre pour se décider.
    expect(restant(tableId, host.userId)).toBeGreaterThan(10_000);
  });

  it("ne rallonge jamais la fenêtre par une mise tardive", async () => {
    const host = await player();
    const tableId = await createRouletteTable(host);
    setRouletteDurationsForTests({ betting: 1_000 });

    await betRoulette(host.userId, tableId, [{ spot: { kind: "red" }, amount: 10 }]);
    currentRound(tableId, host.userId);

    // Le repli à 3 s ne doit pas repousser une échéance déjà plus proche.
    expect(restant(tableId, host.userId)).toBeLessThanOrEqual(1_000);
  });

  it("regroupe une case envoyée deux fois en un seul débit", async () => {
    const host = await player();
    const tableId = await createRouletteTable(host);

    await betRoulette(host.userId, tableId, [
      { spot: plein(17), amount: 60 },
      { spot: plein(17), amount: 60 },
    ]);

    expect(await balanceOf(host.userId)).toBe(5_000 - 120);
  });

  it("n'oppose plus aucun plafond de case : seul le solde borne la mise", async () => {
    const host = await player(50_000);
    const tableId = await createRouletteTable(host);

    // 25 000 sur un plein paierait 900 000 MC. C'est un arbitrage assumé au
    // profit de la liberté de jeu : le seul refus vient du porte-monnaie.
    await betRoulette(host.userId, tableId, [{ spot: plein(5), amount: 25_000 }]);
    currentRound(tableId, host.userId);
    await betRoulette(host.userId, tableId, [{ spot: plein(5), amount: 10_000 }]);

    expect(await balanceOf(host.userId)).toBe(15_000);
  });

  it("laisse engager tout son solde sur un tour, sans plafond de total", async () => {
    const host = await player(10_000);
    const tableId = await createRouletteTable(host);

    await betRoulette(host.userId, tableId, [
      { spot: { kind: "red" }, amount: 6_000 },
      { spot: { kind: "dozen1" }, amount: 4_000 },
    ]);
    currentRound(tableId, host.userId);

    // Tout est engagé : le refus suivant vient des fonds, pas d'une limite.
    const erreur = await errorOf(() =>
      betRoulette(host.userId, tableId, [{ spot: { kind: "even" }, amount: 10 }]),
    );
    expect(erreur.code).toBe("INSUFFICIENT_FUNDS");
    expect(await balanceOf(host.userId)).toBe(0);
  });

  it("refuse une mise sans fonds sans modifier la table", async () => {
    const host = await player(50);
    const tableId = await createRouletteTable(host);

    expect((await errorOf(() => betRoulette(host.userId, tableId, [{ spot: { kind: "red" }, amount: 100 }]))).code)
      .toBe("INSUFFICIENT_FUNDS");
    expect(viewRoulette(tableId, host.userId)).toMatchObject({ phase: "idle", bets: [] });
  });

  it("reprendre ses jetons rembourse et annule le tour resté vide", async () => {
    const host = await player();
    const tableId = await createRouletteTable(host);
    await betRoulette(host.userId, tableId, [{ spot: { kind: "red" }, amount: 300 }]);
    const roundId = currentRound(tableId, host.userId);
    expect(await balanceOf(host.userId)).toBe(4_700);

    await clearRoulette(host.userId, tableId);

    expect(await balanceOf(host.userId)).toBe(5_000);
    expect(await ledgerSum(host.userId)).toBe(0);
    expect(await matchStatus(roundId)).toBe("cancelled");
    expect(viewRoulette(tableId, host.userId)).toMatchObject({ phase: "idle", roundId: null });
  });

  it("le tour continue si un autre joueur garde ses jetons", async () => {
    const host = await player();
    const tableId = await createRouletteTable(host);
    const invite = await player();
    await joinRouletteTable(invite, tableId);

    await betRoulette(host.userId, tableId, [{ spot: { kind: "red" }, amount: 100 }]);
    currentRound(tableId, host.userId);
    await betRoulette(invite.userId, tableId, [{ spot: { kind: "black" }, amount: 100 }]);
    await clearRoulette(host.userId, tableId);

    expect(viewRoulette(tableId, invite.userId)).toMatchObject({ phase: "betting" });
    expect(await balanceOf(host.userId)).toBe(5_000);
  });
});

describe("tirage et règlement", () => {
  it("paie le plein et fait perdre la couleur adverse", async () => {
    setRouletteDurationsForTests({ betting: 5, spin: 5, result: 400 });
    forceResult(17); // 17 est noir
    const host = await player();
    const tableId = await createRouletteTable(host);

    await betRoulette(host.userId, tableId, [
      { spot: { kind: "red" }, amount: 100 },
      { spot: plein(17), amount: 10 },
    ]);
    const roundId = currentRound(tableId, host.userId);

    await until(async () => (await matchStatus(roundId)) === "finished");

    // Rouge perd 100. Le plein rend 10 × 36 = 360. Net : +250.
    expect(await balanceOf(host.userId)).toBe(5_250);
    expect(await ledgerSum(host.userId)).toBe(250);
    expect(viewRoulette(tableId, host.userId)?.history[0]).toBe(17);
  });

  it("le zéro fait tout perdre, sauf le plein sur zéro", async () => {
    setRouletteDurationsForTests({ betting: 5, spin: 5, result: 400 });
    forceResult(0);
    const host = await player();
    const tableId = await createRouletteTable(host);

    await betRoulette(host.userId, tableId, [
      { spot: { kind: "even" }, amount: 100 }, // 0 est pair, et pourtant perdant
      { spot: { kind: "low" }, amount: 100 }, // 0 est inférieur à 18, et pourtant perdant
      { spot: plein(0), amount: 10 },
    ]);
    const roundId = currentRound(tableId, host.userId);

    await until(async () => (await matchStatus(roundId)) === "finished");

    // 210 engagés, 360 rendus par le seul plein sur zéro.
    expect(await balanceOf(host.userId)).toBe(5_150);
    expect(await ledgerSum(host.userId)).toBe(150);
  });

  it("règle chaque joueur pour lui-même", async () => {
    setRouletteDurationsForTests({ betting: 5, spin: 5, result: 400 });
    forceResult(2); // 2 est noir, pair, dans la première douzaine
    const gagnant = await player();
    const perdant = await player();
    const tableId = await createRouletteTable(gagnant);
    await joinRouletteTable(perdant, tableId);

    await betRoulette(gagnant.userId, tableId, [{ spot: { kind: "black" }, amount: 200 }]);
    const roundId = currentRound(tableId, gagnant.userId);
    await betRoulette(perdant.userId, tableId, [{ spot: { kind: "red" }, amount: 200 }]);

    await until(async () => (await matchStatus(roundId)) === "finished");

    expect(await balanceOf(gagnant.userId)).toBe(5_200);
    expect(await balanceOf(perdant.userId)).toBe(4_800);
    // L'invariant du journal tient pour chacun, séparément.
    expect(await ledgerSum(gagnant.userId)).toBe(200);
    expect(await ledgerSum(perdant.userId)).toBe(-200);
  });

  it("rend la table aux mises une fois le résultat affiché", async () => {
    setRouletteDurationsForTests({ betting: 5, spin: 5, result: 5 });
    forceResult(7);
    const host = await player();
    const tableId = await createRouletteTable(host);
    await betRoulette(host.userId, tableId, [{ spot: { kind: "red" }, amount: 50 }]);
    currentRound(tableId, host.userId);

    await until(() => viewRoulette(tableId, host.userId)?.phase === "idle");

    const vue = viewRoulette(tableId, host.userId);
    expect(vue).toMatchObject({ phase: "idle", roundId: null, result: null });
    expect(vue?.bets).toEqual([]);
    // L'historique, lui, survit au tour : c'est le bandeau de la table.
    expect(vue?.history).toEqual([7]);
  });
});

describe("départs et reprise", () => {
  it("quitter pendant les mises rend les jetons", async () => {
    const host = await player();
    const tableId = await createRouletteTable(host);
    const invite = await player();
    await joinRouletteTable(invite, tableId);

    await betRoulette(invite.userId, tableId, [{ spot: { kind: "high" }, amount: 400 }]);
    currentRound(tableId, invite.userId);
    await leaveRoulette(invite.userId, tableId);

    expect(await balanceOf(invite.userId)).toBe(5_000);
    expect(await ledgerSum(invite.userId)).toBe(0);
    expect(viewRoulette(tableId, host.userId)?.players).toHaveLength(1);
  });

  it("le dernier départ ferme la table", async () => {
    const host = await player();
    const tableId = await createRouletteTable(host);

    await leaveRoulette(host.userId, tableId);

    expect(viewRoulette(tableId, host.userId)).toBeNull();
  });

  it("rembourse un tour resté ouvert après un redémarrage, une seule fois", async () => {
    const host = await player();
    const tableId = await createRouletteTable(host);
    await betRoulette(host.userId, tableId, [{ spot: { kind: "red" }, amount: 200 }]);
    currentRound(tableId, host.userId);
    expect(await balanceOf(host.userId)).toBe(4_800);

    await recoverRouletteRounds();
    await recoverRouletteRounds();

    expect(await balanceOf(host.userId)).toBe(5_000);
    expect(await ledgerSum(host.userId)).toBe(0);
  });
});
