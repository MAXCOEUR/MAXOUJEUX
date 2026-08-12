import type { ActionReply } from "@maxoujeux/shared";
import { describe, expect, it, vi } from "vitest";
import { ChatRateLimiter, registerChatHandlers } from "./chat.js";
import type { GameServer, GameSocket } from "./types.js";

type ChatHandler = (payload: unknown, ack: (reply: ActionReply) => void) => void;

function chatHarness() {
  const handlers = new Map<string, ChatHandler>();
  const io = { emit: vi.fn() } as unknown as GameServer;
  const socket = {
    data: {
      userId: "player-from-session",
      pseudo: "Joueuse connectée",
      avatarSeed: "avatar-from-session",
    },
    emit: vi.fn(),
    on(event: string, handler: ChatHandler) {
      handlers.set(event, handler);
      return this;
    },
  } as unknown as GameSocket;

  registerChatHandlers(io, socket);

  return {
    io,
    socket,
    send(payload: unknown): Promise<ActionReply> {
      return new Promise((resolve) => {
        const handler = handlers.get("chat:send");
        if (!handler) throw new Error("Le gestionnaire chat:send n'est pas enregistré");
        handler(payload, resolve);
      });
    },
  };
}

describe("ChatRateLimiter", () => {
  it("autorise cinq messages puis refuse le sixième dans la fenêtre", () => {
    let now = 0;
    const limiter = new ChatRateLimiter(5, 10_000, () => now);

    for (let index = 0; index < 5; index += 1) expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(false);

    now += 10_001;
    expect(limiter.take()).toBe(true);
  });
});

describe("gestionnaire du chat global", () => {
  it("diffuse un message normalisé avec l'identité de la socket", async () => {
    const { io, send } = chatHarness();

    await expect(
      send({
        body: "  Bonjour\r\n  tout le monde  ",
        userId: "joueur-usurpé",
        pseudo: "Pseudo usurpé",
        avatarSeed: "avatar-usurpé",
      }),
    ).resolves.toEqual({ ok: true, data: null });

    expect(io.emit).toHaveBeenCalledOnce();
    expect(io.emit).toHaveBeenCalledWith(
      "chat:message",
      expect.objectContaining({
        userId: "player-from-session",
        pseudo: "Joueuse connectée",
        avatarSeed: "avatar-from-session",
        body: "Bonjour\n tout le monde",
        id: expect.any(String),
        createdAt: expect.any(String),
      }),
    );
  });

  it("renvoie une erreur de validation sans diffuser de message", async () => {
    const { io, send } = chatHarness();

    await expect(send({ body: " \n\t " })).resolves.toEqual(
      expect.objectContaining({ ok: false, code: "VALIDATION_ERROR" }),
    );
    expect(io.emit).not.toHaveBeenCalled();
  });

  it("refuse le sixième message envoyé trop rapidement", async () => {
    const { io, send } = chatHarness();

    for (let index = 0; index < 5; index += 1) {
      await expect(send({ body: `message ${index}` })).resolves.toEqual({ ok: true, data: null });
    }

    await expect(send({ body: "message de trop" })).resolves.toEqual({
      ok: false,
      code: "CHAT_RATE_LIMITED",
      message: "Tu envoies des messages trop rapidement.",
    });
    expect(io.emit).toHaveBeenCalledTimes(5);
  });
});
