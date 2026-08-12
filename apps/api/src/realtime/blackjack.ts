import {
  blackjackActionSchema,
  blackjackBetSchema,
  blackjackInsuranceSchema,
  blackjackSitSchema,
  blackjackTableRefSchema,
} from "@maxoujeux/shared";
import {
  actBlackjack,
  betBlackjack,
  insureBlackjack,
  sitBlackjack,
  standBlackjack,
} from "../modules/blackjack/service.js";
import { withAck } from "./guard.js";
import { socketIdentity } from "./identity.js";
import type { GameSocket } from "./types.js";

export function registerBlackjackHandlers(socket: GameSocket): void {
  const userId = socket.data.userId;

  socket.on("blackjack:sit", (payload, ack) => {
    void withAck<null>(socket, "blackjack:sit", ack, async () => {
      const input = blackjackSitSchema.parse(payload);
      // L'identité reste issue de la session, mais elle est relue maintenant :
      // un avatar téléversé après la connexion doit apparaître sur le siège.
      await sitBlackjack(socketIdentity(socket), input.tableId, input.seat);
      return null;
    });
  });

  socket.on("blackjack:stand", (payload, ack) => {
    void withAck<null>(socket, "blackjack:stand", ack, async () => {
      const input = blackjackTableRefSchema.parse(payload);
      await standBlackjack(userId, input.tableId);
      return null;
    });
  });

  socket.on("blackjack:bet", (payload, ack) => {
    void withAck<null>(socket, "blackjack:bet", ack, async () => {
      const input = blackjackBetSchema.parse(payload);
      await betBlackjack(userId, input.tableId, input.amount, input.version);
      return null;
    });
  });

  socket.on("blackjack:insurance", (payload, ack) => {
    void withAck<null>(socket, "blackjack:insurance", ack, async () => {
      const input = blackjackInsuranceSchema.parse(payload);
      await insureBlackjack(userId, input.tableId, input.take, input.version);
      return null;
    });
  });

  socket.on("blackjack:act", (payload, ack) => {
    void withAck<null>(socket, "blackjack:act", ack, async () => {
      const input = blackjackActionSchema.parse(payload);
      await actBlackjack(userId, input.tableId, input.handIndex, input.action, input.version);
      return null;
    });
  });
}
