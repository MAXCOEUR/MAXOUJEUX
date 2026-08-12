import { randomUUID } from "node:crypto";
import { chatSendSchema, type ChatMessage } from "@maxoujeux/shared";
import { AppError } from "../lib/errors.js";
import { withAck } from "./guard.js";
import type { GameServer, GameSocket } from "./types.js";

export class ChatRateLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(): boolean {
    const threshold = this.now() - this.windowMs;
    while (this.timestamps[0] !== undefined && this.timestamps[0] <= threshold) {
      this.timestamps.shift();
    }

    if (this.timestamps.length >= this.limit) return false;

    this.timestamps.push(this.now());
    return true;
  }
}

export function registerChatHandlers(io: GameServer, socket: GameSocket): void {
  const limiter = new ChatRateLimiter(5, 10_000);

  socket.on("chat:send", (payload, ack) => {
    void withAck<null>(socket, "chat:send", ack, async () => {
      const input = chatSendSchema.parse(payload);
      if (!limiter.take()) {
        throw new AppError(429, "CHAT_RATE_LIMITED", "Tu envoies des messages trop rapidement.");
      }

      const message: ChatMessage = {
        id: randomUUID(),
        userId: socket.data.userId,
        pseudo: socket.data.pseudo,
        avatarSeed: socket.data.avatarSeed,
        body: input.body,
        createdAt: new Date().toISOString(),
      };
      io.emit("chat:message", message);
      return null;
    });
  });
}
