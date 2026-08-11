import assert from "node:assert/strict";
import test from "node:test";
import { shareText, type ShareNavigator } from "./share.js";

test("utilise le menu de partage natif lorsqu'il est disponible", async () => {
  let received: ShareData | undefined;
  const browser: ShareNavigator = {
    share: async (data) => {
      received = data;
    },
    clipboard: { writeText: async () => undefined },
  };

  const outcome = await shareText("MaxouJeux Motus", "🟩⬛\nhttps://jeu.test", browser);

  assert.equal(outcome, "shared");
  assert.deepEqual(received, {
    title: "MaxouJeux Motus",
    text: "🟩⬛\nhttps://jeu.test",
  });
});

test("copie le texte lorsque Web Share est indisponible", async () => {
  let copied = "";
  const browser: ShareNavigator = {
    clipboard: {
      writeText: async (text) => {
        copied = text;
      },
    },
  };

  const outcome = await shareText("MaxouJeux Motus", "résultat", browser);

  assert.equal(outcome, "copied");
  assert.equal(copied, "résultat");
});

test("traite l'annulation du menu natif comme un résultat silencieux", async () => {
  const browser: ShareNavigator = {
    share: async () => {
      throw new DOMException("annulé", "AbortError");
    },
    clipboard: { writeText: async () => undefined },
  };

  await assert.doesNotReject(async () => {
    assert.equal(await shareText("MaxouJeux Motus", "résultat", browser), "cancelled");
  });
});
