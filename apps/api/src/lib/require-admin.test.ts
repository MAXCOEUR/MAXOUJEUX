import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../db/index.js";
import { sessions, users } from "../db/schema.js";
import { registerErrorHandler } from "./errors.js";
import { requireAdmin } from "./require-admin.js";
import { SESSION_COOKIE, createSession } from "../modules/auth/session.js";
import { createAccount } from "../modules/auth/service.js";

const userIdsToDelete: string[] = [];

function nextAccount(prefix: string) {
  const suffix = `${prefix}${Date.now()}${userIdsToDelete.length}`;
  return {
    email: `${suffix}@maxoujeux.test`,
    pseudo: suffix,
    password: "mot-de-passe-de-test",
  };
}

async function protectedApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(fastifyCookie, {
    secret: "secret-de-test-suffisamment-long-pour-passer-la-validation",
  });
  registerErrorHandler(app);
  app.get("/admin", { preHandler: requireAdmin }, async (request) => ({ pseudo: request.user?.pseudo }));
  await app.ready();
  return app;
}

async function cookieFor(app: FastifyInstance, userId: string): Promise<string> {
  const token = await createSession(userId, {});
  return `${SESSION_COOKIE}=${app.signCookie(token)}`;
}

beforeAll(() => runMigrations(), 60_000);

afterEach(async () => {
  if (userIdsToDelete.length > 0) {
    await db.delete(sessions).where(inArray(sessions.userId, userIdsToDelete));
    await db.delete(users).where(inArray(users.id, userIdsToDelete));
  }
  userIdsToDelete.length = 0;
});

describe("requireAdmin", () => {
  it("refuse un joueur avec ADMIN_REQUIRED", async () => {
    const player = await createAccount(nextAccount("player"));
    userIdsToDelete.push(player.id);
    const app = await protectedApp();

    try {
      const response = await app.inject({ method: "GET", url: "/admin", headers: { cookie: await cookieFor(app, player.id) } });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "ADMIN_REQUIRED" } });
    } finally {
      await app.close();
    }
  });

  it("laisse un administrateur atteindre le gestionnaire", async () => {
    const admin = await createAccount(nextAccount("admin"), { isAdmin: true });
    userIdsToDelete.push(admin.id);
    const app = await protectedApp();

    try {
      const response = await app.inject({ method: "GET", url: "/admin", headers: { cookie: await cookieFor(app, admin.id) } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ pseudo: admin.pseudo });
    } finally {
      await app.close();
    }
  });
});
