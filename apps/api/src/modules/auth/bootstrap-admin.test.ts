import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { moderationBans, users } from "../../db/schema.js";
import { env } from "../../env.js";
import { ledgerSum } from "../../test/fixtures.js";
import { bootstrapAdmin } from "./bootstrap-admin.js";
import { createAccount } from "./service.js";

const emailsToDelete = new Set<string>();

function accountInput() {
  const suffix = randomBytes(6).toString("hex");
  const email = `admin-${suffix}@maxoujeux.test`;
  emailsToDelete.add(email);
  return {
    email,
    pseudo: `admin_${suffix}`,
    password: "mot-de-passe-administrateur",
  };
}

async function passwordHashOf(userId: string): Promise<string | undefined> {
  const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
  return row?.passwordHash;
}

async function isAdminOf(userId: string): Promise<boolean | undefined> {
  const [row] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId));
  return row?.isAdmin;
}

beforeAll(() => runMigrations(), 60_000);

afterEach(async () => {
  const emails = [...emailsToDelete];
  if (emails.length > 0) {
    const rows = await db.select({ id: users.id }).from(users).where(inArray(users.email, emails));
    if (rows.length > 0) {
      await db.delete(moderationBans).where(inArray(moderationBans.targetUserId, rows.map((row) => row.id)));
    }
    await db.delete(users).where(inArray(users.email, emails));
  }
  emailsToDelete.clear();
});

describe("amorçage de l'administrateur", () => {
  it("refuse qu'un second administrateur soit créé", async () => {
    const first = accountInput();
    const second = accountInput();
    await createAccount(first, { role: "admin" });

    await expect(createAccount(second, { role: "admin" })).rejects.toMatchObject({
      statusCode: 409,
    });
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
    expect(admins).toHaveLength(1);
  });

  it("crée une seule fois le compte administrateur et son journal initial", async () => {
    const { email, pseudo, password } = accountInput();
    const config = { ADMIN_EMAIL: email, ADMIN_PSEUDO: pseudo, ADMIN_PASSWORD: password };

    await bootstrapAdmin(config);
    await bootstrapAdmin(config);

    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isAdmin).toBe(true);
    expect(await ledgerSum(rows[0]!.id)).toBe(env.STARTING_BALANCE);
  });

  it("promeut un compte existant sans remplacer son mot de passe", async () => {
    const { email, pseudo, password: original } = accountInput();
    const account = await createAccount({ email, pseudo, password: original });
    const before = await passwordHashOf(account.id);

    await bootstrapAdmin({
      ADMIN_EMAIL: email,
      ADMIN_PSEUDO: "Ignoré",
      ADMIN_PASSWORD: "mot-de-passe-de-remplacement",
    });

    expect(await passwordHashOf(account.id)).toBe(before);
    expect(await isAdminOf(account.id)).toBe(true);
  });

  it("retire le bannissement historique du compte promu administrateur", async () => {
    const { email, pseudo, password } = accountInput();
    const account = await createAccount({ email, pseudo, password });
    await db.update(users).set({ isBanned: true }).where(eq(users.id, account.id));
    const [ban] = await db
      .insert(moderationBans)
      .values({
        kind: "account",
        targetUserId: account.id,
        targetValue: account.id,
        reason: "Bannissement historique migré",
        createdBy: account.id,
      })
      .returning();

    await bootstrapAdmin({ ADMIN_EMAIL: email, ADMIN_PSEUDO: pseudo, ADMIN_PASSWORD: password });

    const [promoted] = await db
      .select({ role: users.role, isBanned: users.isBanned })
      .from(users)
      .where(eq(users.id, account.id));
    const [revoked] = await db
      .select({ revokedAt: moderationBans.revokedAt })
      .from(moderationBans)
      .where(eq(moderationBans.id, ban!.id));
    expect(promoted).toEqual({ role: "admin", isBanned: false });
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
  });

  it("retrouve un compte existant sans tenir compte de la casse de son email", async () => {
    const { email, pseudo, password } = accountInput();
    const account = await createAccount({ email, pseudo, password });

    await bootstrapAdmin({
      ADMIN_EMAIL: email.toUpperCase(),
      ADMIN_PSEUDO: "Ignoré",
      ADMIN_PASSWORD: "mot-de-passe-de-remplacement",
    });

    const rows = await db.select().from(users).where(eq(users.id, account.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isAdmin).toBe(true);
  });

  it("fait du compte configuré l'unique administrateur", async () => {
    const oldInput = accountInput();
    const configured = accountInput();
    const oldAdmin = await createAccount(oldInput, { role: "admin" });

    await bootstrapAdmin({
      ADMIN_EMAIL: configured.email,
      ADMIN_PSEUDO: configured.pseudo,
      ADMIN_PASSWORD: configured.password,
    });

    const admins = await db.select({ email: users.email }).from(users).where(eq(users.role, "admin"));
    const [old] = await db.select({ role: users.role }).from(users).where(eq(users.id, oldAdmin.id));
    expect(admins).toEqual([{ email: configured.email }]);
    expect(old?.role).toBe("player");
  });
});
