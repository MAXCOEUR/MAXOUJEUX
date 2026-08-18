import { describe, expect, it } from "vitest";
import { isAllowedSocketOrigin, socketClientIp } from "./origin.js";

describe("origine Socket.IO", () => {
  it("exige l'origine publique exacte", () => {
    const publicOrigin = "https://maxoujeux.maxencecoeur.fr/";
    expect(isAllowedSocketOrigin("https://maxoujeux.maxencecoeur.fr", publicOrigin)).toBe(true);
    expect(isAllowedSocketOrigin(undefined, publicOrigin)).toBe(false);
    expect(isAllowedSocketOrigin("https://evil.example", publicOrigin)).toBe(false);
    expect(isAllowedSocketOrigin("https://maxoujeux.maxencecoeur.fr.evil.example", publicOrigin)).toBe(
      false,
    );
  });
});

it("reprend l'IP d'origine uniquement derrière les mandataires de confiance", () => {
  expect(socketClientIp("203.0.113.10, 172.18.0.2", "172.18.0.3", 2)).toBe("203.0.113.10");
  expect(socketClientIp("198.51.100.99, 203.0.113.10, 172.18.0.2", "172.18.0.3", 2)).toBe("203.0.113.10");
  expect(socketClientIp("203.0.113.10", "127.0.0.1", 0)).toBe("127.0.0.1");
});
