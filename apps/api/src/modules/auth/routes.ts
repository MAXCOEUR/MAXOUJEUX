import { loginSchema, registerSchema } from "@maxoujeux/shared";
import type { FastifyInstance } from "fastify";
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
    const user = await register(input);

    const token = await createSession(user.id, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    setSessionCookie(reply, token);

    return reply.status(201).send({ user: toPublicUser(user) });
  });

  app.post("/login", { config: bruteForceGuard }, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await login(input);

    const token = await createSession(user.id, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    setSessionCookie(reply, token);

    return reply.send({ user: toPublicUser(user) });
  });

  app.post("/logout", async (request, reply) => {
    await revokeSession(readSessionToken(request));
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    return reply.send({ user: toPublicUser(currentUser(request)) });
  });
}
