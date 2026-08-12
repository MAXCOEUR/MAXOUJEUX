/** Transport Socket.IO de Motus : validation, accusés de réception et diffusion. */

import { motusGuessSchema, motusStartSchema, type MotusView } from "@maxoujeux/shared";
import type { MotusNotifier } from "../modules/motus/service.js";
import {
  abandon,
  guess,
  start,
  unwatch,
  watch,
} from "../modules/motus/service.js";
import { gameCounts } from "./counts.js";
import { withAck } from "./guard.js";
import { userRoom, type GameServer, type GameSocket } from "./types.js";

/** Le service métier ignore Socket.IO et ne reçoit que ce pont injecté. */
export function createMotusNotifier(io: GameServer): MotusNotifier {
  return {
    state(userId, view) {
      io.to(userRoom(userId)).emit("motus:state", view);
    },
    counts() {
      io.emit("tables:counts", gameCounts());
    },
  };
}

export function registerMotusHandlers(socket: GameSocket): void {
  const userId = socket.data.userId;

  socket.on("motus:watch", (ack) => {
    void withAck<MotusView>(socket, "motus:watch", ack, () => watch(userId, socket.id));
  });

  socket.on("motus:unwatch", () => {
    unwatch(userId, socket.id);
  });

  socket.on("motus:start", (payload, ack) => {
    void withAck<null>(socket, "motus:start", ack, async () => {
      const input = motusStartSchema.parse(payload);
      await start(userId, socket.id, input.stake);
      return null;
    });
  });

  socket.on("motus:guess", (payload, ack) => {
    void withAck<null>(socket, "motus:guess", ack, async () => {
      await guess(userId, socket.id, motusGuessSchema.parse(payload));
      return null;
    });
  });

  socket.on("motus:abandon", (ack) => {
    void withAck<null>(socket, "motus:abandon", ack, async () => {
      await abandon(userId, socket.id);
      return null;
    });
  });
}
