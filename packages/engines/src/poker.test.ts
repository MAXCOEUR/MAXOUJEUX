import { describe, expect, it } from "vitest";
import {
  applyPokerAction,
  autoPokerAction,
  buildPots,
  createPokerHandDeck,
  distributePots,
  legalPokerActions,
  nextButton,
  pokerBlindPositions,
  pokerPotTotal,
  startPokerHand,
  type PokerHandState,
  type PokerSeatState,
} from "./poker.js";
import { POKER_RANKS, POKER_SUITS, type PokerEngineCard } from "./poker-hand.js";

/** Jeu non mélangé : les tests savent exactement qui reçoit quoi. */
function paquetOrdonne(): PokerEngineCard[] {
  const cartes: PokerEngineCard[] = [];
  for (const suit of POKER_SUITS) {
    for (const rank of POKER_RANKS) cartes.push({ rank, suit });
  }
  return cartes;
}

function table(
  tapis: number[],
  options: { button?: number; sb?: number; bb?: number; seatCount?: number } = {},
): PokerHandState {
  const seatCount = options.seatCount ?? tapis.length;
  return startPokerHand({
    players: tapis.map((stack, seat) => ({ seat, stack })),
    seatCount,
    button: options.button ?? 0,
    smallBlind: options.sb ?? 10,
    bigBlind: options.bb ?? 20,
    deck: paquetOrdonne(),
  });
}

const siege = (state: PokerHandState, index: number): PokerSeatState => {
  const trouve = state.seats[index];
  if (!trouve) throw new Error(`siège ${index} vide`);
  return trouve;
};

describe("bouton et blindes", () => {
  it("place les blindes à gauche du bouton et fait parler le troisième", () => {
    const { small, big, firstToAct } = pokerBlindPositions([0, 1, 2, 3], 0, 4);
    expect(small).toBe(1);
    expect(big).toBe(2);
    expect(firstToAct).toBe(3);
  });

  it("inverse tout en heads-up : le bouton est la petite blinde", () => {
    // À deux joueurs, le bouton paie la petite blinde et parle **en premier**
    // avant le flop. L'oublier fausse toute la partie.
    const { small, big, firstToAct } = pokerBlindPositions([0, 1], 0, 2);
    expect(small).toBe(0);
    expect(big).toBe(1);
    expect(firstToAct).toBe(0);
  });

  it("enjambe les sièges vides", () => {
    const { small, big, firstToAct } = pokerBlindPositions([0, 3, 7], 0, 9);
    expect(small).toBe(3);
    expect(big).toBe(7);
    expect(firstToAct).toBe(0);
  });

  it("avance le bouton au siège occupé suivant", () => {
    expect(nextButton([0, 3, 7], 0, 9)).toBe(3);
    expect(nextButton([0, 3, 7], 7, 9)).toBe(0);
    expect(nextButton([2], 2, 9)).toBe(2);
  });
});

describe("distribution", () => {
  it("donne deux cartes à chacun et fait parler le bon joueur", () => {
    const state = table([1_000, 1_000, 1_000]);
    for (const index of [0, 1, 2]) expect(siege(state, index).cards).toHaveLength(2);
    // Bouton 0, petite blinde 1, grosse blinde 2 : c'est au bouton de parler.
    expect(state.turn).toBe(0);
    expect(siege(state, 1).committed).toBe(10);
    expect(siege(state, 2).committed).toBe(20);
    expect(state.currentBet).toBe(20);
  });

  it("ne donne jamais deux fois la même carte", () => {
    const state = table([1_000, 1_000, 1_000, 1_000, 1_000, 1_000]);
    const distribuees = state.seats.flatMap((seat) => seat?.cards ?? []);
    expect(distribuees).toHaveLength(12);
    expect(new Set(distribuees.map((c) => `${c.rank}${c.suit}`)).size).toBe(12);
  });

  it("met à tapis un joueur dont la blinde dépasse le tapis", () => {
    const state = table([1_000, 5, 1_000]);
    expect(siege(state, 1).status).toBe("allin");
    expect(siege(state, 1).committed).toBe(5);
  });
});

describe("tour d'enchères", () => {
  it("laisse son option à la grosse blinde quand tout le monde suit", () => {
    // Poster la blinde n'est pas « avoir parlé » : le tour doit revenir au
    // joueur de grosse blinde, qui peut checker ou relancer.
    let state = table([1_000, 1_000, 1_000]);
    state = applyPokerAction(state, 0, { kind: "call" });
    state = applyPokerAction(state, 1, { kind: "call" });
    expect(state.street).toBe("preflop");
    expect(state.turn).toBe(2);
    expect(legalPokerActions(state, 2).actions).toContain("check");
    expect(legalPokerActions(state, 2).actions).toContain("raise");

    state = applyPokerAction(state, 2, { kind: "check" });
    expect(state.street).toBe("flop");
    expect(state.board).toHaveLength(3);
  });

  it("rouvre le tour après une relance complète", () => {
    let state = table([1_000, 1_000, 1_000]);
    state = applyPokerAction(state, 0, { kind: "raise", amount: 60 });
    expect(state.currentBet).toBe(60);
    expect(state.minRaise).toBe(40);
    // La petite blinde doit reparler, et peut relancer à son tour.
    expect(state.turn).toBe(1);
    expect(legalPokerActions(state, 1).actions).toContain("raise");
    expect(legalPokerActions(state, 1).callAmount).toBe(50);
  });

  it("refuse une relance inférieure au minimum", () => {
    const state = table([1_000, 1_000, 1_000]);
    expect(() => applyPokerAction(state, 0, { kind: "raise", amount: 30 })).toThrow();
    expect(legalPokerActions(state, 0).minRaiseTo).toBe(40);
  });

  it("passe au flop quand tous ont parlé et égalé", () => {
    let state = table([1_000, 1_000]);
    state = applyPokerAction(state, 0, { kind: "call" });
    state = applyPokerAction(state, 1, { kind: "check" });
    expect(state.street).toBe("flop");
    // Heads-up postflop : la grosse blinde parle en premier, l'inverse du préflop.
    expect(state.turn).toBe(1);
  });

  it("remet la mise minimale à la grosse blinde à chaque nouvelle rue", () => {
    let state = table([1_000, 1_000]);
    state = applyPokerAction(state, 0, { kind: "call" });
    state = applyPokerAction(state, 1, { kind: "check" });
    expect(state.currentBet).toBe(0);
    expect(state.minRaise).toBe(20);
    expect(legalPokerActions(state, 1).actions).toContain("bet");
  });
});

describe("relance incomplète sur tapis", () => {
  it("monte la mise sans rendre le droit de relancer à qui avait déjà parlé", () => {
    // Le siège 3 relance à 300, le siège 0 suit, puis le siège 1 part à tapis
    // pour 350 : il faudrait 580 pour une relance complète, celle-ci ne l'est
    // pas. Le siège 0, qui avait déjà parlé, doit pouvoir compléter — pas
    // relancer.
    let state = table([1_000, 350, 1_000, 1_000], { button: 0 });
    state = applyPokerAction(state, 3, { kind: "raise", amount: 300 });
    expect(state.currentBet).toBe(300);
    expect(state.minRaise).toBe(280);

    state = applyPokerAction(state, 0, { kind: "call" });
    state = applyPokerAction(state, 1, { kind: "allin" });
    expect(siege(state, 1).status).toBe("allin");
    expect(state.currentBet).toBe(350);
    // L'incrément minimal n'a pas bougé : la relance était incomplète.
    expect(state.minRaise).toBe(280);

    // Le siège 2 n'avait encore rien dit : il garde tous ses droits.
    expect(legalPokerActions(state, 2).actions).toContain("raise");
    state = applyPokerAction(state, 2, { kind: "call" });

    // Vient le tour du siège 3, qui avait pourtant ouvert la relance : lui
    // aussi doit compléter les 50 manquants sans pouvoir relancer.
    expect(state.turn).toBe(3);
    const pourLAgresseur = legalPokerActions(state, 3);
    expect(pourLAgresseur.actions).toContain("call");
    expect(pourLAgresseur.actions).not.toContain("raise");
    expect(pourLAgresseur.callAmount).toBe(50);

    state = applyPokerAction(state, 3, { kind: "call" });

    // Le siège 0, qui avait suivi, est logé à la même enseigne.
    expect(state.turn).toBe(0);
    const pourCeluiQuiAvaitSuivi = legalPokerActions(state, 0);
    expect(pourCeluiQuiAvaitSuivi.actions).toContain("call");
    expect(pourCeluiQuiAvaitSuivi.actions).not.toContain("raise");
    expect(pourCeluiQuiAvaitSuivi.callAmount).toBe(50);
  });

  it("laisse relancer celui qui n'avait pas encore parlé", () => {
    // Le plafonnement ne concerne que ceux qui avaient déjà agi : un joueur qui
    // n'a pas encore parlé garde tous ses droits.
    let state = table([1_000, 1_000, 1_000, 30], { button: 0 });
    state = applyPokerAction(state, 3, { kind: "allin" }); // 30, incomplet
    expect(state.currentBet).toBe(30);
    expect(legalPokerActions(state, 0).actions).toContain("raise");
  });
});

describe("mise non suivie", () => {
  it("rend le surplus à celui que personne n'a pu suivre", () => {
    // A mise 800 face à un tapis de 200 : les 600 excédentaires lui reviennent,
    // ils n'ont jamais été en jeu.
    let state = table([1_000, 200], { button: 0, sb: 10, bb: 20 });
    state = applyPokerAction(state, 0, { kind: "raise", amount: 800 });
    state = applyPokerAction(state, 1, { kind: "allin" });

    expect(state.street).toBe("ended");
    const perdantOuGagnant = siege(state, 0).stack + siege(state, 1).stack;
    // Rien ne se crée ni ne se perd : les deux tapis de départ se retrouvent.
    expect(perdantOuGagnant).toBe(1_200);
    // Le joueur 0 a au minimum récupéré son surplus de 600.
    expect(siege(state, 0).stack).toBeGreaterThanOrEqual(600);
  });
});

describe("pots secondaires", () => {
  it("découpe trois tapis inégaux en trois pots", () => {
    const seats = [
      { seat: 0, totalCommitted: 100, status: "allin" },
      { seat: 1, totalCommitted: 300, status: "allin" },
      { seat: 2, totalCommitted: 1_000, status: "active" },
    ].map((s) => ({ ...s, stack: 0, committed: 0, cards: null, hasActed: true, cappedToCall: false })) as PokerSeatState[];

    const pots = buildPots(seats);
    expect(pots).toHaveLength(3);
    expect(pots[0]).toMatchObject({ amount: 300, eligible: [0, 1, 2] });
    expect(pots[1]).toMatchObject({ amount: 400, eligible: [1, 2] });
    expect(pots[2]).toMatchObject({ amount: 700, eligible: [2] });
    expect(pots.reduce((total, pot) => total + pot.amount, 0)).toBe(1_400);
  });

  it("garde l'argent d'un joueur couché sans le rendre éligible", () => {
    const seats = [
      { seat: 0, totalCommitted: 500, status: "folded" },
      { seat: 1, totalCommitted: 200, status: "allin" },
      { seat: 2, totalCommitted: 500, status: "active" },
    ].map((s) => ({ ...s, stack: 0, committed: 0, cards: null, hasActed: true, cappedToCall: false })) as PokerSeatState[];

    const pots = buildPots(seats);
    expect(pots.reduce((total, pot) => total + pot.amount, 0)).toBe(1_200);
    for (const pot of pots) expect(pot.eligible).not.toContain(0);
  });
});

describe("attribution des pots", () => {
  it("donne le pot au meilleur score", () => {
    const awards = distributePots([{ amount: 300, eligible: [0, 1] }], new Map([[0, 500], [1, 900]]), 0, 3);
    expect(awards).toEqual([{ seat: 1, amount: 300 }]);
  });

  it("partage à égalité et donne le jeton impair au premier à gauche du bouton", () => {
    // Un pot de 7 partagé entre deux joueurs : 3 chacun, et le jeton restant au
    // siège 1, premier à gauche du bouton 0. Jamais un arrondi.
    const awards = distributePots([{ amount: 7, eligible: [1, 2] }], new Map([[1, 900], [2, 900]]), 0, 3);
    expect(awards).toEqual([
      { seat: 1, amount: 4 },
      { seat: 2, amount: 3 },
    ]);
    expect(awards.reduce((total, a) => total + a.amount, 0)).toBe(7);
  });

  it("n'attribue jamais plus ni moins que le pot", () => {
    const pots = [
      { amount: 300, eligible: [0, 1, 2] },
      { amount: 400, eligible: [1, 2] },
    ];
    const awards = distributePots(pots, new Map([[0, 100], [1, 900], [2, 900]]), 2, 3);
    expect(awards.reduce((total, a) => total + a.amount, 0)).toBe(700);
  });
});

describe("fin de main", () => {
  it("donne tout au dernier joueur debout, sans abattage", () => {
    let state = table([1_000, 1_000, 1_000]);
    state = applyPokerAction(state, 0, { kind: "fold" });
    state = applyPokerAction(state, 1, { kind: "fold" });

    expect(state.street).toBe("ended");
    expect(state.showdown).toHaveLength(0);
    // La grosse blinde ramasse les deux blindes : elle retrouve son tapis plus 10.
    expect(siege(state, 2).stack).toBe(1_010);
  });

  it("déroule le tableau d'un trait quand plus personne ne peut miser", () => {
    let state = table([200, 200], { button: 0 });
    state = applyPokerAction(state, 0, { kind: "allin" });
    state = applyPokerAction(state, 1, { kind: "call" });

    expect(state.board).toHaveLength(5);
    expect(state.street).toBe("ended");
    expect(state.showdown).toHaveLength(2);
    expect(siege(state, 0).stack + siege(state, 1).stack).toBe(400);
  });

  it("conserve la masse de jetons sur une main complète", () => {
    // L'invariant qui compte : le poker déplace des jetons, il n'en crée pas.
    let state = table([1_000, 1_000, 1_000]);
    const depart = 3_000;
    state = applyPokerAction(state, 0, { kind: "call" });
    state = applyPokerAction(state, 1, { kind: "call" });
    state = applyPokerAction(state, 2, { kind: "check" });
    state = applyPokerAction(state, 1, { kind: "bet", amount: 40 });
    state = applyPokerAction(state, 2, { kind: "call" });
    state = applyPokerAction(state, 0, { kind: "fold" });

    while (state.street !== "ended") {
      const tour = state.turn;
      if (tour === null) break;
      state = autoPokerAction(state, tour);
    }

    const total = state.seats.reduce((somme, seat) => somme + (seat?.stack ?? 0), 0);
    expect(total).toBe(depart);
  });
});

describe("temps écoulé", () => {
  it("checke quand c'est gratuit, se couche sinon", () => {
    let state = table([1_000, 1_000, 1_000]);
    // Au bouton, il faut payer 20 : le temps écoulé le couche.
    state = autoPokerAction(state, 0);
    expect(siege(state, 0).status).toBe("folded");

    state = applyPokerAction(state, 1, { kind: "call" });
    // La grosse blinde n'a rien à payer : le temps écoulé la fait checker.
    state = autoPokerAction(state, 2);
    expect(siege(state, 2).status).toBe("active");
    expect(state.street).toBe("flop");
  });
});

describe("total en jeu", () => {
  it("compte tout ce qui a été engagé", () => {
    const state = table([1_000, 1_000, 1_000]);
    expect(pokerPotTotal(state)).toBe(30);
  });
});

describe("cent mains automatiques", () => {
  it("terminent toujours et conservent les jetons", () => {
    // Générateur reproductible : ce test ne peut pas devenir instable, et il
    // couvre des enchaînements qu'aucun cas écrit à la main n'atteindrait.
    let graine = 424_242;
    const aleatoire = (borne: number) => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return Math.floor((graine / 2147483648) * borne);
    };

    for (let partie = 0; partie < 100; partie += 1) {
      const tapis = [400 + aleatoire(600), 400 + aleatoire(600), 400 + aleatoire(600)];
      const depart = tapis.reduce((a, b) => a + b, 0);
      let state = startPokerHand({
        players: tapis.map((stack, seat) => ({ seat, stack })),
        seatCount: 3,
        button: partie % 3,
        smallBlind: 10,
        bigBlind: 20,
        deck: createPokerHandDeck(aleatoire),
      });

      let garde = 0;
      while (state.street !== "ended" && garde < 200) {
        const tour = state.turn;
        if (tour === null) break;
        const legal = legalPokerActions(state, tour);
        // Un choix varié : suivre, relancer ou se coucher selon l'aléa.
        const tirage = aleatoire(10);
        if (tirage < 2 && legal.actions.includes("fold")) {
          state = applyPokerAction(state, tour, { kind: "fold" });
        } else if (tirage < 4 && legal.actions.includes("raise")) {
          state = applyPokerAction(state, tour, { kind: "raise", amount: legal.minRaiseTo });
        } else if (legal.actions.includes("check")) {
          state = applyPokerAction(state, tour, { kind: "check" });
        } else if (legal.actions.includes("call")) {
          state = applyPokerAction(state, tour, { kind: "call" });
        } else {
          state = applyPokerAction(state, tour, { kind: "fold" });
        }
        garde += 1;
      }

      expect(state.street).toBe("ended");
      const total = state.seats.reduce((somme, seat) => somme + (seat?.stack ?? 0), 0);
      expect(total).toBe(depart);
    }
  });
});
