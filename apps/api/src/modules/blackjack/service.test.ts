import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { matches } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { AppError } from "../../lib/errors.js";
import { balanceOf, ledgerSum, trackCreated } from "../../test/fixtures.js";
import type { PlayerIdentity } from "../tables/manager.js";
import {
  betBlackjack,
  createBlackjackTable,
  leaveBlackjack,
  recoverBlackjackRounds,
  resetBlackjackForTests,
  setBlackjackDurationsForTests,
  sitBlackjack,
  standBlackjack,
  viewBlackjack,
  watchBlackjackTable,
} from "./service.js";

const created = trackCreated();

async function player(balance = 5_000): Promise<PlayerIdentity> {
  const userId = await created.user(balance);
  return { userId, pseudo: `bj_${userId.slice(0, 6)}`, avatarSeed: userId.slice(0, 8) };
}

/**
 * Entrer et s'asseoir, en deux gestes.
 *
 * C'est désormais le parcours complet : `watchBlackjackTable` n'assoit personne,
 * la place se demande ensuite par son numéro.
 */
async function seatAt(identity: PlayerIdentity, tableId: string, seat: number): Promise<void> {
  await watchBlackjackTable(identity, tableId);
  await sitBlackjack(identity, tableId, seat);
}

/** Attend qu'une condition sur la vue devienne vraie, ou échoue au bout du délai. */
async function until(
  tableId: string,
  userId: string,
  predicate: (view: NonNullable<ReturnType<typeof viewBlackjack>>) => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    const view = viewBlackjack(tableId, userId);
    if (view && predicate(view)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition jamais atteinte");
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

beforeAll(() => runMigrations(), 60_000);
afterEach(() => {
  resetBlackjackForTests();
  setBlackjackDurationsForTests({
    betting: 20_000,
    allBetsPlaced: 3_000,
    insurance: 15_000,
    action: 30_000,
    result: 8_000,
    grace: 45_000,
  });
});
afterAll(() => created.cleanup());

/** Version d'état courante, exigée par chaque intention. */
function version(tableId: string, userId: string): number {
  return viewBlackjack(tableId, userId)?.version ?? -1;
}

/** Millisecondes restantes avant la fin de la phase, vues du joueur. */
function restant(tableId: string, userId: string): number {
  const deadline = viewBlackjack(tableId, userId)?.deadlineAt;
  if (!deadline) throw new Error("échéance absente");
  return new Date(deadline).getTime() - Date.now();
}

describe("table Blackjack", () => {
  it("assied jusqu'à cinq joueurs sans débiter l'entrée", async () => {
    const host = await player();
    const tableId = await createBlackjackTable(host);
    for (let index = 1; index < 5; index += 1) await seatAt(await player(), tableId, index);

    const view = viewBlackjack(tableId, host.userId);
    expect(view).toMatchObject({ game: "blackjack", phase: "idle", maxSeats: 5, you: 0, watching: 0 });
    expect(view?.seats).toHaveLength(5);
    expect(await balanceOf(host.userId)).toBe(5_000);
  });

  it("débite une mise une seule fois et la montre à toute la table", async () => {
    const host = await player();
    const guest = await player();
    const tableId = await createBlackjackTable(host);
    await seatAt(guest, tableId, 1);
    const version = viewBlackjack(tableId, host.userId)?.version ?? -1;

    await betBlackjack(host.userId, tableId, 100, version);
    const roundId = viewBlackjack(tableId, host.userId)?.roundId;
    if (roundId) created.match(roundId);

    const guestView = viewBlackjack(tableId, guest.userId);
    expect(guestView).toMatchObject({ phase: "betting", roundId: expect.any(String) });
    expect(guestView?.seats.find((seat) => seat.userId === host.userId)).toMatchObject({
      initialBet: 100,
      totalWager: 100,
      participating: true,
    });
    expect(await balanceOf(host.userId)).toBe(4_900);
    expect(await ledgerSum(host.userId)).toBe(-100);

    expect((await errorOf(() => betBlackjack(host.userId, tableId, 100, version))).code).toBe("STALE_STATE");
    expect(await balanceOf(host.userId)).toBe(4_900);
  });

  it("écourte la fenêtre dès que tous les joueurs assis ont misé", async () => {
    const host = await player();
    const guest = await player();
    const tableId = await createBlackjackTable(host);
    await seatAt(guest, tableId, 1);

    await betBlackjack(host.userId, tableId, 100, version(tableId, host.userId));
    const roundId = viewBlackjack(tableId, host.userId)?.roundId;
    if (roundId) created.match(roundId);
    // Le voisin n'a pas encore misé : il garde toute la fenêtre.
    expect(restant(tableId, host.userId)).toBeGreaterThan(10_000);

    await betBlackjack(guest.userId, tableId, 100, version(tableId, guest.userId));
    // Plus personne n'est attendu : la donne peut partir.
    expect(restant(tableId, host.userId)).toBeLessThanOrEqual(3_000);
  });

  it("laisse la fenêtre entière à un siège qui saute la manche", async () => {
    const host = await player();
    const passif = await player();
    const tableId = await createBlackjackTable(host);
    await seatAt(passif, tableId, 1);

    await betBlackjack(host.userId, tableId, 100, version(tableId, host.userId));
    const roundId = viewBlackjack(tableId, host.userId)?.roundId;
    if (roundId) created.match(roundId);

    expect(restant(tableId, host.userId)).toBeGreaterThan(10_000);
  });

  it("refuse une mise sans fonds sans modifier la vue", async () => {
    const host = await player(50);
    const tableId = await createBlackjackTable(host);
    const before = viewBlackjack(tableId, host.userId);

    expect((await errorOf(() => betBlackjack(host.userId, tableId, 100, before?.version ?? 0))).code).toBe("INSUFFICIENT_FUNDS");
    expect(viewBlackjack(tableId, host.userId)).toMatchObject({ phase: "idle", version: before?.version });
  });

  it("rembourse une manche restée ouverte après un redémarrage", async () => {
    const host = await player();
    const tableId = await createBlackjackTable(host);
    const version = viewBlackjack(tableId, host.userId)?.version ?? 0;
    await betBlackjack(host.userId, tableId, 200, version);
    const roundId = viewBlackjack(tableId, host.userId)?.roundId;
    if (roundId) created.match(roundId);
    expect(await balanceOf(host.userId)).toBe(4_800);

    await recoverBlackjackRounds();
    await recoverBlackjackRounds();

    expect(await balanceOf(host.userId)).toBe(5_000);
    expect(await ledgerSum(host.userId)).toBe(0);
  });

  it("ferme les mises même si un second joueur change la version", async () => {
    setBlackjackDurationsForTests({ betting: 5, insurance: 5 });
    const host = await player();
    const guest = await player();
    const tableId = await createBlackjackTable(host);
    await seatAt(guest, tableId, 1);
    await betBlackjack(host.userId, tableId, 100, viewBlackjack(tableId, host.userId)?.version ?? 0);
    const roundId = viewBlackjack(tableId, host.userId)?.roundId;
    if (roundId) created.match(roundId);
    await betBlackjack(guest.userId, tableId, 100, viewBlackjack(tableId, guest.userId)?.version ?? 0);

    await new Promise((resolve) => setTimeout(resolve, 30));

    const dealt = viewBlackjack(tableId, host.userId);
    expect(dealt?.phase).not.toBe("betting");
    expect(dealt?.seats.find((seat) => seat.userId === host.userId)?.hands[0]?.cards).toHaveLength(2);
    if (dealt?.phase !== "result") expect(dealt?.dealer.cards[1]).toBeNull();
  });

  it("annule la manche lorsque le dernier joueur retire sa mise avant la donne", async () => {
    const host = await player();
    const tableId = await createBlackjackTable(host);
    await betBlackjack(host.userId, tableId, 100, viewBlackjack(tableId, host.userId)?.version ?? 0);
    const roundId = viewBlackjack(tableId, host.userId)?.roundId;
    if (!roundId) throw new Error("manche absente");
    created.match(roundId);

    await leaveBlackjack(host.userId, tableId);

    expect(await balanceOf(host.userId)).toBe(5_000);
    const [match] = await db.select({ status: matches.status }).from(matches).where(eq(matches.id, roundId));
    expect(match?.status).toBe("cancelled");
  });
});

describe("spectateurs Blackjack", () => {
  it("entrer à la table ne donne pas de place et ne débite rien", async () => {
    const host = await player();
    const tableId = await createBlackjackTable(host);
    const curieux = await player();

    await watchBlackjackTable(curieux, tableId);

    const vue = viewBlackjack(tableId, curieux.userId);
    expect(vue).toMatchObject({ you: null, watching: 1 });
    // Le spectateur voit bien la table : sans cela le mode n'existe pas.
    expect(vue?.seats.find((seat) => seat.userId === host.userId)).toBeDefined();
    expect(await balanceOf(curieux.userId)).toBe(5_000);
  });

  it("la carte fermée du croupier reste fermée pour un spectateur", async () => {
    setBlackjackDurationsForTests({ betting: 5, insurance: 5 });
    const host = await player();
    const tableId = await createBlackjackTable(host);
    const curieux = await player();
    await watchBlackjackTable(curieux, tableId);

    await betBlackjack(host.userId, tableId, 100, viewBlackjack(tableId, host.userId)?.version ?? 0);
    const roundId = viewBlackjack(tableId, host.userId)?.roundId;
    if (roundId) created.match(roundId);
    await until(tableId, curieux.userId, (view) => view.dealer.cards.length > 0);

    const vue = viewBlackjack(tableId, curieux.userId);
    if (vue?.phase !== "result" && vue?.phase !== "dealer") {
      expect(vue?.dealer.cards[1]).toBeNull();
    }
  });

  it("s'asseoir prend la place demandée, pas la première libre", async () => {
    const host = await player();
    const tableId = await createBlackjackTable(host);
    const invite = await player();

    await seatAt(invite, tableId, 3);

    expect(viewBlackjack(tableId, invite.userId)).toMatchObject({ you: 3, watching: 0 });
  });

  it("refuse une place déjà occupée", async () => {
    const host = await player();
    const tableId = await createBlackjackTable(host);
    const invite = await player();
    await seatAt(invite, tableId, 2);
    const retardataire = await player();
    await watchBlackjackTable(retardataire, tableId);

    expect((await errorOf(() => sitBlackjack(retardataire, tableId, 2))).code).toBe("BLACKJACK_SEAT_TAKEN");
    // Le refus laisse le demandeur spectateur, pas dehors.
    expect(viewBlackjack(tableId, retardataire.userId)).toMatchObject({ you: null, watching: 1 });
  });

  it("une table complète reste ouverte aux spectateurs", async () => {
    const host = await player();
    const tableId = await createBlackjackTable(host);
    for (let index = 1; index < 5; index += 1) await seatAt(await player(), tableId, index);
    const curieux = await player();

    await watchBlackjackTable(curieux, tableId);

    expect(viewBlackjack(tableId, curieux.userId)).toMatchObject({ you: null, watching: 1 });
  });

  it("se lever rend la place et laisse le joueur à la table", async () => {
    const host = await player();
    const tableId = await createBlackjackTable(host);
    const invite = await player();
    await seatAt(invite, tableId, 1);

    await standBlackjack(invite.userId, tableId);

    const vue = viewBlackjack(tableId, invite.userId);
    expect(vue).toMatchObject({ you: null, watching: 1 });
    expect(vue?.seats.some((seat) => seat.userId === invite.userId)).toBe(false);
    // La place est réellement libre : quelqu'un d'autre peut la prendre.
    const suivant = await player();
    await seatAt(suivant, tableId, 1);
    expect(viewBlackjack(tableId, suivant.userId)).toMatchObject({ you: 1 });
  });

  it("se lever avec une mise engagée attend le règlement", async () => {
    const host = await player();
    const tableId = await createBlackjackTable(host);
    await betBlackjack(host.userId, tableId, 100, viewBlackjack(tableId, host.userId)?.version ?? 0);
    const roundId = viewBlackjack(tableId, host.userId)?.roundId;
    if (roundId) created.match(roundId);

    await standBlackjack(host.userId, tableId);

    // Toujours assis, mais marqué partant : on ne reprend pas les jetons d'une
    // main engagée.
    expect(viewBlackjack(tableId, host.userId)).toMatchObject({ you: 0 });
    expect(viewBlackjack(tableId, host.userId)?.seats[0]).toMatchObject({ standingAfterRound: true });
  });

  it("lève un joueur qui n'a pas misé depuis trois manches", async () => {
    setBlackjackDurationsForTests({ betting: 5, insurance: 5, action: 5, result: 5 });
    const actif = await player();
    const tableId = await createBlackjackTable(actif);
    const passif = await player();
    await seatAt(passif, tableId, 1);

    // Trois manches menées par le seul joueur actif. Le passif garde sa place
    // aux deux premières, et la perd à la troisième.
    for (let manche = 0; manche < 3; manche += 1) {
      await until(tableId, actif.userId, (view) => view.phase === "idle");
      const vue = viewBlackjack(tableId, actif.userId);
      if (!vue) throw new Error("table disparue");
      await betBlackjack(actif.userId, tableId, 10, vue.version);
      const roundId = viewBlackjack(tableId, actif.userId)?.roundId;
      if (roundId) created.match(roundId);
      await until(tableId, actif.userId, (view) => view.phase === "idle");

      const place = viewBlackjack(tableId, actif.userId)?.seats.find((seat) => seat.seat === 1);
      if (manche < 2) expect(place?.idleRounds).toBe(manche + 1);
      else expect(place).toBeUndefined();
    }

    // Levé, mais toujours à la table : il regarde et peut se rasseoir.
    expect(viewBlackjack(tableId, passif.userId)).toMatchObject({ you: null, watching: 1 });
  }, 30_000);

  it("miser remet le compteur d'inactivité à zéro", async () => {
    setBlackjackDurationsForTests({ betting: 5, insurance: 5, action: 5, result: 5 });
    const actif = await player();
    const tableId = await createBlackjackTable(actif);
    const intermittent = await player();
    await seatAt(intermittent, tableId, 1);

    // Manche 1 : l'intermittent laisse passer.
    await betBlackjack(actif.userId, tableId, 10, viewBlackjack(tableId, actif.userId)?.version ?? 0);
    let roundId = viewBlackjack(tableId, actif.userId)?.roundId;
    if (roundId) created.match(roundId);
    await until(tableId, actif.userId, (view) => view.phase === "idle");
    expect(viewBlackjack(tableId, actif.userId)?.seats.find((s) => s.seat === 1)?.idleRounds).toBe(1);

    // Manche 2 : il mise, le compteur repart de zéro.
    await betBlackjack(intermittent.userId, tableId, 10, viewBlackjack(tableId, intermittent.userId)?.version ?? 0);
    roundId = viewBlackjack(tableId, actif.userId)?.roundId;
    if (roundId) created.match(roundId);
    await until(tableId, actif.userId, (view) => view.phase === "idle");

    expect(viewBlackjack(tableId, actif.userId)?.seats.find((s) => s.seat === 1)?.idleRounds).toBe(0);
  }, 30_000);

  it("la table survit tant qu'un spectateur la regarde", async () => {
    const host = await player();
    const tableId = await createBlackjackTable(host);
    const curieux = await player();
    await watchBlackjackTable(curieux, tableId);

    await leaveBlackjack(host.userId, tableId);

    // Détruire la table sous les yeux du spectateur le laisserait devant un
    // écran mort, sans avoir rien demandé.
    expect(viewBlackjack(tableId, curieux.userId)).toMatchObject({ you: null, watching: 1 });
    expect(viewBlackjack(tableId, curieux.userId)?.seats).toHaveLength(0);

    await leaveBlackjack(curieux.userId, tableId);
    expect(viewBlackjack(tableId, curieux.userId)).toBeNull();
  });

  it("un spectateur qui s'en va libère son verrou d'activité", async () => {
    const host = await player();
    const tableId = await createBlackjackTable(host);
    const curieux = await player();
    await watchBlackjackTable(curieux, tableId);

    await leaveBlackjack(curieux.userId, tableId);

    // Sans libération, il resterait bloqué pour tous les autres jeux.
    expect(viewBlackjack(tableId, host.userId)).toMatchObject({ watching: 0 });
    await expect(watchBlackjackTable(curieux, tableId)).resolves.toBe(tableId);
  });
});
