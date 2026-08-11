import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { currentMotusSlot } from "@maxoujeux/shared";
import { db, runMigrations } from "../../db/index.js";
import { motusAttempts, motusSlots, walletTx } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { balanceOf, ledgerSum, trackCreated } from "../../test/fixtures.js";
import { releaseActivity, reserveActivity } from "../games/activity.js";
import { abandon, activeCount, guess, shutdown, start, unwatch, watch } from "./service.js";

const created = trackCreated();
const NOW = new Date("2026-08-11T12:30:00.000Z");
const LATER = new Date("2026-08-11T18:30:00.000Z");
const touchedSlots = new Set<number>();

async function player(balance = 1_000): Promise<string> {
  return created.user(balance);
}

async function fixedSlot(now: Date, word = "ECOLE"): Promise<void> {
  const slot = currentMotusSlot(now);
  touchedSlots.add(slot.start.getTime());
  await db
    .insert(motusSlots)
    .values({ slotStart: slot.start, word, length: word.length })
    .onConflictDoUpdate({
      target: motusSlots.slotStart,
      set: { word, length: word.length },
    });
}

async function appError(work: () => Promise<unknown>): Promise<AppError> {
  try {
    await work();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("aucune erreur levée");
}

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterEach(() => {
  shutdown();
});

afterAll(async () => {
  await created.cleanup();
  for (const startAt of touchedSlots) {
    await db.delete(motusSlots).where(eq(motusSlots.slotStart, new Date(startAt)));
  }
});

describe("démarrage Motus", () => {
  it("présente le mot courant sans débiter avant confirmation", async () => {
    await fixedSlot(NOW);
    const userId = await player();

    const view = await watch(userId, "socket-1", NOW);

    expect(view).toMatchObject({ status: "available", length: 5, stake: 100, version: 0 });
    expect(await balanceOf(userId)).toBe(1_000);
  });

  it("ne débite qu'une fois deux démarrages concurrents", async () => {
    await fixedSlot(NOW);
    const userId = await player();

    const [first, second] = await Promise.all([
      start(userId, "socket-1", NOW),
      start(userId, "socket-1", NOW),
    ]);

    expect(first.status).toBe("playing");
    expect(second.status).toBe("playing");
    expect(await balanceOf(userId)).toBe(900);
    expect(await ledgerSum(userId)).toBe(-100);
    const stakes = await db
      .select()
      .from(walletTx)
      .where(and(eq(walletTx.userId, userId), eq(walletTx.reason, "motus_stake")));
    expect(stakes).toHaveLength(1);
  });

  it("ne crée aucune tentative lorsque les fonds manquent", async () => {
    await fixedSlot(NOW);
    const userId = await player(50);

    const error = await appError(() => start(userId, "socket-1", NOW));
    expect(error.code).toBe("INSUFFICIENT_FUNDS");
    expect(await db.select().from(motusAttempts).where(eq(motusAttempts.userId, userId))).toHaveLength(0);
  });

  it("refuse Motus lorsqu'une table est déjà active", async () => {
    await fixedSlot(NOW);
    const userId = await player();
    const table = { kind: "table", id: "table-1" } as const;
    reserveActivity(userId, table);

    try {
      const error = await appError(() => start(userId, "socket-1", NOW));
      expect(error.code).toBe("ALREADY_IN_GAME");
    } finally {
      releaseActivity(userId, table);
    }
  });

  it("plafonne à dix sessions réellement ouvertes", async () => {
    await fixedSlot(NOW);
    for (let index = 0; index < 10; index += 1) {
      const userId = await player();
      await start(userId, `socket-${index}`, NOW);
    }
    const overflow = await player();

    const error = await appError(() => start(overflow, "socket-overflow", NOW));

    expect(error.code).toBe("MOTUS_CAPACITY_REACHED");
    expect(await balanceOf(overflow)).toBe(1_000);
  });
});

describe("propositions Motus", () => {
  it("verse 600 MC pour une solution trouvée au premier essai", async () => {
    await fixedSlot(NOW);
    const userId = await player();
    const initial = await start(userId, "socket-1", NOW);

    const result = await guess(userId, "socket-1", { guess: "école", version: initial.version }, NOW);

    expect(result).toMatchObject({
      status: "won",
      endReason: "solved",
      payout: 600,
      net: 500,
      attemptsLeft: 5,
    });
    expect(result.guesses[0]?.marks).toEqual([
      "correct",
      "correct",
      "correct",
      "correct",
      "correct",
    ]);
    expect(await balanceOf(userId)).toBe(1_500);
    expect(await ledgerSum(userId)).toBe(500);
  });

  it("refuse un mot inconnu ou trop long sans consommer d'essai", async () => {
    await fixedSlot(NOW);
    const userId = await player();
    const initial = await start(userId, "socket-1", NOW);

    expect((await appError(() => guess(userId, "socket-1", { guess: "QZXQZ", version: 0 }, NOW))).code).toBe(
      "MOTUS_UNKNOWN_WORD",
    );
    expect((await appError(() => guess(userId, "socket-1", { guess: "MAISONS", version: 0 }, NOW))).code).toBe(
      "MOTUS_INVALID_LENGTH",
    );

    const resumed = await watch(userId, "socket-1", NOW);
    expect(resumed).toMatchObject({ version: initial.version, attemptsLeft: 6, guesses: [] });
  });

  it("refuse une proposition calculée sur une version périmée", async () => {
    await fixedSlot(NOW);
    const userId = await player();
    await start(userId, "socket-1", NOW);
    await guess(userId, "socket-1", { guess: "SALON", version: 0 }, NOW);

    const error = await appError(() => guess(userId, "socket-2", { guess: "SABLE", version: 0 }, NOW));
    expect(error.code).toBe("STALE_STATE");
  });

  it("n'accepte qu'une proposition lorsque deux appareils jouent la même version", async () => {
    await fixedSlot(NOW);
    const userId = await player();
    await start(userId, "socket-1", NOW);

    const results = await Promise.allSettled([
      guess(userId, "socket-1", { guess: "SALON", version: 0 }, NOW),
      guess(userId, "socket-2", { guess: "SABLE", version: 0 }, NOW),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "STALE_STATE" } });
    const resumed = await watch(userId, "socket-1", NOW);
    expect(resumed).toMatchObject({ version: 1, attemptsLeft: 5 });
  });

  it("clôt le sixième échec sans gain et sans révéler le secret", async () => {
    await fixedSlot(NOW);
    const userId = await player();
    let view = await start(userId, "socket-1", NOW);

    for (const word of ["SALON", "SABLE", "LIVRE", "PLAGE", "ROUTE", "TABLE"]) {
      view = await guess(userId, "socket-1", { guess: word, version: view.version }, NOW);
    }

    expect(view).toMatchObject({ status: "lost", endReason: "attempts", payout: 0, net: -100 });
    expect(await balanceOf(userId)).toBe(900);
    expect(JSON.stringify(view)).not.toContain("ECOLE");
  });
});

describe("reprise et abandon", () => {
  it("compte un compte multi-onglets une seule fois et libère la dernière page", async () => {
    await fixedSlot(NOW);
    const userId = await player();
    await start(userId, "socket-1", NOW);
    await watch(userId, "socket-2", NOW);

    expect(activeCount()).toBe(1);
    unwatch(userId, "socket-1");
    expect(activeCount()).toBe(1);
    unwatch(userId, "socket-2");
    expect(activeCount()).toBe(0);
    expect(reserveActivity(userId, { kind: "table", id: "table-apres-suspension" })).toBe(true);
    releaseActivity(userId, { kind: "table", id: "table-apres-suspension" });
  });

  it("reprend un ancien créneau après une suspension", async () => {
    await fixedSlot(NOW);
    await fixedSlot(LATER, "SALON");
    const userId = await player();
    const original = await start(userId, "socket-1", NOW);
    unwatch(userId, "socket-1");

    const resumed = await watch(userId, "socket-2", LATER);

    expect(resumed.slotStart).toBe(original.slotStart);
    expect(resumed).toMatchObject({ status: "playing", isCurrentSlot: false });
  });

  it("rend l'abandon définitif pour le créneau", async () => {
    await fixedSlot(NOW);
    const userId = await player();
    await start(userId, "socket-1", NOW);

    const abandoned = await abandon(userId, "socket-1", NOW);
    const replay = await start(userId, "socket-1", NOW);

    expect(abandoned).toMatchObject({ status: "lost", endReason: "abandoned", net: -100 });
    expect(replay).toMatchObject({ status: "lost", endReason: "abandoned" });
    expect(await balanceOf(userId)).toBe(900);
  });
});
