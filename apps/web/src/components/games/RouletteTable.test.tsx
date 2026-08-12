import assert from "node:assert/strict";
import test from "node:test";
import type { RoulettePlayerView, RouletteView } from "@maxoujeux/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { RouletteTable } from "./RouletteTable.js";

function joueur(partial: Partial<RoulettePlayerView> = {}): RoulettePlayerView {
  return {
    userId: "u1",
    pseudo: "Maxou",
    avatarSeed: "maxou",
    connected: true,
    totalWager: 0,
    roundNet: null,
    ...partial,
  };
}

function vue(partial: Partial<RouletteView> = {}): RouletteView {
  return {
    id: "table-1",
    game: "roulette",
    phase: "betting",
    players: [joueur()],
    maxPlayers: 8,
    you: "u1",
    roundId: "round-1",
    bets: [],
    result: null,
    history: [],
    deadlineAt: null,
    spinMs: 7_000,
    version: 3,
    now: "2026-08-12T00:00:00.000Z",
    ...partial,
  };
}

/** Libellés accessibles des cases du tapis. */
function cases(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]*(?:1:1|2:1|35:1)[^"]*)"/g)].map((match) => match[1]!);
}

test("le tapis porte les trente-sept pleins et les douze mises extérieures", () => {
  const html = renderToStaticMarkup(<RouletteTable view={vue()} onPlace={() => {}} />);
  const libelles = cases(html);
  const pleins = libelles.filter((label) => label.startsWith("Plein "));
  assert.equal(pleins.length, 37);
  assert.equal(libelles.length - pleins.length, 12);
  // Le zéro en fait partie : c'est l'avantage de la maison, il doit être misable.
  assert.ok(pleins.some((label) => label.startsWith("Plein 0,")));
});

test("chaque case annonce son rapport", () => {
  const html = renderToStaticMarkup(<RouletteTable view={vue()} onPlace={() => {}} />);
  assert.match(html, /aria-label="Plein 17, 35:1"/);
  assert.match(html, /aria-label="2e douzaine, 2:1"/);
  assert.match(html, /aria-label="Rouge, 1:1"/);
});

test("le tas de la table et la part personnelle sont distingués", () => {
  const html = renderToStaticMarkup(
    <RouletteTable
      view={vue({
        bets: [
          { spot: { kind: "red" }, total: 130, mine: 40 },
          { spot: { kind: "black" }, total: 60, mine: 0 },
        ],
      })}
      onPlace={() => {}}
    />,
  );
  assert.match(html, /Rouge, 1:1, 40 MC misés par toi sur 130 MC/);
  assert.match(html, /Noir, 1:1, 60 MC misés par la table/);
});

test("les mises se ferment dès que la bille part", () => {
  const ouvert = renderToStaticMarkup(<RouletteTable view={vue()} onPlace={() => {}} />);
  assert.doesNotMatch(ouvert, /disabled=""/);

  const lance = renderToStaticMarkup(
    <RouletteTable view={vue({ phase: "spinning", result: 17 })} onPlace={() => {}} />,
  );
  // Les quarante-neuf cases refusent le clic, sans disparaître : le joueur doit
  // continuer de voir où sont les jetons pendant le lancer.
  assert.equal((lance.match(/disabled=""/g) ?? []).length, 49);
});

test("sans gestionnaire de pose, le tapis est en lecture seule", () => {
  // C'est le cas du rendu statique et de tout aperçu : proposer un clic qui ne
  // fait rien vaut moins qu'un tapis manifestement inerte.
  const html = renderToStaticMarkup(<RouletteTable view={vue()} />);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 49);
});

test("le bandeau montre les derniers numéros, le plus récent en tête", () => {
  const html = renderToStaticMarkup(<RouletteTable view={vue({ history: [17, 0, 32] })} />);
  assert.match(html, /Derniers numéros sortis/);
  const bandeau = html.slice(html.indexOf("Derniers numéros sortis"));
  assert.ok(bandeau.indexOf(">17<") < bandeau.indexOf(">0<"));
});

test("une table sans historique le dit plutôt que d'afficher un bandeau vide", () => {
  const html = renderToStaticMarkup(<RouletteTable view={vue()} />);
  assert.match(html, /Aucun numéro sorti/);
});

test("chaque joueur montre ce qu'il a engagé, puis ce qu'il a gagné", () => {
  const enCours = renderToStaticMarkup(
    <RouletteTable
      view={vue({
        players: [joueur({ totalWager: 250 }), joueur({ userId: "u2", pseudo: "Robin" })],
      })}
    />,
  );
  assert.match(enCours, /250 MC/);
  // Sans mise, le joueur regarde : le dire évite de le croire absent.
  assert.match(enCours, /regarde/);

  const regle = renderToStaticMarkup(
    <RouletteTable
      view={vue({ phase: "result", result: 17, players: [joueur({ totalWager: 250, roundNet: -250 })] })}
    />,
  );
  assert.match(regle, /−250 MC/);
});

test("le cylindre annonce son état sans dévoiler de numéro au repos", () => {
  const repos = renderToStaticMarkup(<RouletteTable view={vue()} />);
  assert.match(repos, /Cylindre de roulette au repos/);

  const lance = renderToStaticMarkup(<RouletteTable view={vue({ phase: "spinning", result: 8 })} />);
  assert.match(lance, /La bille tourne/);

  const sorti = renderToStaticMarkup(<RouletteTable view={vue({ phase: "result", result: 8 })} />);
  assert.match(sorti, /Le 8 est sorti/);
});

test("la phase est nommée en toutes lettres", () => {
  assert.match(renderToStaticMarkup(<RouletteTable view={vue({ phase: "idle" })} />), /Table ouverte/);
  assert.match(renderToStaticMarkup(<RouletteTable view={vue()} />), /Faites vos jeux/);
  assert.match(
    renderToStaticMarkup(<RouletteTable view={vue({ phase: "spinning", result: 3 })} />),
    /Rien ne va plus/,
  );
});
