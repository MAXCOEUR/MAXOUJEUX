import { describe, expect, it } from "vitest";
import { CHAT_MAX_LENGTH, chatSendSchema } from "./chat.js";

describe("contrat du chat", () => {
  it("normalise les espaces et refuse un message vide", () => {
    expect(chatSendSchema.parse({ body: "  Bonjour\r\n  tout le monde  " })).toEqual({
      body: "Bonjour\n tout le monde",
    });
    expect(chatSendSchema.safeParse({ body: " \n\t " }).success).toBe(false);
  });

  it("borne le corps à 500 caractères", () => {
    expect(chatSendSchema.safeParse({ body: "a".repeat(CHAT_MAX_LENGTH) }).success).toBe(true);
    expect(chatSendSchema.safeParse({ body: "a".repeat(CHAT_MAX_LENGTH + 1) }).success).toBe(false);
  });
});
