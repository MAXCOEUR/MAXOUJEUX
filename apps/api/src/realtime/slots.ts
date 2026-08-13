import { slotsSpinSchema } from "@maxoujeux/shared";
import type { SlotsNotifier } from "../modules/slots/service.js";
import { slotsAudienceOf, spinReels, viewSlots } from "../modules/slots/service.js";
import { salonSnapshot } from "../modules/tables/manager.js";
import { gameCounts } from "./counts.js";
import { withAck } from "./guard.js";
import { lobbyRoom, userRoom, type GameServer, type GameSocket } from "./types.js";

/**
 * Transport de la machine à sous.
 *
 * Aucune règle ici : on valide la forme, on appelle le service, `withAck`
 * traduit les erreurs métier. L'identité vient du handshake — un client qui
 * enverrait un `userId` ne pourrait pas tirer sur la machine d'un autre.
 */
export function createSlotsNotifier(io: GameServer): SlotsNotifier {
  return {
    table(tableId) {
      for (const userId of slotsAudienceOf(tableId)) {
        const view = viewSlots(tableId, userId);
        if (view) io.to(userRoom(userId)).emit("slots:state", view);
      }
    },

    closed(tableId, audience) {
      // La machine a disparu de l'état : il faut prévenir explicitement, sinon
      // les spectateurs restent devant une machine morte.
      for (const userId of audience) {
        io.to(userRoom(userId)).emit("slots:closed", { tableId });
      }
    },

    salon() {
      io.to(lobbyRoom("slots")).emit("tables:update", salonSnapshot("slots"));
    },

    counts() {
      io.emit("tables:counts", gameCounts());
    },
  };
}

export function registerSlotsHandlers(socket: GameSocket): void {
  const userId = socket.data.userId;

  socket.on("slots:spin", (payload, ack) => {
    void withAck<null>(socket, "slots:spin", ack, async () => {
      const input = slotsSpinSchema.parse(payload);
      await spinReels(userId, input.tableId, input.stake);
      return null;
    });
  });
}
