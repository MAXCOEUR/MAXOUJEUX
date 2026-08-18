import { randomBytes } from "node:crypto";
import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { inArray } from "drizzle-orm";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../db/index.js";
import { moderationBans, staffAuditLog, users } from "../db/schema.js";
import { env } from "../env.js";
import { banAccount } from "../modules/moderation/service.js";
import { resetPlayerPassword } from "../modules/admin/service.js";
import { createAccount } from "../modules/auth/service.js";
import {
  SESSION_COOKIE,
  createSession,
  resolveSession,
  revokeSession,
} from "../modules/auth/session.js";
import { disconnectSession } from "./notify.js";
import { attachRealtime } from "./index.js";

const fingerprint = "empreinte-integration-socket";
const sockets: ClientSocket[] = [];
const userIds: string[] = [];
let app: FastifyInstance;
let baseUrl: string;

async function account(prefix: string, role: "player" | "moderator" = "player") {
  const suffix = randomBytes(5).toString("hex");
  const created = await createAccount(
    {
      email: `${prefix}-${suffix}@maxoujeux.test`,
      pseudo: `${prefix.slice(0, 8)}_${suffix}`,
      password: "mot-de-passe-de-test",
    },
    { role },
  );
  userIds.push(created.id);
  return created;
}

async function sessionCookie(userId: string) {
  const token = await createSession(userId, {
    ip: "127.0.0.1",
    deviceFingerprint: fingerprint,
    userAgent: "Socket.IO integration",
  });
  return { token, cookie: `${SESSION_COOKIE}=${app.signCookie(token)}` };
}

function client(cookie: string, origin = new URL(env.PUBLIC_ORIGIN).origin): ClientSocket {
  const socket = createClient(baseUrl, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
    auth: { deviceFingerprint: fingerprint },
    extraHeaders: origin ? { Cookie: cookie, Origin: origin } : { Cookie: cookie },
  });
  sockets.push(socket);
  return socket;
}

function connected(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Connexion Socket.IO trop longue")), 5_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.connect();
  });
}

function event<T>(socket: ClientSocket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Événement ${name} trop long`)), 5_000);
    socket.once(name, (value: T) => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
}

beforeAll(async () => {
  await runMigrations();
  app = Fastify({ logger: false });
  await app.register(fastifyCookie, { secret: env.SESSION_SECRET });
  attachRealtime(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Port Socket.IO introuvable");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await app.close();
  await db.delete(staffAuditLog);
  await db.delete(moderationBans);
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
});

describe("Socket.IO durci", () => {
  it("refuse une origine absente et limite à cinq sockets par compte", async () => {
    const player = await account("socket-limit");
    const { cookie } = await sessionCookie(player.id);
    const missingOrigin = client(cookie, "");
    await expect(connected(missingOrigin)).rejects.toMatchObject({ message: "SOCKET_ORIGIN_FORBIDDEN" });

    const accepted = Array.from({ length: 5 }, () => client(cookie));
    await Promise.all(accepted.map(connected));
    const sixth = client(cookie);
    await expect(connected(sixth)).rejects.toMatchObject({ message: "SOCKET_CONNECTION_LIMIT" });
    for (const socket of accepted) socket.disconnect();
  });

  it("refuse les messages de plus de 64 Kio et la 121e action par minute", async () => {
    const payloadPlayer = await account("socket-payload");
    const payloadSocket = client((await sessionCookie(payloadPlayer.id)).cookie);
    await connected(payloadSocket);
    const disconnected = event(payloadSocket, "disconnect");
    payloadSocket.emit("test:oversized", "x".repeat(65_537));
    await disconnected;

    const ratePlayer = await account("socket-rate");
    const rateSocket = client((await sessionCookie(ratePlayer.id)).cookie);
    await connected(rateSocket);
    const limited = event<{ code: string }>(rateSocket, "error:app");
    for (let index = 0; index < 121; index += 1) rateSocket.emit("presence:sync");
    await expect(limited).resolves.toMatchObject({ code: "SOCKET_RATE_LIMITED" });
    rateSocket.disconnect();
  });

  it("déconnecte seulement la session déconnectée, puis toutes les sockets d’un compte banni", async () => {
    const player = await account("socket-session");
    const firstSession = await sessionCookie(player.id);
    const secondSession = await sessionCookie(player.id);
    const firstIdentity = await resolveSession(firstSession.token);
    const first = client(firstSession.cookie);
    const second = client(secondSession.cookie);
    await Promise.all([connected(first), connected(second)]);

    const firstDisconnected = event(first, "disconnect");
    await revokeSession(firstSession.token);
    disconnectSession(firstIdentity!.sessionId);
    await firstDisconnected;
    expect(second.connected).toBe(true);

    const moderator = await account("socket-modo", "moderator");
    const secondDisconnected = event(second, "disconnect");
    await banAccount(moderator.id, player.id, {
      kinds: ["account"],
      reason: "Test de déconnexion immédiate",
      duration: "1h",
    });
    await secondDisconnected;
  });

  it("déconnecte toutes les sockets après une réinitialisation de mot de passe", async () => {
    const player = await account("socket-reset");
    const moderator = await account("reset-modo", "moderator");
    const first = client((await sessionCookie(player.id)).cookie);
    const second = client((await sessionCookie(player.id)).cookie);
    await Promise.all([connected(first), connected(second)]);
    const disconnected = Promise.all([
      event(first, "disconnect"),
      event(second, "disconnect"),
    ]);

    await resetPlayerPassword(
      player.id,
      { password: "mot-de-passe-réinitialisé" },
      moderator.id,
    );

    await disconnected;
  });
});
