import assert from "node:assert/strict";
import test from "node:test";
import type { Leaderboard, LeaderboardRow } from "@maxoujeux/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { TableauClassement } from "./TableauClassement.js";

const MOI = "moi";

function ligne(rank: number, patch: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    rank,
    userId: `joueur-${rank}`,
    pseudo: `Joueur${rank}`,
    avatarSeed: "graine",
    net: 1_000 - rank * 10,
    wagered: 5_000,
    rounds: 40,
    wins: 20,
    rendement: 12,
    bestWin: 800,
    ...patch,
  };
}

function board(patch: Partial<Leaderboard> = {}): Leaderboard {
  return {
    scope: "global",
    period: "day",
    metric: "fortune",
    rows: [ligne(1), ligne(2), ligne(3)],
    me: null,
    total: 3,
    ...patch,
  };
}

function rendre(data: Leaderboard): string {
  return renderToStaticMarkup(
    <TableauClassement board={data} meId={MOI} vide="Personne n'a encore joué" />,
  );
}

test("épingle la ligne du joueur quand il est hors du haut de tableau", () => {
  const html = rendre(
    board({
      me: ligne(87, { userId: MOI, pseudo: "Maxou", net: -400 }),
      total: 143,
    }),
  );

  // Sa ligne est présente bien qu'il ne soit pas dans les trois premiers.
  assert.match(html, /Maxou/);
  assert.match(html, /87e/);
  // Et le saut de rangs est rendu explicite plutôt que silencieux.
  assert.match(html, /⋯/);
  assert.match(html, /143 joueurs classés/);
});

test("ne duplique pas la ligne du joueur quand il figure déjà dans la liste", () => {
  const html = rendre(
    board({
      rows: [ligne(1, { userId: MOI, pseudo: "Maxou" }), ligne(2), ligne(3)],
      me: ligne(1, { userId: MOI, pseudo: "Maxou" }),
    }),
  );

  // Le lien de profil est le repère fiable : le pseudo apparaît aussi dans
  // l'infobulle et le libellé de l'avatar.
  assert.equal(html.match(/href="\/joueur\/Maxou"/g)?.length, 1);
  // La coupure n'a pas lieu d'être : il n'y a aucun rang sauté.
  assert.doesNotMatch(html, /⋯/);
  // En revanche le raccourci vers sa propre ligne apparaît.
  assert.match(html, /Me retrouver/);
});

test("dit au joueur non classé qu'une seule manche suffit", () => {
  const html = rendre(board({ me: null }));

  // Les apostrophes sortent échappées du rendu serveur.
  assert.match(html, /pas encore joué sur cette période/);
  assert.doesNotMatch(html, /Me retrouver/);
});

test("propose un état vide quand personne n'a joué", () => {
  const html = rendre(board({ rows: [], me: null, total: 0 }));

  assert.match(html, /Personne n&#x27;a encore joué/);
});
