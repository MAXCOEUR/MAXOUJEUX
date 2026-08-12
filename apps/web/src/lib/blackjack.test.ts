import assert from "node:assert/strict";
import test from "node:test";
import type { BlackjackView } from "@maxoujeux/shared";
import { isNewerBlackjackView } from "./blackjack-state.js";

const view = (version: number, id = "table-1"): BlackjackView => ({
  id,
  game: "blackjack",
  phase: "idle",
  seats: [],
  maxSeats: 5,
  you: null,
  watching: 0,
  roundId: null,
  dealer: { cards: [], total: null, soft: null },
  turn: null,
  allowedActions: [],
  insuranceCost: null,
  deadlineAt: null,
  shoeRemaining: 312,
  version,
  now: "2026-08-12T00:00:00.000Z",
});

test("rejette un état Blackjack ancien de la même table", () => {
  assert.equal(isNewerBlackjackView(view(4), view(3)), false);
  assert.equal(isNewerBlackjackView(view(4), view(5)), true);
});

test("accepte l'état initial d'une autre table", () => {
  assert.equal(isNewerBlackjackView(view(8), view(1, "table-2")), true);
});
