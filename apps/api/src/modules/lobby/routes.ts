import { GAMES } from "@maxoujeux/shared";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../lib/require-auth.js";
import { presenceSnapshot } from "../../realtime/presence.js";

export async function lobbyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  /**
   * État du lobby au chargement de la page. La présence est ensuite tenue à
   * jour en temps réel par Socket.IO ; cet appel évite un lobby vide pendant
   * l'établissement de la connexion WebSocket.
   */
  app.get("/", async (_request, reply) => {
    return reply.send({
      games: GAMES,
      presence: presenceSnapshot(),
    });
  });
}
