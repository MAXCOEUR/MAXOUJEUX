import { GRACE_MS, TURN_MS, WAITING_TTL_MS, getGame } from "@maxoujeux/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { matchPlayers, matches, stats } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { balanceOf, ledgerSum, primes, trackCreated } from "../../test/fixtures.js";
import { releaseActivity, reserveActivity } from "../games/activity.js";
import {
  armedTimerCount,
  attach,
  createTable,
  detach,
  joinTable,
  leave,
  play,
  resetForTests,
  salonSnapshot,
  setDurationsForTests,
  tableCounts,
  tableOf,
  viewFor,
  type PlayerIdentity,
} from "./manager.js";

/**
 * Tests d'intégration du gestionnaire de tables.
 *
 * Les scénarios de simultanéité portent sur la **réservation en mémoire** et non
 * sur la base : c'est du code synchrone mono-thread, il se comporte donc de la
 * même façon sur PGlite et sur PostgreSQL. Les mouvements de MaxouCoin, eux,
 * doivent être rejoués sur un vrai PostgreSQL (voir `src/test/fixtures.ts`).
 */

const created = trackCreated();

/** Crée un compte et son identité de joueur, avec un solde de départ. */
async function player(balance = 1_000): Promise<PlayerIdentity> {
  const userId = await created.user(balance);
  return { userId, pseudo: `j_${userId.slice(0, 6)}`, avatarSeed: userId.slice(0, 8) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Version courante de l'état, exigée par `play`. */
function versionOf(tableId: string): number {
  const view = viewFor(tableId, null);
  if (!view) throw new Error("table introuvable");
  return view.version;
}

/** Joue une suite de coups en alternant les deux joueurs, en partant du siège 0. */
async function playSequence(
  tableId: string,
  seat0: PlayerIdentity,
  seat1: PlayerIdentity,
  moves: number[],
): Promise<void> {
  for (const [index, move] of moves.entries()) {
    const actor = index % 2 === 0 ? seat0 : seat1;
    await play(actor.userId, tableId, move, versionOf(tableId));
  }
}

/** Ouvre une table et y assied un adversaire. */
async function seatedTable(
  game: "connect4" | "tictactoe",
  stake: number,
  host: PlayerIdentity,
  guest: PlayerIdentity,
): Promise<string> {
  const tableId = await createTable(host, game, stake);
  created.match(tableId);
  await joinTable(guest, tableId);
  return tableId;
}

async function errorOf(work: () => Promise<unknown>): Promise<AppError> {
  try {
    await work();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("aucune erreur levée alors qu'une était attendue");
}

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterEach(() => {
  resetForTests();
  setDurationsForTests({
    turn: TURN_MS,
    grace: GRACE_MS,
    waitingTtl: WAITING_TTL_MS,
    resultTtl: 120_000,
  });
});

afterAll(async () => {
  await created.cleanup();
});

describe("ouverture d'une table", () => {
  it("engage la mise de l'hôte et publie la table dans le salon", async () => {
    const host = await player(1_000);
    const tableId = await createTable(host, "connect4", 20);
    created.match(tableId);

    expect(await balanceOf(host.userId)).toBe(980);

    const salon = salonSnapshot("connect4");
    expect(salon.tables).toHaveLength(1);
    expect(salon.tables[0]).toMatchObject({
      id: tableId,
      stake: 20,
      status: "waiting",
      maxSeats: 2,
    });
    expect(salon.tables[0]?.seats).toHaveLength(1);
    expect(salon.used).toBe(1);
    expect(salon.max).toBe(getGame("connect4")?.maxTables);
  });

  it("écrit la partie et le siège en base", async () => {
    const host = await player();
    const tableId = await createTable(host, "tictactoe", 10);
    created.match(tableId);

    const [match] = await db.select().from(matches).where(eq(matches.id, tableId));
    expect(match).toMatchObject({ game: "tictactoe", status: "waiting" });
    expect(match?.config).toEqual({ stake: 10 });

    const seats = await db.select().from(matchPlayers).where(eq(matchPlayers.matchId, tableId));
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ userId: host.userId, seat: 0, chipsDelta: 0 });
  });

  it("refuse une mise hors barème sans rien débiter", async () => {
    const host = await player(1_000);

    // 110 n'est plus hors barème : le plafond a disparu, seuls le minimum et
    // le pas de 10 subsistent.
    for (const stake of [0, 5, 37, 105]) {
      const error = await errorOf(() => createTable(host, "connect4", stake));
      expect(error.code).toBe("STAKE_INVALID");
    }

    expect(await balanceOf(host.userId)).toBe(1_000);
    expect(salonSnapshot("connect4").used).toBe(0);
  });

  it("refuse un joueur sans les fonds et relâche la place au plafond", async () => {
    const pauvre = await player(50);

    const error = await errorOf(() => createTable(pauvre, "connect4", 100));
    expect(error.code).toBe("INSUFFICIENT_FUNDS");

    // Le point important : la réservation en mémoire a bien été annulée. Sans
    // cela, un joueur fauché consommerait une place des dix disponibles.
    expect(salonSnapshot("connect4").used).toBe(0);
    expect(tableOf(pauvre.userId)).toBeNull();
    expect(await balanceOf(pauvre.userId)).toBe(50);
  });

  it("applique le plafond de tables simultanées", async () => {
    const max = getGame("connect4")?.maxTables ?? 0;
    expect(max).toBe(10);

    for (let i = 0; i < max; i += 1) {
      const host = await player();
      created.match(await createTable(host, "connect4", 10));
    }

    const surnombre = await player();
    const error = await errorOf(() => createTable(surnombre, "connect4", 10));
    expect(error.code).toBe("CAPACITY_REACHED");
    expect(await balanceOf(surnombre.userId)).toBe(1_000);

    // Le plafond est par jeu : le Morpion reste ouvert.
    const autreJeu = await player();
    created.match(await createTable(autreJeu, "tictactoe", 10));
    expect(salonSnapshot("tictactoe").used).toBe(1);
  });

  it("interdit deux parties simultanées au même joueur", async () => {
    const host = await player();
    created.match(await createTable(host, "connect4", 10));

    const encore = await errorOf(() => createTable(host, "tictactoe", 10));
    expect(encore.code).toBe("ALREADY_IN_GAME");
    // Un seul débit, pas deux.
    expect(await balanceOf(host.userId)).toBe(990);
  });

  it("refuse une table quand le joueur a une session Motus active", async () => {
    const host = await player();
    const motus = { kind: "motus", id: "2026-08-11T18:00:00.000Z" } as const;
    reserveActivity(host.userId, motus);

    try {
      const error = await errorOf(() => createTable(host, "connect4", 10));
      expect(error.code).toBe("ALREADY_IN_GAME");
      expect(await balanceOf(host.userId)).toBe(1_000);
    } finally {
      releaseActivity(host.userId, motus);
    }
  });
});

describe("jointure d'une table", () => {
  it("lance la partie et débite le second joueur", async () => {
    const host = await player();
    const guest = await player();
    const tableId = await seatedTable("connect4", 30, host, guest);

    expect(await balanceOf(host.userId)).toBe(970);
    expect(await balanceOf(guest.userId)).toBe(970);

    const view = viewFor(tableId, guest.userId);
    expect(view).toMatchObject({ status: "playing", pot: 60, you: 1, turn: 0 });
    expect(view?.cells).toHaveLength(42);
    expect(view?.deadlineAt).not.toBeNull();
    expect(view?.turnMs).toBe(TURN_MS);

    const [match] = await db.select().from(matches).where(eq(matches.id, tableId));
    expect(match?.status).toBe("playing");
    expect(match?.startedAt).not.toBeNull();
  });

  it("n'accepte qu'un seul joueur quand deux se présentent en même temps", async () => {
    const host = await player();
    const premier = await player();
    const second = await player();
    const tableId = await createTable(host, "connect4", 10);
    created.match(tableId);

    // Le siège est occupé de façon synchrone, avant le débit : sans cette
    // réservation, les deux demandes verraient un siège libre pendant l'attente
    // de la base et la table finirait avec trois joueurs.
    const results = await Promise.allSettled([
      joinTable(premier, tableId),
      joinTable(second, tableId),
    ]);

    const acceptés = results.filter((result) => result.status === "fulfilled");
    const refusés = results.filter((result) => result.status === "rejected");
    expect(acceptés).toHaveLength(1);
    expect(refusés).toHaveLength(1);

    const view = viewFor(tableId, null);
    expect(view?.seats).toHaveLength(2);

    // Le joueur refusé n'a rien payé.
    const seated = new Set(view?.seats.map((seat) => seat.userId));
    const dehors = [premier, second].find((candidat) => !seated.has(candidat.userId));
    expect(dehors).toBeDefined();
    expect(await balanceOf(dehors!.userId)).toBe(1_000);
    expect(tableOf(dehors!.userId)).toBeNull();
  });

  it("refuse une table complète, inconnue, ou la sienne", async () => {
    const host = await player();
    const guest = await player();
    const tardif = await player();
    const tableId = await seatedTable("connect4", 10, host, guest);

    expect((await errorOf(() => joinTable(tardif, tableId))).code).toBe("TABLE_FULL");
    expect((await errorOf(() => joinTable(host, tableId))).code).toBe("ALREADY_IN_GAME");
    expect(
      (await errorOf(() => joinTable(tardif, "00000000-0000-4000-8000-000000000000"))).code,
    ).toBe("TABLE_GONE");
  });
});

describe("déroulement d'une partie", () => {
  it("verse 1,5 × la mise au vainqueur et écrit les statistiques", async () => {
    const host = await player(1_000);
    const guest = await player(1_000);
    const tableId = await seatedTable("tictactoe", 20, host, guest);

    // Siège 0 aligne 0-1-2 ; siège 1 occupe 3 et 4.
    await playSequence(tableId, host, guest, [0, 3, 1, 4, 2]);

    const view = viewFor(tableId, host.userId);
    expect(view?.status).toBe("finished");
    expect(view?.outcome).toMatchObject({ reason: "line", winnerSeat: 0 });
    expect(view?.winningLine).toEqual([0, 1, 2]);
    expect(view?.deadlineAt).toBeNull();

    // 20 MC engagés de chaque côté, 30 MC versés : 10 MC quittent l'économie.
    // Le vainqueur touche en plus la prime de sa toute première victoire.
    expect(await balanceOf(host.userId)).toBe(1_010 + primes("premier_gain"));
    expect(await balanceOf(guest.userId)).toBe(980);
    expect(view?.outcome?.deltas).toEqual([
      { seat: 0, delta: 10 },
      { seat: 1, delta: -20 },
    ]);

    const [gagnant] = await db
      .select()
      .from(stats)
      .where(and(eq(stats.userId, host.userId), eq(stats.game, "tictactoe")));
    expect(gagnant).toMatchObject({ played: 1, won: 1, lost: 0, drawn: 0, winStreak: 1 });

    const [perdant] = await db
      .select()
      .from(stats)
      .where(and(eq(stats.userId, guest.userId), eq(stats.game, "tictactoe")));
    expect(perdant).toMatchObject({ played: 1, won: 0, lost: 1, drawn: 0 });

    const [ligneGagnante] = await db
      .select()
      .from(matchPlayers)
      .where(and(eq(matchPlayers.matchId, tableId), eq(matchPlayers.userId, host.userId)));
    expect(ligneGagnante).toMatchObject({ result: "win", chipsDelta: 10 });

    // La place est libérée tout de suite : les deux peuvent relancer une partie.
    expect(tableOf(host.userId)).toBeNull();
    expect(tableOf(guest.userId)).toBeNull();
    expect(salonSnapshot("tictactoe").used).toBe(0);
  });

  it("rembourse les deux mises en cas d'égalité", async () => {
    const host = await player(1_000);
    const guest = await player(1_000);
    const tableId = await seatedTable("tictactoe", 50, host, guest);

    await playSequence(tableId, host, guest, [0, 4, 2, 1, 3, 5, 7, 6, 8]);

    const view = viewFor(tableId, host.userId);
    expect(view?.status).toBe("finished");
    expect(view?.outcome).toMatchObject({ reason: "draw", winnerSeat: null });
    expect(await balanceOf(host.userId)).toBe(1_000);
    expect(await balanceOf(guest.userId)).toBe(1_000);

    const lignes = await db.select().from(stats).where(eq(stats.game, "tictactoe"));
    const nulles = lignes.filter((ligne) =>
      [host.userId, guest.userId].includes(ligne.userId),
    );
    expect(nulles).toHaveLength(2);
    expect(nulles.every((ligne) => ligne.drawn === 1 && ligne.played === 1)).toBe(true);
  });

  it("laisse le journal égal au solde", async () => {
    const host = await player(1_000);
    const guest = await player(1_000);
    const tableId = await seatedTable("connect4", 10, host, guest);

    // Siège 0 empile la colonne 1, siège 1 la colonne 2 : victoire verticale.
    await playSequence(tableId, host, guest, [1, 2, 1, 2, 1, 2, 1]);

    for (const joueur of [host, guest]) {
      const solde = await balanceOf(joueur.userId);
      const journal = await ledgerSum(joueur.userId);
      // Le solde initial est posé sans écriture au journal : c'est l'écart
      // attendu, tout le reste doit correspondre au centime.
      expect(journal).toBe(solde - 1_000);
    }
  });

  it("refuse un coup hors tour, sur un état périmé, ou d'un tiers", async () => {
    const host = await player();
    const guest = await player();
    const curieux = await player();
    const tableId = await seatedTable("connect4", 10, host, guest);

    const version = versionOf(tableId);
    expect((await errorOf(() => play(guest.userId, tableId, 0, version))).code).toBe(
      "NOT_YOUR_TURN",
    );
    expect((await errorOf(() => play(curieux.userId, tableId, 0, version))).code).toBe(
      "NOT_IN_GAME",
    );
    expect((await errorOf(() => play(host.userId, tableId, 0, version - 1))).code).toBe(
      "STALE_STATE",
    );

    // Un coup illégal remonte du moteur, pas du gestionnaire.
    await expect(play(host.userId, tableId, 99, version)).rejects.toThrow("OUT_OF_BOUNDS");
  });

  it("refuse tout coup après la fin de la partie", async () => {
    const host = await player();
    const guest = await player();
    const tableId = await seatedTable("tictactoe", 10, host, guest);
    await playSequence(tableId, host, guest, [0, 3, 1, 4, 2]);

    const error = await errorOf(() => play(guest.userId, tableId, 8, versionOf(tableId)));
    expect(error.code).toBe("GAME_OVER");
  });
});

describe("forfaits et abandons", () => {
  it("déclare forfait le joueur qui laisse filer son temps", async () => {
    setDurationsForTests({ turn: 40 });
    const host = await player(1_000);
    const guest = await player(1_000);
    const tableId = await seatedTable("connect4", 20, host, guest);

    // C'est au siège 0 de jouer : c'est lui qui perd.
    await sleep(200);

    const view = viewFor(tableId, host.userId);
    expect(view?.status).toBe("finished");
    expect(view?.outcome).toMatchObject({ reason: "timeout", winnerSeat: 1 });
    expect(await balanceOf(host.userId)).toBe(980);
    expect(await balanceOf(guest.userId)).toBe(1_010 + primes("premier_gain"));

    const [ligne] = await db
      .select()
      .from(matchPlayers)
      .where(and(eq(matchPlayers.matchId, tableId), eq(matchPlayers.userId, host.userId)));
    // Un dépassement n'est pas une défaite jouée : le journal le distingue.
    expect(ligne?.result).toBe("abandon");
  });

  it("réarme le compte à rebours à chaque coup", async () => {
    setDurationsForTests({ turn: 120 });
    const host = await player();
    const guest = await player();
    const tableId = await seatedTable("connect4", 10, host, guest);

    // Trois coups espacés de 80 ms : sans réarmement, la partie serait perdue
    // par forfait avant le troisième.
    for (const move of [0, 1, 2]) {
      await sleep(80);
      await play(
        viewFor(tableId, null)?.turn === 0 ? host.userId : guest.userId,
        tableId,
        move,
        versionOf(tableId),
      );
    }

    expect(viewFor(tableId, null)?.status).toBe("playing");
  });

  it("accorde un sursis à la déconnexion puis déclare l'abandon", async () => {
    setDurationsForTests({ grace: 50, turn: 5_000 });
    const host = await player(1_000);
    const guest = await player(1_000);
    const tableId = await seatedTable("connect4", 20, host, guest);

    detach(host.userId);
    expect(viewFor(tableId, guest.userId)?.seats.find((s) => s.seat === 0)?.connected).toBe(false);
    expect(viewFor(tableId, null)?.status).toBe("playing");

    await sleep(200);

    const view = viewFor(tableId, host.userId);
    expect(view?.status).toBe("finished");
    expect(view?.outcome).toMatchObject({ reason: "abandon", winnerSeat: 1 });
    expect(await balanceOf(guest.userId)).toBe(1_010 + primes("premier_gain"));
  });

  it("reprend la partie si le joueur revient avant la fin du sursis", async () => {
    setDurationsForTests({ grace: 150, turn: 5_000 });
    const host = await player();
    const guest = await player();
    const tableId = await seatedTable("connect4", 10, host, guest);

    detach(host.userId);
    await sleep(40);
    expect(attach(host.userId)).toBe(tableId);

    await sleep(200);

    const view = viewFor(tableId, host.userId);
    expect(view?.status).toBe("playing");
    expect(view?.seats.find((seat) => seat.seat === 0)?.connected).toBe(true);
  });

  it("n'arme aucun sursis quand un second onglet se ferme", async () => {
    setDurationsForTests({ grace: 50, turn: 5_000 });
    const host = await player();
    const guest = await player();
    const tableId = await seatedTable("connect4", 10, host, guest);

    // Deuxième appareil du même compte, puis fermeture de celui-ci.
    attach(host.userId);
    detach(host.userId);
    await sleep(150);

    expect(viewFor(tableId, null)?.status).toBe("playing");
    expect(viewFor(tableId, null)?.seats.find((seat) => seat.seat === 0)?.connected).toBe(true);
  });

  it("compte l'abandon comme une défaite dans les statistiques", async () => {
    const host = await player();
    const guest = await player();
    const tableId = await seatedTable("tictactoe", 10, host, guest);

    await leave(host.userId, tableId);

    const [perdant] = await db
      .select()
      .from(stats)
      .where(and(eq(stats.userId, host.userId), eq(stats.game, "tictactoe")));
    expect(perdant).toMatchObject({ played: 1, won: 0, lost: 1, drawn: 0 });
  });
});

describe("tables en attente abandonnées", () => {
  it("rembourse et libère la place quand l'hôte s'en va", async () => {
    const host = await player(1_000);
    const tableId = await createTable(host, "connect4", 40);
    created.match(tableId);

    await leave(host.userId, tableId);

    expect(await balanceOf(host.userId)).toBe(1_000);
    expect(salonSnapshot("connect4").used).toBe(0);
    expect(tableOf(host.userId)).toBeNull();
    expect(viewFor(tableId, host.userId)).toBeNull();

    const [match] = await db.select().from(matches).where(eq(matches.id, tableId));
    // La ligne est conservée : `wallet_tx.match_id` n'a pas de clé étrangère,
    // la supprimer laisserait le journal pointer dans le vide.
    expect(match?.status).toBe("cancelled");
  });

  it("annule une table restée sans adversaire", async () => {
    setDurationsForTests({ waitingTtl: 40, grace: 5_000 });
    const host = await player(1_000);
    const tableId = await createTable(host, "connect4", 30);
    created.match(tableId);

    await sleep(200);

    expect(await balanceOf(host.userId)).toBe(1_000);
    expect(salonSnapshot("connect4").used).toBe(0);
  });

  it("annule la table si l'hôte se déconnecte avant qu'un adversaire arrive", async () => {
    setDurationsForTests({ grace: 40, waitingTtl: 5_000 });
    const host = await player(1_000);
    const tableId = await createTable(host, "connect4", 10);
    created.match(tableId);

    detach(host.userId);
    await sleep(200);

    expect(await balanceOf(host.userId)).toBe(1_000);
    expect(salonSnapshot("connect4").used).toBe(0);
  });
});

describe("lecture et arrêt", () => {
  it("trie les tables en attente avant les parties en cours", async () => {
    const a = await player();
    const b = await player();
    const c = await player();
    const enCours = await seatedTable("connect4", 10, a, b);
    const enAttente = await createTable(c, "connect4", 10);
    created.match(enAttente);

    const salon = salonSnapshot("connect4");
    expect(salon.tables.map((table) => table.id)).toEqual([enAttente, enCours]);
    expect(salon.used).toBe(2);
  });

  it("compte les tables par jeu pour le lobby", async () => {
    const a = await player();
    const b = await player();
    const c = await player();
    created.match(await seatedTable("connect4", 10, a, b));
    created.match(await createTable(c, "tictactoe", 10));

    expect(tableCounts()).toEqual({
      connect4: { waiting: 0, playing: 1, max: 10 },
      tictactoe: { waiting: 1, playing: 0, max: 10 },
      blackjack: { waiting: 0, playing: 0, max: 1 },
      roulette: { waiting: 0, playing: 0, max: 1 },
      // Une table de Plinko ou de machine à sous est toujours « en cours » :
      // il n'y a personne à y attendre.
      plinko: { waiting: 0, playing: 0, max: 10 },
      slots: { waiting: 0, playing: 0, max: 10 },
      // Une seule table de poker sur le site.
      poker: { waiting: 0, playing: 0, max: 1 },
    });
  });

  it("ne laisse aucune minuterie armée après l'arrêt", async () => {
    const a = await player();
    const b = await player();
    const c = await player();
    created.match(await seatedTable("connect4", 10, a, b));
    created.match(await createTable(c, "tictactoe", 10));
    detach(a.userId);

    expect(armedTimerCount()).toBeGreaterThan(0);
    resetForTests();
    expect(armedTimerCount()).toBe(0);
  });
});
