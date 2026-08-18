import { loginSchema, registerSchema } from "@maxoujeux/shared";
import type { FastifyInstance } from "fastify";
import {
  DEVICE_HEADER,
  hashDeviceFingerprint,
  normalizeIp,
} from "../../lib/access-context.js";
import { assertAccessAllowed } from "../moderation/service.js";
import { disconnectSession } from "../../realtime/notify.js";
import { currentUser, readSessionToken, requireAuth } from "../../lib/require-auth.js";
import { toPublicUser } from "./public-user.js";
import { login, register } from "./service.js";
import {
  clearSessionCookie,
  createSession,
  revokeSession,
  setSessionCookie,
} from "./session.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const deviceFingerprint = (request: { headers: Record<string, unknown> }) => {
    const value = request.headers[DEVICE_HEADER];
    return typeof value === "string" ? value : undefined;
  };
  /**
   * Limitation de débit spécifique aux routes sensibles : le plafond global
   * est bien plus haut, il ne protégerait pas d'une attaque par force brute.
   */
  const bruteForceGuard = {
    rateLimit: {
      max: 10,
      timeWindow: "15 minutes",
    },
  };

  app.post("/register", { config: bruteForceGuard }, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const fingerprint = deviceFingerprint(request);
    await assertAccessAllowed({
      userId: null,
      role: null,
      ip: normalizeIp(request.ip),
      deviceHash: hashDeviceFingerprint(fingerprint),
    });
    const user = await register(input);

    const token = await createSession(user.id, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      deviceFingerprint: fingerprint,
    });
    setSessionCookie(reply, token);

    return reply.status(201).send({ user: toPublicUser(user) });
  });

  app.post("/login", { config: bruteForceGuard }, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await login(input);
    const fingerprint = deviceFingerprint(request);
    await assertAccessAllowed({
      userId: user.id,
      role: user.role,
      ip: normalizeIp(request.ip),
      deviceHash: hashDeviceFingerprint(fingerprint),
    });

    const token = await createSession(user.id, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      deviceFingerprint: fingerprint,
    });
    setSessionCookie(reply, token);

    return reply.send({ user: toPublicUser(user) });
  });

  app.post("/logout", async (request, reply) => {
    const sessionId = await revokeSession(readSessionToken(request));
    if (sessionId) disconnectSession(sessionId);
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    return reply.send({ user: toPublicUser(currentUser(request)) });
  });
}
