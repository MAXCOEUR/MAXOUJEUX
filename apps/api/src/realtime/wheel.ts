import { wheelSpinSchema, type WheelView } from "@maxoujeux/shared";
import type { WheelNotifier } from "../modules/wheel/service.js";
import {
  enterWheelRoom,
  leaveWheelRoom,
  spin,
  wheelAudienceOf,
  wheelState,
} from "../modules/wheel/service.js";
import { withAck } from "./guard.js";
import { socketIdentity } from "./identity.js";
import { userRoom, type GameServer, type GameSocket } from "./types.js";

/**
 * Transport de la salle de la roue.
 *
 * Un message par occupant : la partie publique est identique pour tous, mais le
 * lancer du jour et le dernier lancer sont personnels — une diffusion unique
 * annoncerait à toute la salle que la roue est disponible alors qu'elle ne
 * l'est que pour une personne.
 */
export function createWheelNotifier(io: GameServer): WheelNotifier {
  return {
    room() {
      for (const userId of wheelAudienceOf()) {
        void wheelState(userId)
          .then((view) => io.to(userRoom(userId)).emit("wheel:state", view))
          .catch(() => {
            // Une lecture ratée ne doit pas casser la diffusion aux autres :
            // l'occupant concerné recevra l'état au prochain changement.
          });
      }
    },
  };
}

export function registerWheelHandlers(socket: GameSocket): void {
  const userId = socket.data.userId;

  socket.on("wheel:enter", (ack) => {
    void withAck<WheelView>(socket, "wheel:enter", ack, async () => {
      enterWheelRoom(socketIdentity(socket), socket.id);
      // L'état initial voyage dans l'accusé de réception : la salle s'affiche
      // en un aller-retour, sans écran vide entre-temps.
      return wheelState(userId);
    });
  });

  socket.on("wheel:leave", () => {
    leaveWheelRoom(userId, socket.id);
  });

  socket.on("wheel:spin", (payload, ack) => {
    void withAck<null>(socket, "wheel:spin", ack, async () => {
      const input = wheelSpinSchema.parse(payload);
      await spin(userId, input.stake);
      return null;
    });
  });
}
