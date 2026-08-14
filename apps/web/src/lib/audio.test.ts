import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, parseSettings } from "./audio.js";

/**
 * `parseSettings` est la seule porte d'entrée d'une donnée qui vient du disque
 * du joueur : elle doit survivre à tout, y compris à une valeur modifiée à la
 * main dans la console. Un réglage de volume ne peut pas empêcher le site de
 * démarrer.
 */

test("retombe sur les valeurs par défaut sans réglage enregistré", () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
});

test("ignore un contenu qui n'est pas du JSON", () => {
  assert.deepEqual(parseSettings("{ceci n'est pas du json"), DEFAULT_SETTINGS);
});

test("ignore un JSON valide mais d'une autre forme", () => {
  assert.deepEqual(parseSettings('"une chaîne"'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings("null"), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings("[1,2,3]"), DEFAULT_SETTINGS);
});

test("relit des réglages complets", () => {
  const settings = parseSettings(
    JSON.stringify({ muted: true, volumes: { effets: 0.2, musique: 0, notifications: 1 } }),
  );

  assert.equal(settings.muted, true);
  assert.deepEqual(settings.volumes, { effets: 0.2, musique: 0, notifications: 1 });
});

test("borne un volume hors de l'intervalle plutôt que de le rejeter", () => {
  const settings = parseSettings(
    JSON.stringify({ volumes: { effets: 42, musique: -3, notifications: 0.5 } }),
  );

  assert.equal(settings.volumes.effets, 1);
  assert.equal(settings.volumes.musique, 0);
  assert.equal(settings.volumes.notifications, 0.5);
});

test("un réglage aberrant n'emporte pas les deux autres", () => {
  // Seul le volume des effets est cassé : les deux autres doivent survivre.
  const settings = parseSettings(
    JSON.stringify({ volumes: { effets: "fort", musique: 0.1, notifications: 0.9 } }),
  );

  assert.equal(settings.volumes.effets, DEFAULT_SETTINGS.volumes.effets);
  assert.equal(settings.volumes.musique, 0.1);
  assert.equal(settings.volumes.notifications, 0.9);
});

test("ne coupe le son que sur un vrai booléen", () => {
  // Une valeur « vraie » au sens JavaScript ne suffit pas : `muted: "non"`
  // couperait le son de quelqu'un qui a écrit l'inverse de ce qu'il voulait.
  assert.equal(parseSettings(JSON.stringify({ muted: "non" })).muted, false);
  assert.equal(parseSettings(JSON.stringify({ muted: 1 })).muted, false);
  assert.equal(parseSettings(JSON.stringify({ muted: true })).muted, true);
});

test("tout est allumé par défaut, musique comprise", () => {
  assert.equal(DEFAULT_SETTINGS.muted, false);
  for (const volume of Object.values(DEFAULT_SETTINGS.volumes)) {
    assert.ok(volume > 0, "aucun volume par défaut ne doit être à zéro");
  }
});
