import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_CLIENT_LIMIT, type ChatMessage } from "@maxoujeux/shared";
import { useChat } from "./chat.js";

function message(index: number): ChatMessage {
  return {
    id: String(index),
    userId: `user-${index}`,
    pseudo: `Joueur ${index}`,
    avatarSeed: `seed-${index}`,
    body: `Message ${index}`,
    createdAt: "2026-08-12T12:00:00.000Z",
  };
}

test("ne conserve que les 1 000 messages les plus récents", () => {
  useChat.getState().clear();
  for (let index = 0; index < CHAT_CLIENT_LIMIT + 25; index += 1) {
    useChat.getState().receive(message(index));
  }
  assert.equal(useChat.getState().messages.length, CHAT_CLIENT_LIMIT);
  assert.equal(useChat.getState().messages[0]?.id, "25");
});

test("compte les non-lus seulement quand le panneau est fermé", () => {
  useChat.getState().clear();
  useChat.getState().receive(message(1));
  assert.equal(useChat.getState().unread, 1);
  useChat.getState().open();
  useChat.getState().receive(message(2));
  assert.equal(useChat.getState().unread, 0);
});

test("vide messages, non-lus et état d'ouverture", () => {
  useChat.getState().open();
  useChat.getState().receive(message(1));
  useChat.getState().clear();
  assert.deepEqual(
    useChat.getState(),
    {
      messages: [],
      isOpen: false,
      unread: 0,
      receive: useChat.getState().receive,
      open: useChat.getState().open,
      close: useChat.getState().close,
      clear: useChat.getState().clear,
    },
  );
});
