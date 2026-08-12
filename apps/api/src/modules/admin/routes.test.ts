import { randomBytes } from "node:crypto";
import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { registerErrorHandler } from "../../lib/errors.js";
import { createAccount } from "../auth/service.js";
import { SESSION_COOKIE, createSession } from "../auth/session.js";
import { adminRoutes } from "./routes.js";

const createdUserIds: string[] = [];
let app: FastifyInstance;
let player: Awaited<ReturnType<typeof createAccount>>;
let admin: Awaited<ReturnType<typeof createAccount>>;
let playerCookie: string;
let adminCookie: string;

function nextAccount(prefix: string) {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: `${prefix}-${suffix}@maxoujeux.test`,
    pseudo: `${prefix.slice(0, 6)}_${suffix}`,
    password: "mot-de-passe-de-test",
  };
}

async function cookieFor(userId: string): Promise<string> {
  const token = await createSession(userId, {});
  return `${SESSION_COOKIE}=${app.signCookie(token)}`;
}

beforeAll(async () => {
  await runMigrations();
  app = Fastify();
  await app.register(fastifyCookie, {
    secret: "secret-de-test-suffisamment-long-pour-passer-la-validation",
  });
  registerErrorHandler(app);
  await app.register(adminRoutes);
  await app.ready();

  player = await createAccount(nextAccount("route-player"));
  admin = await createAccount(nextAccount("route-admin"), { isAdmin: true });
  createdUserIds.push(player.id, admin.id);
  playerCookie = await cookieFor(player.id);
  adminCookie = await cookieFor(admin.id);
}, 60_000);

afterAll(async () => {
  await app.close();
  for (const id of createdUserIds) {
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("routes d'administration des comptes", () => {
  it("refuse la liste sans authentification", async () => {
    const response = await app.inject({ method: "GET", url: "/accounts" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("refuse la liste à une session joueur", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/accounts",
      headers: { cookie: playerCookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "ADMIN_REQUIRED" } });
  });

  it("retourne la liste à un administrateur", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/accounts",
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: player.id, isAdmin: false })]),
    );
  });

  it("ignore isAdmin lors de la création et retourne un joueur", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { cookie: adminCookie },
      payload: { ...nextAccount("route-created"), isAdmin: true },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    createdUserIds.push(body.account.id);
    expect(body.account).toMatchObject({ isAdmin: false, balance: 5000 });
  });

  it("retourne les champs invalides pour un solde négatif", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/accounts/${player.id}/balance`,
      headers: { cookie: adminCookie },
      payload: { balance: -1 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", fields: { balance: expect.any(String) } },
    });
  });

  it("protège un administrateur sur chaque route de mutation", async () => {
    const responses = await Promise.all([
      app.inject({
        method: "PATCH",
        url: `/accounts/${admin.id}/password`,
        headers: { cookie: adminCookie },
        payload: { password: "nouveau-mot-de-passe" },
      }),
      app.inject({
        method: "PATCH",
        url: `/accounts/${admin.id}/balance`,
        headers: { cookie: adminCookie },
        payload: { balance: 750 },
      }),
      app.inject({
        method: "DELETE",
        url: `/accounts/${admin.id}`,
        headers: { cookie: adminCookie },
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "ADMIN_ACCOUNT_PROTECTED" },
      });
    }
  });

  it("supprime un joueur et retourne 204", async () => {
    const target = await createAccount(nextAccount("route-deleted"));
    createdUserIds.push(target.id);

    const response = await app.inject({
      method: "DELETE",
      url: `/accounts/${target.id}`,
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
  });
});
