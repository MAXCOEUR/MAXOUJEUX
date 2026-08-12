/**
 * Non-régression : recevoir l'état d'une table de blackjack ne déplace pas le
 * joueur.
 *
 * L'état arrive à chaque carte, à chaque mise, à chaque minuterie. Naviguer sur
 * sa réception happait le joueur dès qu'il tentait d'aller au salon ou dans son
 * porte-monnaie : la page se rouvrait toute seule, y compris seul à la table.
 * Le retour se fait par le bandeau de reprise.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { BlackjackView } from "@maxoujeux/shared";
import type { GameSocket } from "./socket-types.js";

// Le routeur s'abonne à `popstate` dès son chargement et lit `location` pour
// établir la route initiale. Ce décor doit donc être posé **avant** l'import du
// store, d'où les imports dynamiques plus bas.
const historique: string[] = [];
Object.assign(globalThis, {
  window: {
    location: { pathname: "/jeu/blackjack" },
    history: {
      pushState: (_etat: unknown, _titre: string, url: string) => historique.push(url),
      replaceState: (_etat: unknown, _titre: string, url: string) => historique.push(url),
    },
    addEventListener: () => {},
    scrollTo: () => {},
  },
});

const { bindBlackjackEvents, useBlackjack } = await import("./blackjack.js");
const { useRouteStore } = await import("./route.js");

/** Socket factice : on ne retient que le gestionnaire branché. */
function socketFactice() {
  const gestionnaires = new Map<string, (payload: never) => void>();
  const socket = {
    on: (event: string, gestionnaire: (payload: never) => void) => {
      gestionnaires.set(event, gestionnaire);
    },
  } as unknown as GameSocket;
  return { socket, emettre: (event: string, payload: unknown) => gestionnaires.get(event)?.(payload as never) };
}

const view = (partial: Partial<BlackjackView> = {}): BlackjackView => ({
  id: "table-1",
  game: "blackjack",
  phase: "betting",
  seats: [],
  maxSeats: 5,
  you: null,
  watching: 1,
  roundId: null,
  dealer: { cards: [], total: null, soft: null },
  turn: null,
  allowedActions: [],
  insuranceCost: null,
  deadlineAt: null,
  shoeRemaining: 312,
  version: 2,
  now: "2026-08-12T00:00:00.000Z",
  ...partial,
});

test("un état de blackjack ne ramène pas le joueur sur la table", () => {
  const { socket, emettre } = socketFactice();
  bindBlackjackEvents(socket);
  useBlackjack.getState().clear();
  historique.length = 0;

  emettre("blackjack:state", view());

  assert.equal(useBlackjack.getState().view?.id, "table-1", "l'état doit tout de même être mémorisé");
  assert.deepEqual(useRouteStore.getState().route, { name: "salon", game: "blackjack" });
  assert.deepEqual(historique, [], "aucune entrée d'historique ne doit être empilée");
});
