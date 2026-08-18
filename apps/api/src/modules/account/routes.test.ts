import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { sessions, users } from "../../db/schema.js";
import { DEVICE_HEADER, hashDeviceFingerprint } from "../../lib/access-context.js";
import { registerErrorHandler } from "../../lib/errors.js";
import { createAccount } from "../auth/service.js";
import { SESSION_COOKIE, createSession } from "../auth/session.js";
import { accountRoutes, avatarReadRoutes } from "./routes.js";

const fingerprint = "empreinte-route-changement-mot-de-passe";
let app: FastifyInstance;
let userId: string;
let cookie: string;

beforeAll(async () => {
  await runMigrations();
  app = Fastify();
  await app.register(fastifyCookie, {
    secret: "secret-de-test-suffisamment-long-pour-passer-la-validation",
  });
  registerErrorHandler(app);
  await app.register(accountRoutes, { prefix: "/account" });
  await app.register(avatarReadRoutes, { prefix: "/users" });
  await app.ready();

  const suffix = Date.now().toString(36);
  const account = await createAccount({
    email: `routes-account-${suffix}@maxoujeux.test`,
    pseudo: `routes_${suffix}`,
    password: "mot-de-passe-de-test",
  });
  userId = account.id;
  const token = await createSession(userId, {
    ip: "127.0.0.1",
    deviceFingerprint: fingerprint,
    userAgent: "Test",
  });
  cookie = `${SESSION_COOKIE}=${app.signCookie(token)}`;
}, 60_000);

afterAll(async () => {
  await app.close();
  await db.delete(users).where(eq(users.id, userId));
});

describe("routes du compte liées à l’appareil", () => {
  it("recrée la session avec l’empreinte après un changement de mot de passe", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/account/password",
      headers: { cookie, [DEVICE_HEADER]: fingerprint },
      payload: { password: "nouveau-mot-de-passe" },
    });

    expect(response.statusCode).toBe(204);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deviceHash).toBe(hashDeviceFingerprint(fingerprint));
  });

  it("authentifie une image avec l’empreinte liée à la session, sans en-tête personnalisé", async () => {
    const token = await createSession(userId, {
      ip: "127.0.0.1",
      deviceFingerprint: fingerprint,
      userAgent: "Test image",
    });
    const resourceCookie = `${SESSION_COOKIE}=${app.signCookie(token)}`;

    const response = await app.inject({
      method: "GET",
      url: `/users/${userId}/avatar`,
      headers: { cookie: resourceCookie },
    });

    expect(response.statusCode).toBe(404);
  });
});
