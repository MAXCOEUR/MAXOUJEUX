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
  joinBlackjackTable,
  leaveBlackjack,
  recoverBlackjackRounds,
  resetBlackjackForTests,
  setBlackjackDurationsForTests,
  viewBlackjack,
} from "./service.js";

const created = trackCreated();

async function player(balance = 5_000): Promise<PlayerIdentity> {
  const userId = await created.user(balance);
  return { userId, pseudo: `bj_${userId.slice(0, 6)}`, avatarSeed: userId.slice(0, 8) };
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
  setBlackjackDurationsForTests({ betting: 20_000, insurance: 15_000, action: 30_000, result: 8_000, grace: 45_000 });
});
afterAll(() => created.cleanup());

describe("table Blackjack", () => {
  it("assied jusqu'à cinq joueurs sans débiter l'entrée", async () => {
    const host = await player();
    const tableId = await createBlackjackTable(host);
    for (let index = 0; index < 4; index += 1) await joinBlackjackTable(await player(), tableId);

    const view = viewBlackjack(tableId, host.userId);
    expect(view).toMatchObject({ game: "blackjack", phase: "idle", maxSeats: 5, you: 0 });
    expect(view?.seats).toHaveLength(5);
    expect(await balanceOf(host.userId)).toBe(5_000);

    const overflow = await player();
    expect((await errorOf(() => joinBlackjackTable(overflow, tableId))).code).toBe("TABLE_FULL");
  });

  it("débite une mise une seule fois et la montre à toute la table", async () => {
    const host = await player();
    const guest = await player();
    const tableId = await createBlackjackTable(host);
    await joinBlackjackTable(guest, tableId);
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
    await joinBlackjackTable(guest, tableId);
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
