import { describe, expect, it } from "vitest";
import { socketIdentity } from "./identity.js";
import type { GameSocket } from "./types.js";

describe("identité temps réel", () => {
  it("relit l’avatar courant de la socket après sa modification", () => {
    const socket = {
      data: {
        userId: "player-1",
        pseudo: "Maxou",
        avatarSeed: "ancienne-graine",
      },
    } as GameSocket;

    expect(socketIdentity(socket).avatarSeed).toBe("ancienne-graine");

    socket.data.avatarSeed = "img:nouvelle-version";

    expect(socketIdentity(socket)).toEqual({
      userId: "player-1",
      pseudo: "Maxou",
      avatarSeed: "img:nouvelle-version",
    });
  });
});
