import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "@maxoujeux/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel, formatUnreadBadge } from "./ChatPanel.js";

function message(index: number): ChatMessage {
  return {
    id: String(index),
    userId: `user-${index}`,
    pseudo: index === 1 ? "Alice" : "Bastien",
    avatarSeed: `seed-${index}`,
    body: index === 1 ? "Bonjour !" : "Salut Alice",
    createdAt: `2026-08-12T1${index}:34:00.000Z`,
  };
}

function renderChat(messages?: ChatMessage[]): string {
  return renderToStaticMarkup(<ChatPanel open onClose={() => undefined} messages={messages} />);
}

test("affiche l'état vide et un champ limité", () => {
  const html = renderChat([]);
  assert.match(html, /Aucun message pour le moment/);
  assert.match(html, /maxLength="500"/);
  assert.doesNotMatch(html, /aria-live/);
});

test("affiche avatar, pseudo, heure et corps de chaque message", () => {
  const html = renderChat([message(1), message(2)]);
  assert.match(html, /Alice/);
  assert.match(html, /Bastien/);
  assert.match(html, /Bonjour !/);
  assert.match(html, /Salut Alice/);
  assert.equal((html.match(/dateTime=/g) ?? []).length, 2);
  assert.doesNotMatch(html, /aria-live/);
});

test("plafonne visuellement le badge de messages non lus", () => {
  assert.equal(formatUnreadBadge(1_000), "999+");
});
