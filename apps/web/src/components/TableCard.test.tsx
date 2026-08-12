import assert from "node:assert/strict";
import test from "node:test";
import type { TableSummary } from "@maxoujeux/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { TableCard } from "./TableCard.js";

function table(patch: Partial<TableSummary> = {}): TableSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    game: "roulette",
    stake: null,
    status: "waiting",
    seats: [
      { seat: 0, userId: "hote", pseudo: "Alice", avatarSeed: "graine", connected: true },
    ],
    maxSeats: 8,
    createdAt: "2026-08-12T12:00:00.000Z",
    ...patch,
  };
}

function rendre(summary: TableSummary, balance = 0): string {
  return renderToStaticMarkup(
    <TableCard
      table={summary}
      userId="moi"
      balance={balance}
      busy={false}
      joining={false}
      onJoin={() => undefined}
      onReprendre={() => undefined}
      delay={0}
    />,
  );
}

test("une table de roulette s'ouvre sans droit d'entrée, même sans un jeton", () => {
  const html = rendre(table(), 0);

  assert.match(html, /Mises au tapis/);
  assert.match(html, /Plein 35:1/); // le barème du jeu, pas celui du blackjack
  assert.doesNotMatch(html, /Solde insuffisant/);
  assert.match(html, />Rejoindre</);
});

test("le tour en cours n'interdit pas d'entrer à la roulette", () => {
  assert.match(rendre(table({ status: "playing" })), /Rejoindre — tour en cours/);
});

test("une table de roulette pleine n'accepte plus personne", () => {
  const seats = Array.from({ length: 8 }, (_, index) => ({
    seat: index,
    userId: `joueur-${index}`,
    pseudo: `Joueur ${index}`,
    avatarSeed: `graine-${index}`,
    connected: true,
  }));

  assert.match(rendre(table({ seats })), />Complète</);
});

test("un duel garde sa mise d'entrée et son gain", () => {
  const html = rendre(table({ game: "connect4", stake: 100, maxSeats: 2 }), 10);

  assert.match(html, />Mise</);
  assert.match(html, /Gain si victoire/);
  assert.match(html, /Solde insuffisant/);
});
