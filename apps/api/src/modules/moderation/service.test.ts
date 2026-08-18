import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { accountAccesses, moderationBans, sessions, staffAuditLog, users } from "../../db/schema.js";
import { createAccount } from "../auth/service.js";
import { createSession } from "../auth/session.js";
import {
  assertAccessAllowed,
  banAccount,
  listAccountAccesses,
  revokeBan,
} from "./service.js";

const created: string[] = [];

async function account(prefix: string, role: "player" | "moderator" | "admin" = "player") {
  const suffix = randomBytes(5).toString("hex");
  const value = await createAccount(
    {
      email: `${prefix}-${suffix}@maxoujeux.test`,
      pseudo: `${prefix}_${suffix}`,
      password: "mot-de-passe-de-test",
    },
    { role },
  );
  created.push(value.id);
  return value;
}

beforeAll(() => runMigrations(), 60_000);

afterAll(async () => {
  await db.delete(staffAuditLog);
  await db.delete(moderationBans);
  for (const id of created.reverse()) await db.delete(users).where(eq(users.id, id));
});

describe("bannissements de modération", () => {
  it("enregistre uniquement le HMAC de l'empreinte lors d'une connexion", async () => {
    const player = await account("fingerprint");
    const raw = "visitorId-brut-a-ne-jamais-stocker";
    await createSession(player.id, {
      ip: "::ffff:192.0.2.10",
      deviceFingerprint: raw,
      userAgent: "Test",
    });

    const [session] = await db.select().from(sessions).where(eq(sessions.userId, player.id));
    const [access] = await db.select().from(accountAccesses).where(eq(accountAccesses.userId, player.id));
    expect(session?.ip).toBe("192.0.2.10");
    expect(session?.deviceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session?.deviceHash).not.toBe(raw);
    expect(access?.deviceHash).toBe(session?.deviceHash);
  });

  it("bannit compte, IP et machine sans conserver l'empreinte brute", async () => {
    const moderator = await account("modo", "moderator");
    const player = await account("target");
    const [access] = await db
      .insert(accountAccesses)
      .values({
        userId: player.id,
        ip: "203.0.113.42",
        deviceHash: "a".repeat(64),
        userAgent: "Navigateur test",
      })
      .returning();

    const bans = await banAccount(
      moderator.id,
      player.id,
      {
        kinds: ["account", "ip", "device"],
        accessId: access!.id,
        reason: "Triche automatisée",
        duration: "1d",
      },
    );

    expect(bans).toHaveLength(3);
    await expect(
      assertAccessAllowed({
        userId: player.id,
        role: "player",
        ip: "203.0.113.42",
        deviceHash: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_BANNED" });
    await expect(
      assertAccessAllowed({ userId: null, role: null, ip: "203.0.113.43", deviceHash: null }),
    ).resolves.toBeUndefined();
    await expect(
      assertAccessAllowed({ userId: null, role: null, ip: "203.0.113.42", deviceHash: null }),
    ).rejects.toMatchObject({ code: "IP_BANNED" });

    const stored = await db.select().from(moderationBans).where(eq(moderationBans.targetUserId, player.id));
    expect(JSON.stringify(stored)).not.toContain("visitorId");
    expect(await listAccountAccesses(player.id)).toEqual([
      expect.objectContaining({ ip: "203.0.113.42", hasDevice: true }),
    ]);
  });

  it("révoque un ban sans supprimer son historique", async () => {
    const moderator = await account("revoke_modo", "moderator");
    const player = await account("revoke_target");
    const [ban] = await banAccount(moderator.id, player.id, {
      kinds: ["account"],
      reason: "Test de révocation",
      duration: "permanent",
    });

    await revokeBan(moderator.id, ban!.id);

    await expect(
      assertAccessAllowed({ userId: player.id, role: "player", ip: null, deviceHash: null }),
    ).resolves.toBeUndefined();
    const [stored] = await db.select().from(moderationBans).where(eq(moderationBans.id, ban!.id));
    expect(stored?.revokedAt).toBeInstanceOf(Date);
  });

  it("ignore un ban temporaire expiré", async () => {
    const moderator = await account("expired_modo", "moderator");
    const player = await account("expired_target");
    await db.insert(moderationBans).values({
      kind: "account",
      targetUserId: player.id,
      targetValue: player.id,
      reason: "Ban arrivé à échéance",
      expiresAt: new Date(Date.now() - 1_000),
      createdBy: moderator.id,
    });

    await expect(
      assertAccessAllowed({ userId: player.id, role: "player", ip: null, deviceHash: null }),
    ).resolves.toBeUndefined();
  });

  it("interdit les trois types de ban sur l'administrateur", async () => {
    const admin = await account("protected", "admin");
    const moderator = await account("protected_modo", "moderator");
    const player = await account("shared_target");
    const sharedFingerprint = "appareil-partage-avec-admin";
    await createSession(admin.id, {
      ip: "198.51.100.50",
      deviceFingerprint: sharedFingerprint,
      userAgent: "Admin",
    });
    await createSession(player.id, {
      ip: "198.51.100.50",
      deviceFingerprint: sharedFingerprint,
      userAgent: "Joueur",
    });
    const [sharedAccess] = await db
      .select()
      .from(accountAccesses)
      .where(eq(accountAccesses.userId, player.id));

    await banAccount(moderator.id, player.id, {
      kinds: ["ip", "device"],
      accessId: sharedAccess!.id,
      reason: "Cible partageant la connexion de l’administrateur",
      duration: "1h",
    });
    expect(await db.select().from(sessions).where(eq(sessions.userId, admin.id))).toHaveLength(1);
    expect(await db.select().from(sessions).where(eq(sessions.userId, player.id))).toHaveLength(0);
    await expect(
      assertAccessAllowed({
        userId: admin.id,
        role: "admin",
        ip: "198.51.100.50",
        deviceHash: sharedAccess!.deviceHash,
      }),
    ).resolves.toBeUndefined();

    await expect(
      banAccount(moderator.id, admin.id, {
        kinds: ["account"],
        reason: "Action interdite",
        duration: "1h",
      }),
    ).rejects.toMatchObject({ code: "ADMIN_ACCOUNT_PROTECTED" });
    await expect(
      banAccount(admin.id, admin.id, {
        kinds: ["account"],
        reason: "Auto-sanction interdite",
        duration: "1h",
      }),
    ).rejects.toMatchObject({ code: "ADMIN_ACCOUNT_PROTECTED" });
  });

  it("sérialise deux bans concurrents visant la même IP", async () => {
    const moderator = await account("race_modo", "moderator");
    const first = await account("race_first");
    const second = await account("race_second");
    const accesses = await db
      .insert(accountAccesses)
      .values([
        { userId: first.id, ip: "203.0.113.99" },
        { userId: second.id, ip: "203.0.113.99" },
      ])
      .returning();

    const results = await Promise.allSettled([
      banAccount(moderator.id, first.id, {
        kinds: ["ip"], accessId: accesses[0]!.id, reason: "Premier ban", duration: "1d",
      }),
      banAccount(moderator.id, second.id, {
        kinds: ["ip"], accessId: accesses[1]!.id, reason: "Second ban", duration: "1d",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "BAN_ALREADY_ACTIVE" } });
  });
});
