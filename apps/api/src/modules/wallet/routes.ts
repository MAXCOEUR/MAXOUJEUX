import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser, requireAuth } from "../../lib/require-auth.js";
import { recordDailyStreak } from "../stats/service.js";
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
      const userId = currentUser(request).id;
      const result = await claimDailyBonus(userId);

      // Les succès d'assiduité sont évalués **ici** et non dans le service de
      // porte-monnaie : celui-ci est la couche la plus basse, le faire dépendre
      // des statistiques créerait un cycle d'imports. Un échec ne doit pas
      // annuler un bonus déjà encaissé — la progression étant le maximum atteint,
      // l'encaissement du lendemain rattrapera de lui-même un déblocage manqué.
      try {
        await recordDailyStreak(userId, result.streak);
      } catch (error) {
        request.log.error({ err: error, userId }, "Succès d'assiduité non évalués");
      }

      return reply.send(result);
    },
  );

  app.get("/history", async (request, reply) => {
    const { limit } = historyQuerySchema.parse(request.query);
    const entries = await history(currentUser(request).id, limit);
    return reply.send({ entries });
  });
}
