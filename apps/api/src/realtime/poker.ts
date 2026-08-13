import {
  pokerActSchema,
  pokerBlindsSchema,
  pokerFollowSchema,
  pokerRebuySchema,
  pokerRevealSchema,
  pokerSitOutSchema,
  pokerSitSchema,
  pokerTableRefSchema,
} from "@maxoujeux/shared";
import type { PokerNotifier } from "../modules/poker/service.js";
import {
  actPoker,
  followPoker,
  pokerAudienceOf,
  rebuyPoker,
  revealPoker,
  setPokerBlinds,
  sitOutPoker,
  sitPoker,
  standPoker,
  viewPoker,
} from "../modules/poker/service.js";
import { salonSnapshot } from "../modules/tables/manager.js";
import { gameCounts } from "./counts.js";
import { withAck } from "./guard.js";
import { socketIdentity } from "./identity.js";
import { lobbyRoom, userRoom, type GameServer, type GameSocket } from "./types.js";

/**
 * Transport du poker.
 *
 * Aucune règle ici. Un message par destinataire, parce que la vue est filtrée :
 * c'est le seul jeu où deux joueurs de la même table ne reçoivent pas le même
 * état, et c'est ce qui garantit qu'une carte cachée ne quitte pas le serveur.
 */
export function createPokerNotifier(io: GameServer): PokerNotifier {
  return {
    table(tableId) {
      for (const userId of pokerAudienceOf(tableId)) {
        const view = viewPoker(tableId, userId);
        if (view) io.to(userRoom(userId)).emit("poker:state", view);
      }
    },

    salon() {
      io.to(lobbyRoom("poker")).emit("tables:update", salonSnapshot("poker"));
    },

    counts() {
      io.emit("tables:counts", gameCounts());
    },
  };
}

export function registerPokerHandlers(socket: GameSocket): void {
  const userId = socket.data.userId;

  socket.on("poker:sit", (payload, ack) => {
    void withAck<null>(socket, "poker:sit", ack, async () => {
      const input = pokerSitSchema.parse(payload);
      await sitPoker(socketIdentity(socket), input.tableId, input.seat, input.buyIn);
      return null;
    });
  });

  socket.on("poker:stand", (payload, ack) => {
    void withAck<null>(socket, "poker:stand", ack, async () => {
      const input = pokerTableRefSchema.parse(payload);
      await standPoker(userId, input.tableId);
      return null;
    });
  });

  socket.on("poker:rebuy", (payload, ack) => {
    void withAck<null>(socket, "poker:rebuy", ack, async () => {
      const input = pokerRebuySchema.parse(payload);
      await rebuyPoker(userId, input.tableId, input.amount);
      return null;
    });
  });

  socket.on("poker:act", (payload, ack) => {
    void withAck<null>(socket, "poker:act", ack, async () => {
      const input = pokerActSchema.parse(payload);
      await actPoker(userId, input.tableId, input.version, {
        kind: input.action,
        ...(input.amount === undefined ? {} : { amount: input.amount }),
      });
      return null;
    });
  });

  socket.on("poker:blinds", (payload, ack) => {
    void withAck<null>(socket, "poker:blinds", ack, async () => {
      const input = pokerBlindsSchema.parse(payload);
      setPokerBlinds(userId, input.tableId, input.smallBlind, input.bigBlind);
      return null;
    });
  });

  socket.on("poker:reveal", (payload, ack) => {
    void withAck<null>(socket, "poker:reveal", ack, async () => {
      const input = pokerRevealSchema.parse(payload);
      revealPoker(userId, input.tableId);
      return null;
    });
  });

  socket.on("poker:follow", (payload, ack) => {
    void withAck<null>(socket, "poker:follow", ack, async () => {
      const input = pokerFollowSchema.parse(payload);
      followPoker(userId, input.tableId, input.userId);
      return null;
    });
  });

  socket.on("poker:sitout", (payload, ack) => {
    void withAck<null>(socket, "poker:sitout", ack, async () => {
      const input = pokerSitOutSchema.parse(payload);
      sitOutPoker(userId, input.tableId, input.out);
      return null;
    });
  });
}
