import assert from "node:assert/strict";
import test from "node:test";
import type { BlackjackHandView, BlackjackSeatView, BlackjackView } from "@maxoujeux/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { BlackjackTable } from "./BlackjackTable.js";

function hand(partial: Partial<BlackjackHandView> = {}): BlackjackHandView {
  return {
    cards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "hearts" }],
    wager: 200,
    total: 21,
    soft: true,
    status: "blackjack",
    payout: null,
    net: null,
    ...partial,
  };
}

function seat(partial: Partial<BlackjackSeatView> = {}): BlackjackSeatView {
  return {
    seat: 0,
    userId: "u1",
    pseudo: "Maxou",
    avatarSeed: "maxou",
    connected: true,
    participating: true,
    initialBet: 100,
    insurance: 0,
    totalWager: 200,
    hands: [hand()],
    roundNet: null,
    idleRounds: 0,
    standingAfterRound: false,
    ...partial,
  };
}

function view(partial: Partial<BlackjackView> = {}): BlackjackView {
  return {
    id: "table-1",
    game: "blackjack",
    phase: "players",
    seats: [seat()],
    maxSeats: 5,
    you: 0,
    watching: 0,
    roundId: "round-1",
    dealer: { cards: [{ rank: "9", suit: "clubs" }, null], total: null, soft: null },
    turn: { seat: 0, handIndex: 0 },
    allowedActions: ["hit", "stand"],
    insuranceCost: null,
    deadlineAt: null,
    shoeRemaining: 280,
    version: 4,
    now: "2026-08-12T00:00:00.000Z",
    ...partial,
  };
}

/** Numéros de siège dans l'ordre où ils apparaissent dans le balisage. */
function placesRendues(html: string): number[] {
  return [...html.matchAll(/data-blackjack-seat="(\d)"/g)].map((match) => Number(match[1]));
}

test("montre cinq places, les cartes publiques et la mise de chaque joueur", () => {
  const html = renderToStaticMarkup(<BlackjackTable view={view()} />);
  assert.match(html, /Maxou/);
  assert.match(html, /200 MC/);
  assert.match(html, /As de pique/);
  assert.match(html, /Roi de cœur/);
  assert.equal(placesRendues(html).length, 5);
});

test("rend la carte fermée sans sérialiser une valeur secrète", () => {
  const html = renderToStaticMarkup(<BlackjackTable view={view()} />);
  assert.match(html, /Carte fermée/);
  assert.doesNotMatch(html, /data-hidden-rank/);
});

test("le joueur est assis au centre de l'arc, quel que soit son siège", () => {
  assert.deepEqual(placesRendues(renderToStaticMarkup(<BlackjackTable view={view({ you: 0 })} />)), [3, 4, 0, 1, 2]);
  assert.deepEqual(placesRendues(renderToStaticMarkup(<BlackjackTable view={view({ you: 3 })} />)), [1, 2, 3, 4, 0]);
});

test("un spectateur voit les sièges dans leur ordre naturel", () => {
  const html = renderToStaticMarkup(<BlackjackTable view={view({ you: null, turn: null })} />);
  assert.deepEqual(placesRendues(html), [0, 1, 2, 3, 4]);
});

test("sur une main séparée, une seule main porte la marque de main active", () => {
  const html = renderToStaticMarkup(
    <BlackjackTable
      view={view({
        seats: [seat({ hands: [hand({ status: "stood", total: 18, soft: false }), hand({ status: "playing" })] })],
        turn: { seat: 0, handIndex: 1 },
      })}
    />,
  );
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  // Les deux mains sont numérotées : sans numéro, la marque n'aurait rien à
  // désigner pour un joueur qui n'utilise pas la couleur.
  assert.match(html, /Main 1/);
  assert.match(html, /Main 2/);
  assert.match(html, /à jouer/);
});

test("une main seule n'est pas numérotée", () => {
  const html = renderToStaticMarkup(<BlackjackTable view={view()} />);
  assert.doesNotMatch(html, /Main 1/);
});

test("le verdict est apposé sur chaque main réglée", () => {
  const html = renderToStaticMarkup(
    <BlackjackTable
      view={view({
        phase: "result",
        turn: null,
        allowedActions: [],
        seats: [
          seat({
            hands: [hand({ status: "busted", total: 23, soft: false }), hand({ status: "won" })],
            roundNet: 150,
          }),
        ],
        dealer: { cards: [{ rank: "9", suit: "clubs" }, { rank: "8", suit: "spades" }], total: 17, soft: false },
      })}
    />,
  );
  assert.match(html, /Sauté/);
  assert.match(html, /Gagné/);
  assert.match(html, /\+150 MC/);
});

/**
 * Un seul anneau tourne à la fois.
 *
 * Pendant le tour des joueurs il appartient à l'avatar du joueur actif ;
 * pendant les mises, à la montre de table. Deux anneaux visibles en même temps
 * donneraient deux réponses à « combien de temps me reste-t-il ».
 */
test("l'anneau de temps se pose sur le joueur au trait", () => {
  const html = renderToStaticMarkup(
    <BlackjackTable view={view({ deadlineAt: "2026-08-12T00:00:25.000Z" })} />,
  );
  assert.equal((html.match(/animation:tour-ring/g) ?? []).length, 1);
});

test("pendant les mises, l'anneau revient à la montre de table", () => {
  const html = renderToStaticMarkup(
    <BlackjackTable
      view={view({
        phase: "betting",
        turn: null,
        allowedActions: [],
        deadlineAt: "2026-08-12T00:00:15.000Z",
        seats: [seat({ hands: [], participating: false, totalWager: 0 })],
        dealer: { cards: [], total: null, soft: null },
      })}
    />,
  );
  assert.equal((html.match(/animation:tour-ring/g) ?? []).length, 1);
  assert.match(html, /Faites vos jeux/);
});

test("le tapis porte les règles de paiement du croupier", () => {
  const html = renderToStaticMarkup(<BlackjackTable view={view()} />);
  assert.match(html, /BLACKJACK PAIE 3 POUR 2/);
  assert.match(html, /RESTE À 17/);
});

/**
 * Les chaises libres ne sont cliquables que pour qui n'en occupe aucune.
 *
 * Les proposer à un joueur déjà assis lui laisserait croire qu'il peut tenir
 * deux mains — ce que la table refuse.
 */
test("un spectateur peut cliquer chaque place libre", () => {
  const html = renderToStaticMarkup(
    <BlackjackTable
      view={view({ you: null, turn: null, allowedActions: [], watching: 2 })}
      onSit={() => {}}
    />,
  );
  assert.equal((html.match(/S&#x27;asseoir à la place/g) ?? []).length, 4);
  assert.match(html, /2 spectateurs/);
});

test("un joueur assis ne se voit proposer aucune chaise", () => {
  const html = renderToStaticMarkup(<BlackjackTable view={view()} onSit={() => {}} />);
  assert.doesNotMatch(html, /asseoir/);
  assert.equal((html.match(/Libre/g) ?? []).length, 4);
});

test("sans spectateur, la table n'affiche pas de galerie", () => {
  const html = renderToStaticMarkup(<BlackjackTable view={view({ watching: 0 })} />);
  assert.doesNotMatch(html, /spectateur/);
});

test("le préavis d'éviction apparaît une manche avant la dernière", () => {
  const paisible = renderToStaticMarkup(
    <BlackjackTable view={view({ seats: [seat({ idleRounds: 1 })] })} />,
  );
  assert.doesNotMatch(paisible, /perds ta place/);

  const menace = renderToStaticMarkup(
    <BlackjackTable view={view({ seats: [seat({ idleRounds: 2 })] })} />,
  );
  assert.match(menace, /perds ta place/);
});

test("un joueur qui se lève après la manche l'annonce à la table", () => {
  const html = renderToStaticMarkup(
    <BlackjackTable view={view({ seats: [seat({ standingAfterRound: true })] })} />,
  );
  assert.match(html, /Se lève après la manche/);
});

test("la jauge du sabot suit le nombre de cartes restantes", () => {
  const html = renderToStaticMarkup(<BlackjackTable view={view({ shoeRemaining: 156 })} />);
  assert.match(html, /156 cartes/);
  // Six jeux de 52 cartes : la moitié du sabot est consommée.
  assert.match(html, /height:50%/);
});
