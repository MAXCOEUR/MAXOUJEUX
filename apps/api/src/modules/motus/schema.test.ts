import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { motusAttempts, motusSlots, motusWords, users } from "../../db/schema.js";
import { makeUser } from "../../test/fixtures.js";

const slotA = new Date("2026-08-11T10:00:00.000Z");
const slotB = new Date("2026-08-11T16:00:00.000Z");
let userId: string;

beforeAll(async () => {
  await runMigrations();
  userId = await makeUser(1_000);
  await db.insert(motusWords).values({ word: "QZXQZ", length: 5, isSolution: true });
  await db.insert(motusSlots).values([
    { slotStart: slotA, word: "QZXQZ", length: 5 },
    { slotStart: slotB, word: "QZXQZ", length: 5 },
  ]);
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(motusSlots).where(eq(motusSlots.word, "QZXQZ"));
  await db.delete(motusWords).where(eq(motusWords.word, "QZXQZ"));
});

describe("schéma Motus", () => {
  it("distingue les solutions des simples propositions", async () => {
    const [word] = await db.select().from(motusWords).where(eq(motusWords.word, "QZXQZ"));
    expect(word).toMatchObject({ active: true, isSolution: true, length: 5 });
  });

  it("interdit deux tentatives Motus non terminées pour le même joueur", async () => {
    await db.insert(motusAttempts).values({ userId, slotStart: slotA });

    await expect(
      db.insert(motusAttempts).values({ userId, slotStart: slotB }),
    ).rejects.toThrow();

    await db
      .update(motusAttempts)
      .set({ finishedAt: new Date(), version: 1 })
      .where(eq(motusAttempts.slotStart, slotA));

    await expect(
      db.insert(motusAttempts).values({ userId, slotStart: slotB }),
    ).resolves.toBeDefined();
  });
});
