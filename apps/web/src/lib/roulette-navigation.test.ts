/**
 * Non-régression : recevoir l'état d'une table de roulette ne déplace pas le
 * joueur.
 *
 * Un état arrive à chaque mise et à chaque changement de phase. Naviguer sur
 * sa réception empêche de rester au salon pendant que la table continue ; le
 * retour doit dépendre du bouton « Reprendre ».
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { RouletteView } from "@maxoujeux/shared";
import type { GameSocket } from "./socket-types.js";

const historique: string[] = [];
Object.assign(globalThis, {
  window: {
    location: { pathname: "/jeu/roulette" },
    history: {
      pushState: (_etat: unknown, _titre: string, url: string) => historique.push(url),
      replaceState: (_etat: unknown, _titre: string, url: string) => historique.push(url),
    },
    addEventListener: () => {},
    scrollTo: () => {},
  },
});

const { bindRouletteEvents, useRoulette } = await import("./roulette.js");
const { useRouteStore } = await import("./route.js");

function socketFactice() {
  const gestionnaires = new Map<string, (payload: never) => void>();
  const socket = {
    on: (event: string, gestionnaire: (payload: never) => void) => {
      gestionnaires.set(event, gestionnaire);
    },
  } as unknown as GameSocket;
  return { socket, emettre: (event: string, payload: unknown) => gestionnaires.get(event)?.(payload as never) };
}

const view: RouletteView = {
  id: "table-1",
  game: "roulette",
  phase: "betting",
  players: [],
  maxPlayers: 8,
  you: null,
  roundId: "round-1",
  bets: [],
  result: null,
  history: [],
  deadlineAt: "2026-08-12T00:00:30.000Z",
  spinMs: 7_000,
  version: 2,
  now: "2026-08-12T00:00:00.000Z",
};

test("un état de roulette ne ramène pas le joueur sur la table", () => {
  const { socket, emettre } = socketFactice();
  bindRouletteEvents(socket);
  useRoulette.getState().clear();
  historique.length = 0;

  emettre("roulette:state", view);

  assert.equal(useRoulette.getState().view?.id, "table-1", "l'état doit tout de même être mémorisé");
  assert.deepEqual(useRouteStore.getState().route, { name: "salon", game: "roulette" });
  assert.deepEqual(historique, [], "aucune entrée d'historique ne doit être empilée");
});
