import { GAMES } from "@maxoujeux/shared";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../lib/require-auth.js";
import { gameCounts } from "../../realtime/counts.js";
import { presenceSnapshot } from "../../realtime/presence.js";

export async function lobbyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  /**
   * État du lobby au chargement de la page. La présence et les comptages de
   * tables sont ensuite tenus à jour en temps réel par Socket.IO ; cet appel
   * évite un lobby vide pendant l'établissement de la connexion WebSocket.
   *
   * Seuls les **comptages** passent par REST. La liste détaillée des tables
   * reste exclusivement en socket : elle change toutes les quelques secondes,
   * un sondage HTTP serait du gaspillage sur un NAS, et deux sources pour la
   * même donnée finiraient par diverger.
   */
  app.get("/", async (_request, reply) => {
    return reply.send({
      games: GAMES,
      presence: presenceSnapshot(),
      tables: gameCounts(),
      now: new Date().toISOString(),
    });
  });
}
