import assert from "node:assert/strict";
import test from "node:test";
import type { PokerSeatView, PokerView } from "@maxoujeux/shared";
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

const { PokerTableScreen } = await import("./PokerTablePage.js");

function seat(partial: Partial<PokerSeatView> = {}): PokerSeatView {
  return {
    seat: 0,
    userId: "u1",
    pseudo: "Maxou",
    avatarSeed: "maxou",
    connected: true,
    stack: 500,
    committed: 0,
    status: "active",
    cards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "hearts" }],
    hand: null,
    handLabel: null,
    bestCards: null,
    isDealer: true,
    isSmallBlind: false,
    isBigBlind: false,
    lastAction: null,
    won: null,
    leavingAfterHand: false,
    revealed: false,
    sittingOut: false,
    ...partial,
  };
}

function view(partial: Partial<PokerView> = {}): PokerView {
  return {
    id: "table-1",
    game: "poker",
    phase: "waiting",
    config: { smallBlind: 10, bigBlind: 20, minBuyIn: 400, maxBuyIn: 2_000, seats: 6 },
    pendingConfig: null,
    followedUserId: null,
    seats: [seat()],
    maxSeats: 6,
    watchers: [],
    you: 0,
    isHost: true,
    board: [],
    pots: [],
    potTotal: 0,
    turn: null,
    allowed: null,
    buyInRange: { min: 1, max: 1_500 },
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

function render(pokerView: PokerView): string {
  return renderToStaticMarkup(<PokerTableScreen view={pokerView} />);
}

test("un joueur entre deux mains peut se recaver, se mettre en pause et régler ses blindes", () => {
  const html = render(view());
  assert.match(html, /Recaver/);
  assert.match(html, /Mettre en pause/);
  assert.match(html, /Régler les blindes/);
  assert.match(html, /aria-label="Montant de la recave"/);
});

test("un joueur couché peut choisir de montrer ses cartes", () => {
  const html = render(
    view({
      phase: "payout",
      canReveal: true,
      buyInRange: null,
      seats: [seat({ status: "folded" })],
    }),
  );
  assert.match(html, /Montrer mes cartes/);
});

test("un spectateur peut suivre un joueur sans voir de commande réservée aux joueurs", () => {
  const html = render(
    view({
      phase: "preflop",
      you: null,
      isHost: false,
      buyInRange: null,
      seats: [seat({ cards: [null, null] }), seat({ seat: 2, userId: "u2", pseudo: "Alice", cards: [null, null] })],
    }),
  );
  assert.match(html, /Suivre un joueur/);
  assert.match(html, /aria-label="Suivre Alice"/);
  assert.doesNotMatch(html, /Régler les blindes/);
  assert.doesNotMatch(html, /Mettre en pause/);
});

test("le tableau garde cinq emplacements stables avant le flop", () => {
  const html = render(view({ phase: "preflop" }));
  assert.equal((html.match(/data-poker-board-card=/g) ?? []).length, 5);
});

test("le pot repart visuellement vers le gagnant au règlement", () => {
  const html = render(
    view({ phase: "payout", seats: [seat({ won: 120 })], potTotal: 0, buyInRange: null }),
  );
  assert.match(html, /data-poker-payout-chip="0"/);
  assert.match(html, /--animate-distribue/);
});

test("la montre générale annonce le départ de la main", () => {
  const html = render(
    view({
      deadlineAt: new Date(Date.now() + 2_500).toISOString(),
      timerKind: "start",
      timerMs: 3_000,
    }),
  );
  assert.match(html, /La main va commencer/);
  assert.match(html, /secondes restantes/);
});

test("le temps de parole réserve un anneau complet autour de l’avatar", () => {
  const html = render(
    view({
      phase: "preflop",
      turn: 0,
      deadlineAt: new Date(Date.now() + 20_000).toISOString(),
      timerKind: "action",
      timerMs: 30_000,
    }),
  );
  assert.match(html, /width:40px;height:40px/);
});
