import { plinkoDropSchema, plinkoRiskSchema } from "@maxoujeux/shared";
import type { PlinkoNotifier } from "../modules/plinko/service.js";
import {
  dropBall,
  plinkoAudienceOf,
  setPlinkoRisk,
  viewPlinko,
} from "../modules/plinko/service.js";
import { salonSnapshot } from "../modules/tables/manager.js";
import { gameCounts } from "./counts.js";
import { withAck } from "./guard.js";
import { lobbyRoom, userRoom, type GameServer, type GameSocket } from "./types.js";

/**
 * Transport du Plinko.
 *
 * Aucune règle ici : on valide la forme, on appelle le service, `withAck`
 * traduit les erreurs métier. L'identité vient du handshake — un client qui
 * enverrait un `userId` ne pourrait pas lâcher de bille sur la planche d'un
 * autre.
 */
export function createPlinkoNotifier(io: GameServer): PlinkoNotifier {
  return {
    table(tableId) {
      // Un message par destinataire : le propriétaire et ses spectateurs ne
      // voient pas la même chose côté commandes, même si l'état est identique.
      for (const userId of plinkoAudienceOf(tableId)) {
        const view = viewPlinko(tableId, userId);
        if (view) io.to(userRoom(userId)).emit("plinko:state", view);
      }
    },

    closed(tableId, audience) {
      // La table a disparu de l'état : il faut prévenir explicitement, sinon
      // les spectateurs restent devant une table morte.
      for (const userId of audience) {
        io.to(userRoom(userId)).emit("plinko:closed", { tableId });
      }
    },

    salon() {
      io.to(lobbyRoom("plinko")).emit("tables:update", salonSnapshot("plinko"));
    },

    counts() {
      io.emit("tables:counts", gameCounts());
    },
  };
}

export function registerPlinkoHandlers(socket: GameSocket): void {
  const userId = socket.data.userId;

  socket.on("plinko:drop", (payload, ack) => {
    void withAck<null>(socket, "plinko:drop", ack, async () => {
      const input = plinkoDropSchema.parse(payload);
      await dropBall(userId, input.tableId, input.stake);
      return null;
    });
  });

  socket.on("plinko:risk", (payload, ack) => {
    void withAck<null>(socket, "plinko:risk", ack, async () => {
      const input = plinkoRiskSchema.parse(payload);
      setPlinkoRisk(userId, input.tableId, input.risk);
      return null;
    });
  });
}
