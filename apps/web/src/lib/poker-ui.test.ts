import assert from "node:assert/strict";
import test from "node:test";
import type { PokerSeatView, PokerView } from "@maxoujeux/shared";
import { dealOrigin, ovalPose, pokerAnchorSeat, pokerSeatOrder, potTravel } from "./poker-ui.js";

function seat(seat: number, userId: string): PokerSeatView {
  return {
    seat,
    userId,
    pseudo: userId,
    avatarSeed: userId,
    connected: true,
    stack: 500,
    committed: 0,
    status: "active",
    cards: [null, null],
    hand: null,
    handLabel: null,
    bestCards: null,
    isDealer: false,
    isSmallBlind: false,
    isBigBlind: false,
    lastAction: null,
    won: null,
    leavingAfterHand: false,
    revealed: false,
    sittingOut: false,
  };
}

function view(partial: Partial<PokerView> = {}): PokerView {
  return {
    id: "table-1",
    game: "poker",
    phase: "preflop",
    config: { smallBlind: 10, bigBlind: 20, minBuyIn: 400, maxBuyIn: 2_000, seats: 6 },
    pendingConfig: null,
    followedUserId: null,
    seats: [seat(1, "u1"), seat(4, "u2")],
    maxSeats: 6,
    watchers: [],
    you: null,
    isHost: false,
    board: [],
    pots: [],
    potTotal: 30,
    turn: 1,
    allowed: null,
    buyInRange: null,
    canReveal: false,
    deadlineAt: null,
    timerKind: null,
    timerMs: null,
    actionMs: 30_000,
    version: 1,
    now: "2026-08-13T12:00:00.000Z",
    ...partial,
  };
}

test("le joueur suivi devient l'ancre du spectateur", () => {
  const spectator = view();
  assert.equal(pokerAnchorSeat(spectator, "u2"), 4);
  assert.deepEqual(pokerSeatOrder(pokerAnchorSeat(spectator, "u2"), 6), [4, 5, 0, 1, 2, 3]);
  assert.equal(pokerAnchorSeat(spectator, "inconnu"), null);
});

test("sa propre place reste prioritaire sur le suivi", () => {
  assert.equal(pokerAnchorSeat(view({ you: 1 }), "u2"), 1);
});

test("les cartes et les mises voyagent entre les sièges et le centre", () => {
  const bas = ovalPose(0, 6);
  const origine = dealOrigin(0, 6);
  const pot = potTravel(0, 6);
  assert.ok(bas.y > 50);
  assert.ok(origine.y < 0);
  assert.ok(pot.y < 0);

  const haut = ovalPose(3, 6);
  assert.ok(haut.y < 50);
  assert.ok(dealOrigin(3, 6).y > 0);
  assert.ok(potTravel(3, 6).y > 0);
});
