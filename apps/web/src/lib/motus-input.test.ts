import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMotusLetter,
  eraseMotusLetter,
  motusCommandForKey,
  motusLetterStates,
} from "./motus-input.js";

test("conserve pour chaque lettre son résultat le plus informatif", () => {
  const states = motusLetterStates([
    { guess: "SALLE", marks: ["absent", "present", "absent", "absent", "absent"] },
    { guess: "LAMPE", marks: ["correct", "absent", "absent", "absent", "absent"] },
  ]);

  assert.equal(states.S, "absent");
  assert.equal(states.A, "present");
  assert.equal(states.L, "correct");
  assert.equal(states.Z, undefined);
});

test("ajoute une lettre normalisée sans dépasser la longueur du mot", () => {
  assert.equal(appendMotusLetter("ECO", "é", 5), "ECOE");
  assert.equal(appendMotusLetter("ECOLE", "S", 5), "ECOLE");
  assert.equal(appendMotusLetter("ECO", "7", 5), "ECO");
});

test("efface uniquement la dernière lettre", () => {
  assert.equal(eraseMotusLetter("MOTUS"), "MOTU");
  assert.equal(eraseMotusLetter(""), "");
});

test("traduit les frappes physiques sans capturer les raccourcis", () => {
  assert.deepEqual(motusCommandForKey("é", false), { type: "letter", letter: "E" });
  assert.deepEqual(motusCommandForKey("Backspace", false), { type: "erase" });
  assert.deepEqual(motusCommandForKey("Enter", false), { type: "submit" });
  assert.equal(motusCommandForKey("a", true), null);
  assert.equal(motusCommandForKey("ArrowLeft", false), null);
});
