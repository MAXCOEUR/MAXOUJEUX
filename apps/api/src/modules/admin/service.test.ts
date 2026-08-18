import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { sessions, users } from "../../db/schema.js";
import { setDisconnectNotifier } from "../../realtime/notify.js";
import { balanceOf } from "../../test/fixtures.js";
import { verifyPassword } from "../auth/password.js";
import { createAccount } from "../auth/service.js";
import { createSession } from "../auth/session.js";
import { releaseActivity, reserveActivity } from "../games/activity.js";
import {
  createPlayer,
  deletePlayer,
  listAccounts,
  resetPlayerPassword,
  setPlayerBalance,
} from "./service.js";

const createdUserIds: string[] = [];

function nextAccount(prefix: string) {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: `${prefix}-${suffix}@maxoujeux.test`,
    pseudo: `${prefix}_${suffix}`,
    password: "mot-de-passe-de-test",
  };
}

async function trackedAccount(prefix: string, options: { isAdmin?: boolean } = {}) {
  const account = await createAccount(nextAccount(prefix), options);
  createdUserIds.push(account.id);
  return account;
}

async function trackedAdmin(prefix: string): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);
  return existing ?? trackedAccount(prefix, { isAdmin: true });
}

async function sessionCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  return row?.count ?? 0;
}

beforeAll(() => runMigrations(), 60_000);

afterAll(async () => {
  setDisconnectNotifier(() => undefined);
  for (const id of createdUserIds) {
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("service d'administration des comptes", () => {
  it("liste joueurs et administrateurs sans exposer de hash", async () => {
    const player = await trackedAccount("z-player");
    const admin = await trackedAdmin("a-admin");
    await setPlayerBalance(player.id, { balance: 500 });

    const rows = await listAccounts();

    expect(rows.find((row) => row.id === player.id)).toMatchObject({
      isAdmin: false,
      balance: 500,
    });
    expect(rows.findIndex((row) => row.id === admin.id)).toBeLessThan(
      rows.findIndex((row) => row.id === player.id),
    );
    expect(rows.find((row) => row.id === player.id)?.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    expect(rows[0]).not.toHaveProperty("passwordHash");
  });

  it("crée toujours un joueur même si un client ajoute isAdmin", async () => {
    const input = { ...nextAccount("created-player"), isAdmin: true };

    const account = await createPlayer(input);
    createdUserIds.push(account.id);

    expect(account.isAdmin).toBe(false);
    const [stored] = await db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, account.id));
    expect(stored?.isAdmin).toBe(false);
  });

  it("protège tout administrateur contre les trois mutations", async () => {
    const target = await trackedAdmin("protected-admin");
    const disconnected: string[] = [];
    setDisconnectNotifier((userId) => disconnected.push(userId));
    const protectedError = { code: "ADMIN_ACCOUNT_PROTECTED" };

    await expect(
      resetPlayerPassword(target.id, { password: "nouveau-mot-de-passe" }),
    ).rejects.toMatchObject(protectedError);
    await expect(setPlayerBalance(target.id, { balance: 750 })).rejects.toMatchObject(
      protectedError,
    );
    await expect(deletePlayer(target.id)).rejects.toMatchObject(protectedError);

    expect(disconnected).toEqual([]);
    expect(reserveActivity(target.id, { kind: "motus", id: "apres-refus" })).toBe(true);
    releaseActivity(target.id, { kind: "motus", id: "apres-refus" });
  });

  it("réinitialise le mot de passe et révoque les sessions avant de déconnecter", async () => {
    const target = await trackedAccount("reset-player");
    await createSession(target.id, {});
    await createSession(target.id, {});
    const disconnected: string[] = [];
    setDisconnectNotifier((userId) => disconnected.push(userId));

    await resetPlayerPassword(target.id, { password: "nouveau-mot-de-passe" });

    const [stored] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, target.id));
    expect(stored && (await verifyPassword(stored.passwordHash, "nouveau-mot-de-passe"))).toBe(
      true,
    );
    expect(await sessionCount(target.id)).toBe(0);
    expect(disconnected).toEqual([target.id]);
  });

  it("ajuste le solde exclusivement par le service de porte-monnaie", async () => {
    const target = await trackedAccount("balance-player");

    await expect(setPlayerBalance(target.id, { balance: 750 })).resolves.toBe(750);

    expect(await balanceOf(target.id)).toBe(750);
  });

  it("refuse de supprimer un joueur en activité", async () => {
    const target = await trackedAccount("active-player");
    reserveActivity(target.id, { kind: "motus", id: "test-slot" });
    const disconnected: string[] = [];
    setDisconnectNotifier((userId) => disconnected.push(userId));

    await expect(deletePlayer(target.id)).rejects.toMatchObject({ code: "PLAYER_ACTIVE" });

    expect(disconnected).toEqual([]);
    releaseActivity(target.id, { kind: "motus", id: "test-slot" });
  });

  it("supprime le compte persisté avant de déconnecter ses sockets", async () => {
    const target = await trackedAccount("deleted-player");
    await createSession(target.id, {});
    const disconnected: string[] = [];
    setDisconnectNotifier((userId) => disconnected.push(userId));

    await deletePlayer(target.id);

    const [stored] = await db.select({ id: users.id }).from(users).where(eq(users.id, target.id));
    expect(stored).toBeUndefined();
    expect(await sessionCount(target.id)).toBe(0);
    expect(disconnected).toEqual([target.id]);
  });
});
