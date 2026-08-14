import assert from "node:assert/strict";
import test from "node:test";
import { SOUNDS, SOUND_NAMES } from "./sounds.js";
import { AUDIO_BUSES } from "./audio.js";

/**
 * On ne teste pas ce qu'un son *donne à entendre* — un test ne l'écoute pas.
 * On teste ce qui casserait silencieusement : un nom déclaré sans fabrique
 * derrière, ou rattaché à un bus qui n'existe pas. Dans les deux cas, `playSound`
 * ne ferait rien, et rien ne le signalerait.
 */

test("chaque nom déclaré a sa fabrique", () => {
  for (const name of SOUND_NAMES) {
    const spec = SOUNDS[name];
    assert.ok(spec, `aucune fabrique pour « ${name} »`);
    assert.equal(typeof spec.play, "function");
  }
});

test("le catalogue ne contient rien qui ne soit déclaré", () => {
  // L'inverse compte autant : une entrée orpheline dans la table est du code
  // qu'aucun appel ne peut atteindre.
  assert.deepEqual(Object.keys(SOUNDS).sort(), [...SOUND_NAMES].sort());
});

test("chaque son est rattaché à un bus existant", () => {
  for (const name of SOUND_NAMES) {
    assert.ok(
      AUDIO_BUSES.includes(SOUNDS[name].bus),
      `« ${name} » vise un bus inconnu : ${SOUNDS[name].bus}`,
    );
  }
});

test("les sons du chat et des succès passent par les notifications", () => {
  // C'est ce qui permet de garder le « ding » d'un message en coupant les bruits
  // de table — le réglage que les trois curseurs existent pour offrir.
  assert.equal(SOUNDS.notification.bus, "notifications");
  assert.equal(SOUNDS.succes.bus, "notifications");
  assert.equal(SOUNDS.tour.bus, "notifications");
});

test("les bruits de table passent par les effets", () => {
  assert.equal(SOUNDS.jeton.bus, "effets");
  assert.equal(SOUNDS.carte.bus, "effets");
  assert.equal(SOUNDS.gain.bus, "effets");
  assert.equal(SOUNDS["roue-cliquet"].bus, "effets");
});
