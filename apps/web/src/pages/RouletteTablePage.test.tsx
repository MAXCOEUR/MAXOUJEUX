import assert from "node:assert/strict";
import test from "node:test";
import type { CurrentUser, RouletteView } from "@maxoujeux/shared";
import { renderToStaticMarkup } from "react-dom/server";

Object.assign(globalThis, {
  window: {
    location: { pathname: "/table/table-1" },
    history: { pushState: () => {}, replaceState: () => {} },
    addEventListener: () => {},
    scrollTo: () => {},
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  },
});

const { RouletteTablePage } = await import("./RouletteTablePage.js");

const user: CurrentUser = {
  id: "u1",
  email: "maxou@example.com",
  pseudo: "Maxou",
  avatarSeed: "maxou",
  role: "player",
  isAdmin: false,
  balance: 2_000,
  createdAt: "2026-08-12T00:00:00.000Z",
};

const view: RouletteView = {
  id: "table-1",
  game: "roulette",
  phase: "betting",
  players: [{
    userId: "u1",
    pseudo: "Maxou",
    avatarSeed: "maxou",
    connected: true,
    totalWager: 100,
    roundNet: null,
  }],
  maxPlayers: 8,
  watchers: [],
  you: "u1",
  roundId: "round-1",
  bets: [{ spot: { kind: "red" }, total: 100, mine: 100 }],
  result: null,
  history: [],
  deadlineAt: "2026-08-12T00:00:30.000Z",
  spinMs: 7_000,
  version: 3,
  now: "2026-08-12T00:00:00.000Z",
};

test("le retour de la roulette demande quoi faire de la place", () => {
  const html = renderToStaticMarkup(<RouletteTablePage user={user} view={view} />);

  assert.match(html, /<button[^>]*>.*Roulette.*<\/button>/s);
  assert.doesNotMatch(html, /<a[^>]*href="\/jeu\/roulette"[^>]*>.*Roulette.*<\/a>/s);
});
