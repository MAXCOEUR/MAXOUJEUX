import assert from "node:assert/strict";
import test from "node:test";
import type { BlackjackSeatView, BlackjackView } from "@maxoujeux/shared";
import { blackjackResume, isNewerBlackjackView } from "./blackjack-state.js";

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

const assis = (partial: Partial<BlackjackSeatView> = {}): BlackjackSeatView => ({
  seat: 2,
  userId: "u1",
  pseudo: "Maxou",
  avatarSeed: "maxou",
  connected: true,
  participating: true,
  initialBet: 100,
  insurance: 0,
  totalWager: 200,
  hands: [],
  roundNet: null,
  idleRounds: 0,
  standingAfterRound: false,
  ...partial,
});

test("rien à reprendre quand le joueur est déjà sur sa table", () => {
  assert.equal(blackjackResume(view(3), "table-1"), null);
  assert.equal(blackjackResume(null, null), null);
});

test("le bandeau de reprise décrit une table regardée sans place", () => {
  assert.deepEqual(blackjackResume(view(3), null), {
    tableId: "table-1",
    seated: false,
    myTurn: false,
    wager: 0,
    deadlineAt: null,
  });
});

test("le bandeau de reprise signale le tour du joueur, sa mise et son échéance", () => {
  const courant = {
    ...view(6),
    seats: [assis()],
    you: 2,
    turn: { seat: 2, handIndex: 0 },
    deadlineAt: "2026-08-12T00:00:30.000Z",
  } satisfies BlackjackView;

  assert.deepEqual(blackjackResume(courant, "table-9"), {
    tableId: "table-1",
    seated: true,
    myTurn: true,
    wager: 200,
    deadlineAt: "2026-08-12T00:00:30.000Z",
  });
});

test("l'échéance d'un autre joueur n'est pas présentée comme la sienne", () => {
  const courant = {
    ...view(6),
    seats: [assis({ seat: 2 }), assis({ seat: 3, userId: "u2", pseudo: "Lea", totalWager: 50 })],
    you: 2,
    turn: { seat: 3, handIndex: 0 },
    deadlineAt: "2026-08-12T00:00:30.000Z",
  } satisfies BlackjackView;

  const reprise = blackjackResume(courant, null);
  assert.equal(reprise?.myTurn, false);
  assert.equal(reprise?.deadlineAt, null);
  assert.equal(reprise?.wager, 200);
});
