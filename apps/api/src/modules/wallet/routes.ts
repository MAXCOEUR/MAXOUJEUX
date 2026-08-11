import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser, requireAuth } from "../../lib/require-auth.js";
import { claimDailyBonus, getSummary, history } from "./service.js";

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (request, reply) => {
    const summary = await getSummary(currentUser(request).id);
    return reply.send(summary);
  });

  app.post(
    "/daily-bonus",
    {
      // Plafond resserré : l'encaissement est déjà idempotent, mais rien ne
      // justifie qu'un client martèle cette route.
      config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const result = await claimDailyBonus(currentUser(request).id);
      return reply.send(result);
    },
  );

  app.get("/history", async (request, reply) => {
    const { limit } = historyQuerySchema.parse(request.query);
    const entries = await history(currentUser(request).id, limit);
    return reply.send({ entries });
  });
}
