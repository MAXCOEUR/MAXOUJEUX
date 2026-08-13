import { rouletteBetSchema, rouletteSitSchema, rouletteTableRefSchema } from "@maxoujeux/shared";
import {
  betRoulette,
  clearRoulette,
  sitRoulette,
  standRoulette,
} from "../modules/roulette/service.js";
import { withAck } from "./guard.js";
import { socketIdentity } from "./identity.js";
import type { GameSocket } from "./types.js";

/**
 * Transport de la roulette.
 *
 * Aucune règle ici : on valide la forme du message, on appelle le service, on
 * laisse `withAck` traduire une `AppError` en code métier. L'identité vient du
 * handshake et jamais de la charge utile — un client qui enverrait son `userId`
 * pourrait miser sur le compte d'un autre.
 */
export function registerRouletteHandlers(socket: GameSocket): void {
  const userId = socket.data.userId;

  socket.on("roulette:bet", (payload, ack) => {
    void withAck<null>(socket, "roulette:bet", ack, async () => {
      const input = rouletteBetSchema.parse(payload);
      await betRoulette(userId, input.tableId, input.bets);
      return null;
    });
  });

  socket.on("roulette:sit", (payload, ack) => {
    void withAck<null>(socket, "roulette:sit", ack, async () => {
      const input = rouletteSitSchema.parse(payload);
      sitRoulette(socketIdentity(socket), input.tableId);
      return null;
    });
  });

  socket.on("roulette:stand", (payload, ack) => {
    void withAck<null>(socket, "roulette:stand", ack, async () => {
      const input = rouletteSitSchema.parse(payload);
      standRoulette(userId, input.tableId);
      return null;
    });
  });

  socket.on("roulette:clear", (payload, ack) => {
    void withAck<null>(socket, "roulette:clear", ack, async () => {
      const input = rouletteTableRefSchema.parse(payload);
      await clearRoulette(userId, input.tableId);
      return null;
    });
  });
}
