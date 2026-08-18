import assert from "node:assert/strict";
import test from "node:test";
import { consumeInstallPrompt, detectInstallEnvironment, installCardState, shouldShowInstallBanner } from "./pwa-install";

test("détecte iOS et iPadOS sans confondre le mode installé", () => {
  assert.deepEqual(
    detectInstallEnvironment({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
      standalone: false,
      beforeInstallPromptSupported: false,
    }),
    { iosInstructions: true, installed: false, unsupported: false },
  );
});

test("le refus de la bannière ne masque jamais la carte permanente", () => {
  const state = { available: true, iosInstructions: false, installed: false, unsupported: false };
  assert.equal(shouldShowInstallBanner(state, true), false);
  assert.equal(installCardState(state), "ready");
  assert.equal(installCardState({ ...state, available: false }), "waiting");
  assert.equal(installCardState({ ...state, installed: true }), "hidden");
});

test("masque l'installation en standalone ou sur navigateur incompatible", () => {
  assert.equal(
    detectInstallEnvironment({
      userAgent: "Chrome",
      platform: "Linux",
      maxTouchPoints: 0,
      standalone: true,
      beforeInstallPromptSupported: true,
    }).installed,
    true,
  );
  assert.equal(
    detectInstallEnvironment({
      userAgent: "Firefox",
      platform: "Linux",
      maxTouchPoints: 0,
      standalone: false,
      beforeInstallPromptSupported: false,
    }).unsupported,
    true,
  );
});

test("déclenche puis consomme la boîte d’installation native", async () => {
  let calls = 0;
  const outcome = await consumeInstallPrompt({
    prompt: async () => { calls += 1; },
    userChoice: Promise.resolve({ outcome: "dismissed", platform: "test" }),
  });
  assert.equal(calls, 1);
  assert.equal(outcome, "dismissed");
});
