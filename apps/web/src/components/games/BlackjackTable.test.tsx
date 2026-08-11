import assert from "node:assert/strict";
import test from "node:test";
import type { BlackjackView } from "@maxoujeux/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { BlackjackTable } from "./BlackjackTable.js";

const view: BlackjackView = {
  id: "table-1",
  game: "blackjack",
  phase: "players",
  seats: [
    {
      seat: 0,
      userId: "u1",
      pseudo: "Maxou",
      avatarSeed: "maxou",
      connected: true,
      participating: true,
      initialBet: 100,
      insurance: 0,
      totalWager: 200,
      hands: [{
        cards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "hearts" }],
        wager: 200,
        total: 21,
        soft: true,
        status: "blackjack",
        payout: null,
        net: null,
      }],
      roundNet: null,
    },
  ],
  maxSeats: 5,
  you: 0,
  roundId: "round-1",
  dealer: { cards: [{ rank: "9", suit: "clubs" }, null], total: null, soft: null },
  turn: { seat: 0, handIndex: 0 },
  allowedActions: ["hit", "stand"],
  insuranceCost: null,
  deadlineAt: null,
  shoeRemaining: 280,
  version: 4,
  now: "2026-08-12T00:00:00.000Z",
};

test("montre cinq places, les cartes publiques et la mise de chaque joueur", () => {
  const html = renderToStaticMarkup(<BlackjackTable view={view} />);
  assert.match(html, /Maxou/);
  assert.match(html, /200 MC engagés/);
  assert.match(html, /As de pique/);
  assert.match(html, /Roi de cœur/);
  assert.equal((html.match(/data-blackjack-seat=/g) ?? []).length, 5);
});

test("rend la carte fermée sans sérialiser une valeur secrète", () => {
  const html = renderToStaticMarkup(<BlackjackTable view={view} />);
  assert.match(html, /Carte fermée/);
  assert.doesNotMatch(html, /data-hidden-rank/);
});
