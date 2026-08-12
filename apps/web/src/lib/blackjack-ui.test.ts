import assert from "node:assert/strict";
import test from "node:test";
import { BLACKJACK_ACTION_MS, BLACKJACK_BETTING_MS } from "@maxoujeux/shared";
import { arcPose, cardLabel, handVerdict, phaseDurationMs, seatOrder } from "./blackjack-ui.js";
import { chipStack } from "./chips.js";

test("décompose une mise avec le moins de jetons possible", () => {
  assert.deepEqual(chipStack(2_500), [2_500]);
  assert.deepEqual(chipStack(360), [250, 100, 10]);
  assert.deepEqual(chipStack(60), [50, 10]);
});

test("plafonne la pile : une case de mise ne contient pas vingt jetons", () => {
  assert.deepEqual(chipStack(90), [50, 10, 10, 10, 10]);
  // Tronquée par le haut : les jetons forts d'abord, la pile reste
  // représentative de l'ordre de grandeur. Le montant exact est écrit à côté.
  assert.deepEqual(chipStack(90, 3), [50, 10, 10]);
});

test("une mise nulle ou absurde ne dessine aucun jeton", () => {
  assert.deepEqual(chipStack(0), []);
  assert.deepEqual(chipStack(-40), []);
  assert.deepEqual(chipStack(Number.NaN), []);
});

test("chaque phase minutée connaît sa durée nominale", () => {
  assert.equal(phaseDurationMs("betting"), BLACKJACK_BETTING_MS);
  assert.equal(phaseDurationMs("players"), BLACKJACK_ACTION_MS);
  // `idle` et `dealer` n'ont pas d'échéance : l'anneau ne doit pas s'afficher.
  assert.equal(phaseDurationMs("idle"), null);
  assert.equal(phaseDurationMs("dealer"), null);
});

test("le joueur est assis au milieu de l'arc, ses voisins gardent leur ordre", () => {
  assert.deepEqual(seatOrder(0, 5), [3, 4, 0, 1, 2]);
  assert.deepEqual(seatOrder(2, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(seatOrder(4, 5), [2, 3, 4, 0, 1]);
});

test("un spectateur voit l'ordre naturel des sièges", () => {
  assert.deepEqual(seatOrder(null, 5), [0, 1, 2, 3, 4]);
});

test("l'arc recule et rapetisse les sièges en s'éloignant du centre", () => {
  const centre = arcPose(2, 5);
  const bord = arcPose(0, 5);
  assert.equal(centre.y, 0);
  assert.equal(centre.scale, 1);
  assert.ok(bord.y > centre.y);
  assert.ok(bord.scale < centre.scale);
  // Symétrie : les deux extrémités sont à la même distance.
  assert.deepEqual(arcPose(0, 5), arcPose(4, 5));
});

test("le dos de carte ne laisse filtrer aucune valeur", () => {
  assert.equal(cardLabel(null), "Carte fermée");
  assert.equal(cardLabel({ rank: "A", suit: "spades" }), "As de pique");
  assert.equal(cardLabel({ rank: "10", suit: "hearts" }), "10 de cœur");
});

test("seules les mains réglées portent un cachet", () => {
  assert.equal(handVerdict("playing"), null);
  assert.equal(handVerdict("stood"), null);
  assert.deepEqual(handVerdict("busted"), { label: "Sauté", tone: "perte" });
  assert.deepEqual(handVerdict("blackjack"), { label: "Blackjack", tone: "gain" });
  assert.deepEqual(handVerdict("push"), { label: "Égalité", tone: "nul" });
});
