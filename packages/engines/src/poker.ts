/**
 * Texas Hold'em — règles pures.
 *
 * Aucune entrée/sortie, aucune socket, aucune base : la totalité des règles se
 * teste en millisecondes. C'est indispensable ici, parce que les cas qui font
 * échouer un moteur de poker — pots secondaires, relance incomplète, heads-up —
 * demanderaient sinon trois navigateurs et une table de vrais joueurs.
 *
 * L'API est **immuable** : chaque fonction rend un nouvel état. En interne, on
 * clone puis on mute le clone — un poker écrit en immuabilité stricte devient
 * illisible au bout de trois relances, et le clone protège tout aussi bien
 * l'appelant.
 */

import { createPokerDeck, evaluateSeven, type PokerEngineCard, type PokerHandRank } from "./poker-hand.js";
import type { RandomIndex } from "./blackjack.js";

export type PokerStreet = "preflop" | "flop" | "turn" | "river" | "showdown" | "ended";
export type PokerSeatStatus = "active" | "folded" | "allin";
export type PokerActionKind = "fold" | "check" | "call" | "bet" | "raise" | "allin";

export interface PokerSeatState {
  seat: number;
  /** Jetons devant le joueur, mise du tour non comprise. */
  stack: number;
  /** Engagé sur la rue en cours. */
  committed: number;
  /** Engagé depuis le début de la main : c'est la base des pots secondaires. */
  totalCommitted: number;
  cards: [PokerEngineCard, PokerEngineCard] | null;
  status: PokerSeatStatus;
  /** A parlé depuis la dernière relance **complète**. Ferme le tour d'enchères. */
  hasActed: boolean;
  /**
   * Une relance incomplète l'a dépassé : il peut suivre ou se coucher, jamais
   * relancer. C'est la règle la plus oubliée du Hold'em.
   */
  cappedToCall: boolean;
}

export interface PokerPot {
  amount: number;
  /** Sièges qui peuvent le remporter. Un couché a pu l'alimenter sans y prétendre. */
  eligible: number[];
}

export interface PokerAward {
  seat: number;
  amount: number;
}

export interface PokerShowdownEntry {
  seat: number;
  rank: PokerHandRank;
}

export interface PokerHandState {
  seats: (PokerSeatState | null)[];
  button: number;
  smallBlind: number;
  bigBlind: number;
  street: PokerStreet;
  board: PokerEngineCard[];
  deck: PokerEngineCard[];
  cursor: number;
  /** Plus haute mise à égaler sur la rue en cours. */
  currentBet: number;
  /** Incrément minimal d'une relance complète. */
  minRaise: number;
  lastAggressor: number | null;
  turn: number | null;
  pots: PokerPot[];
  awards: PokerAward[];
  showdown: PokerShowdownEntry[];
}

export interface PokerLegalActions {
  actions: PokerActionKind[];
  /** Complément à verser pour suivre. Zéro quand le check est gratuit. */
  callAmount: number;
  /** Montant **total** minimal d'une relance. */
  minRaiseTo: number;
  /** Montant total maximal : le tapis. */
  maxRaiseTo: number;
}

// ---------------------------------------------------------------------------
// Utilitaires d'état
// ---------------------------------------------------------------------------

function clone(state: PokerHandState): PokerHandState {
  return {
    ...state,
    seats: state.seats.map((seat) => (seat ? { ...seat } : null)),
    board: [...state.board],
    deck: [...state.deck],
    pots: state.pots.map((pot) => ({ ...pot, eligible: [...pot.eligible] })),
    awards: [...state.awards],
    showdown: [...state.showdown],
  };
}

function seatAt(state: PokerHandState, seat: number): PokerSeatState {
  const found = state.seats[seat];
  if (!found) throw new Error(`Siège vide : ${seat}`);
  return found;
}

/** Sièges occupés, dans l'ordre croissant. */
export function occupiedSeats(state: PokerHandState): number[] {
  return state.seats.flatMap((seat) => (seat ? [seat.seat] : []));
}

/** Siège occupé suivant, en tournant dans le sens horaire. */
function nextOccupied(state: PokerHandState, from: number): number {
  const places = occupiedSeats(state);
  if (places.length === 0) throw new Error("Table vide");
  for (let pas = 1; pas <= state.seats.length; pas += 1) {
    const candidat = (from + pas) % state.seats.length;
    if (state.seats[candidat]) return candidat;
  }
  return from;
}

/** Joueurs encore en lice : ils peuvent gagner le pot, même à tapis. */
function contenders(state: PokerHandState): PokerSeatState[] {
  return state.seats.filter(
    (seat): seat is PokerSeatState => seat !== null && seat.status !== "folded",
  );
}

/** Joueurs qui peuvent encore parler et miser. */
function actives(state: PokerHandState): PokerSeatState[] {
  return state.seats.filter(
    (seat): seat is PokerSeatState => seat !== null && seat.status === "active",
  );
}

/**
 * Prochain siège à parler après celui-ci, ou `null` si le tour est clos.
 *
 * Un joueur à tapis n'a plus rien à dire : on l'enjambe sans fermer le tour
 * pour autant, les autres pouvant encore se disputer le pot secondaire.
 */
function nextToAct(state: PokerHandState, from: number): number | null {
  // Le pas compte des **chaises**, pas des joueurs : sur une table de six où
  // deux personnes jouent, s'arrêter au bout de deux pas laisserait le balayage
  // dans les places vides sans jamais boucler jusqu'au premier siège.
  for (let pas = 1; pas <= state.seats.length; pas += 1) {
    const candidat = (from + pas) % state.seats.length;
    const siege = state.seats[candidat];
    if (!siege || siege.status !== "active") continue;
    if (!siege.hasActed || siege.committed < state.currentBet) return candidat;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bouton et blindes
// ---------------------------------------------------------------------------

/** Bouton de la main suivante : le siège occupé qui suit celui-ci. */
export function nextButton(occupied: number[], button: number, seatCount: number): number {
  if (occupied.length === 0) return button;
  for (let pas = 1; pas <= seatCount; pas += 1) {
    const candidat = (button + pas) % seatCount;
    if (occupied.includes(candidat)) return candidat;
  }
  return button;
}

/**
 * Positions des blindes et premier à parler avant le flop.
 *
 * **Le heads-up inverse tout** : à deux joueurs, le bouton est la petite blinde,
 * il parle en premier avant le flop et en dernier ensuite. C'est le détail que
 * les implémentations ratent systématiquement, et il fausse toute la partie.
 */
export function pokerBlindPositions(
  occupied: number[],
  button: number,
  seatCount: number,
): { small: number; big: number; firstToAct: number } {
  if (occupied.length < 2) throw new Error("Il faut au moins deux joueurs");

  const suivant = (from: number): number => {
    for (let pas = 1; pas <= seatCount; pas += 1) {
      const candidat = (from + pas) % seatCount;
      if (occupied.includes(candidat)) return candidat;
    }
    return from;
  };

  if (occupied.length === 2) {
    const big = suivant(button);
    return { small: button, big, firstToAct: button };
  }

  const small = suivant(button);
  const big = suivant(small);
  return { small, big, firstToAct: suivant(big) };
}

/** Verse des jetons depuis le tapis ; passe à tapis si le tapis n'y suffit pas. */
function commit(seat: PokerSeatState, amount: number): number {
  const verse = Math.min(amount, seat.stack);
  seat.stack -= verse;
  seat.committed += verse;
  seat.totalCommitted += verse;
  if (seat.stack === 0) seat.status = "allin";
  return verse;
}

// ---------------------------------------------------------------------------
// Démarrage d'une main
// ---------------------------------------------------------------------------

export interface PokerStartInput {
  /** Joueurs en jeu, avec leur tapis. Deux au minimum. */
  players: { seat: number; stack: number }[];
  seatCount: number;
  button: number;
  smallBlind: number;
  bigBlind: number;
  /** Jeu mélangé. Fourni par l'appelant, comme le sabot du blackjack. */
  deck: PokerEngineCard[];
}

export function startPokerHand(input: PokerStartInput): PokerHandState {
  if (input.players.length < 2) throw new Error("Il faut au moins deux joueurs");

  const seats: (PokerSeatState | null)[] = Array.from({ length: input.seatCount }, () => null);
  for (const joueur of input.players) {
    seats[joueur.seat] = {
      seat: joueur.seat,
      stack: joueur.stack,
      committed: 0,
      totalCommitted: 0,
      cards: null,
      status: "active",
      hasActed: false,
      cappedToCall: false,
    };
  }

  const state: PokerHandState = {
    seats,
    button: input.button,
    smallBlind: input.smallBlind,
    bigBlind: input.bigBlind,
    street: "preflop",
    board: [],
    deck: [...input.deck],
    cursor: 0,
    currentBet: 0,
    minRaise: input.bigBlind,
    lastAggressor: null,
    turn: null,
    pots: [],
    awards: [],
    showdown: [],
  };

  const places = occupiedSeats(state);
  const { small, big, firstToAct } = pokerBlindPositions(places, state.button, input.seatCount);

  // Les blindes sont **postées**, pas jouées : les poster ne vaut pas avoir
  // parlé. C'est ce qui donne son option à la grosse blinde en fin de tour.
  commit(seatAt(state, small), state.smallBlind);
  commit(seatAt(state, big), state.bigBlind);

  state.currentBet = state.bigBlind;
  state.minRaise = state.bigBlind;
  state.lastAggressor = big;

  // Distribution : une carte à chacun en partant de la petite blinde, puis un
  // second tour. L'ordre compte pour l'animation, qui le rejoue tel quel.
  const mains = new Map<number, PokerEngineCard[]>();
  for (let tour = 0; tour < 2; tour += 1) {
    let siege = small;
    for (let i = 0; i < places.length; i += 1) {
      const carte = state.deck[state.cursor];
      state.cursor += 1;
      if (!carte) throw new Error("Jeu épuisé à la distribution");
      const main = mains.get(siege) ?? [];
      main.push(carte);
      mains.set(siege, main);
      siege = nextOccupied(state, siege);
    }
  }
  for (const [siege, main] of mains) {
    const [premiere, seconde] = main;
    if (!premiere || !seconde) throw new Error("Main incomplète à la distribution");
    seatAt(state, siege).cards = [premiere, seconde];
  }

  // Le premier à parler peut avoir été mis à tapis par sa propre blinde : on
  // passe alors au suivant. `nextToAct` depuis la grosse blinde donne le bon
  // siège dans les deux cas, table pleine comme heads-up.
  void firstToAct;
  state.turn = nextToAct(state, big);
  return advanceIfNeeded(state);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function legalPokerActions(state: PokerHandState, seat: number): PokerLegalActions {
  const joueur = seatAt(state, seat);
  const aCombler = Math.max(0, state.currentBet - joueur.committed);
  const maxRaiseTo = joueur.committed + joueur.stack;

  if (state.turn !== seat || joueur.status !== "active") {
    return { actions: [], callAmount: 0, minRaiseTo: 0, maxRaiseTo };
  }

  const actions: PokerActionKind[] = ["fold"];
  if (aCombler === 0) actions.push("check");
  else if (joueur.stack > 0) actions.push("call");

  // Relancer suppose d'avoir de quoi dépasser la mise courante, et de ne pas
  // avoir été plafonné par une relance incomplète.
  const minRaiseTo = state.currentBet + state.minRaise;
  const peutRelancer = !joueur.cappedToCall && maxRaiseTo > state.currentBet;
  if (peutRelancer) {
    if (state.currentBet === 0) actions.push("bet");
    else if (maxRaiseTo >= minRaiseTo) actions.push("raise");
  }
  if (joueur.stack > 0) actions.push("allin");

  return {
    actions,
    callAmount: Math.min(aCombler, joueur.stack),
    minRaiseTo: state.currentBet === 0 ? Math.min(state.bigBlind, maxRaiseTo) : minRaiseTo,
    maxRaiseTo,
  };
}

/**
 * Applique une action et fait avancer la main.
 *
 * `amount` est toujours un **montant total visé** (« relance à 300 »), jamais un
 * delta. Un delta oblige le client et le serveur à s'accorder sur ce qui est
 * déjà engagé, et c'est la première source de divergence entre les deux.
 */
export function applyPokerAction(
  state: PokerHandState,
  seat: number,
  action: { kind: PokerActionKind; amount?: number },
): PokerHandState {
  if (state.turn !== seat) throw new Error("Ce n'est pas à ce siège de parler");
  const next = clone(state);
  const joueur = seatAt(next, seat);
  if (joueur.status !== "active") throw new Error("Ce joueur ne peut plus agir");

  const aCombler = Math.max(0, next.currentBet - joueur.committed);
  const legal = legalPokerActions(state, seat);
  if (!legal.actions.includes(action.kind)) {
    throw new Error(`Action interdite : ${action.kind}`);
  }

  switch (action.kind) {
    case "fold":
      joueur.status = "folded";
      joueur.hasActed = true;
      break;

    case "check":
      joueur.hasActed = true;
      break;

    case "call":
      commit(joueur, aCombler);
      joueur.hasActed = true;
      break;

    case "bet":
    case "raise":
    case "allin": {
      const vise =
        action.kind === "allin"
          ? joueur.committed + joueur.stack
          : (action.amount ?? 0);
      if (action.kind !== "allin") {
        if (vise < legal.minRaiseTo) throw new Error("Relance inférieure au minimum");
        if (vise > legal.maxRaiseTo) throw new Error("Relance supérieure au tapis");
      }
      commit(joueur, vise - joueur.committed);
      joueur.hasActed = true;
      appliquerHausse(next, joueur);
      break;
    }
  }

  next.turn = nextToAct(next, seat);
  return advanceIfNeeded(next);
}

/**
 * Répercute une hausse de la mise sur les autres joueurs.
 *
 * Deux cas, et c'est ici que tout se joue :
 *
 * - **relance complète** : le tour se rouvre, chacun peut à nouveau relancer ;
 * - **relance incomplète** (un tapis inférieur au minimum) : la mise monte, mais
 *   l'incrément minimal ne bouge pas et le tour ne se rouvre pas. Ceux qui ont
 *   déjà parlé peuvent compléter, pas relancer.
 */
function appliquerHausse(state: PokerHandState, acteur: PokerSeatState): void {
  if (acteur.committed <= state.currentBet) return;

  const hausse = acteur.committed - state.currentBet;
  const complete = hausse >= state.minRaise;

  state.currentBet = acteur.committed;
  if (complete) {
    state.minRaise = hausse;
    state.lastAggressor = acteur.seat;
  }

  for (const autre of state.seats) {
    if (!autre || autre.seat === acteur.seat || autre.status !== "active") continue;
    if (complete) {
      autre.hasActed = false;
      autre.cappedToCall = false;
    } else if (autre.committed < state.currentBet) {
      // Il doit compléter. Le plafonnement ne frappe que ceux qui **avaient
      // déjà parlé** : une relance incomplète leur retire le droit de relancer
      // à nouveau. Celui qui n'a pas encore ouvert la bouche garde tous ses
      // droits — il n'a rien à se voir retirer.
      if (autre.hasActed) autre.cappedToCall = true;
      autre.hasActed = false;
    }
  }
}

/** À l'expiration du temps : on checke si c'est gratuit, sinon on se couche. */
export function autoPokerAction(state: PokerHandState, seat: number): PokerHandState {
  const legal = legalPokerActions(state, seat);
  return applyPokerAction(state, seat, {
    kind: legal.actions.includes("check") ? "check" : "fold",
  });
}

// ---------------------------------------------------------------------------
// Progression des rues
// ---------------------------------------------------------------------------

const ORDRE: PokerStreet[] = ["preflop", "flop", "turn", "river", "showdown"];

function tirer(state: PokerHandState, combien: number): void {
  // Une carte brûlée avant chaque tirage, comme sur une vraie table : sans
  // elle, un joueur qui aurait aperçu le dessus du paquet saurait ce qui vient.
  state.cursor += 1;
  for (let i = 0; i < combien; i += 1) {
    const carte = state.deck[state.cursor];
    state.cursor += 1;
    if (!carte) throw new Error("Jeu épuisé au tableau");
    state.board.push(carte);
  }
}

/**
 * Rend la mise que personne n'a suivie.
 *
 * Un joueur qui mise 800 face à un tapis de 500 ne perd pas les 300
 * excédentaires : ils lui reviennent avant que les pots ne soient constitués.
 */
function rendreLeSurplus(state: PokerHandState): void {
  const engages = state.seats
    .filter((seat): seat is PokerSeatState => seat !== null && seat.committed > 0)
    .sort((a, b) => b.committed - a.committed);
  const premier = engages[0];
  const second = engages[1];
  if (!premier) return;

  const plafond = second?.committed ?? 0;
  const surplus = premier.committed - plafond;
  if (surplus <= 0) return;

  premier.committed -= surplus;
  premier.totalCommitted -= surplus;
  premier.stack += surplus;
  // Le joueur récupère des jetons : il n'est donc plus à tapis.
  if (premier.status === "allin" && premier.stack > 0) premier.status = "active";
}

function closeStreet(state: PokerHandState): void {
  rendreLeSurplus(state);
  for (const siege of state.seats) {
    if (!siege) continue;
    siege.committed = 0;
    siege.hasActed = false;
    siege.cappedToCall = false;
  }
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.lastAggressor = null;
}

/**
 * Fait avancer la main tant qu'il n'y a plus rien à demander à personne.
 *
 * Trois sorties : un seul joueur reste debout, plus personne ne peut miser (on
 * déroule le tableau d'un trait), ou la rue suivante commence.
 */
function advanceIfNeeded(state: PokerHandState): PokerHandState {
  if (state.street === "showdown" || state.street === "ended") return state;

  // Un seul joueur encore en lice : il ramasse, sans montrer ses cartes.
  if (contenders(state).length <= 1) {
    closeStreet(state);
    return terminer(state);
  }

  // Le tour d'enchères continue.
  if (state.turn !== null) return state;

  closeStreet(state);

  // Moins de deux joueurs peuvent encore miser : plus aucune enchère n'est
  // possible, on abat le tableau d'un seul coup.
  const peuventMiser = actives(state).filter((seat) => seat.stack > 0);
  const runOut = peuventMiser.length < 2;

  let index = ORDRE.indexOf(state.street);
  while (index < ORDRE.length - 1) {
    index += 1;
    const rue = ORDRE[index];
    if (!rue) break;
    state.street = rue;
    if (rue === "flop") tirer(state, 3);
    else if (rue === "turn" || rue === "river") tirer(state, 1);

    if (rue === "showdown") return terminer(state);
    if (!runOut) {
      // Premier à parler après le flop : le joueur actif le plus proche à
      // gauche du bouton. Au heads-up, c'est la grosse blinde — l'inverse du
      // préflop.
      state.turn = nextToAct(state, state.button);
      if (state.turn !== null) return state;
    }
  }

  return terminer(state);
}

// ---------------------------------------------------------------------------
// Pots et attribution
// ---------------------------------------------------------------------------

/**
 * Découpe les mises en pots, par paliers.
 *
 * L'argent d'un joueur couché reste dans le pot — il ne peut simplement rien
 * gagner. C'est la seule méthode qui reste juste quand trois joueurs partent à
 * tapis pour des montants différents.
 */
export function buildPots(seats: readonly (PokerSeatState | null)[]): PokerPot[] {
  const engages = seats.filter(
    (seat): seat is PokerSeatState => seat !== null && seat.totalCommitted > 0,
  );
  if (engages.length === 0) return [];

  const paliers = [...new Set(engages.map((seat) => seat.totalCommitted))].sort((a, b) => a - b);
  const pots: PokerPot[] = [];
  let precedent = 0;

  for (const palier of paliers) {
    let montant = 0;
    for (const siege of engages) {
      montant += Math.min(siege.totalCommitted, palier) - Math.min(siege.totalCommitted, precedent);
    }
    const eligible = engages
      .filter((seat) => seat.status !== "folded" && seat.totalCommitted >= palier)
      .map((seat) => seat.seat);

    // Deux paliers de même audience se fondent : afficher trois pots identiques
    // n'apprendrait rien au joueur.
    const dernier = pots[pots.length - 1];
    if (dernier && memeAudience(dernier.eligible, eligible)) dernier.amount += montant;
    else if (montant > 0) pots.push({ amount: montant, eligible });

    precedent = palier;
  }

  return pots;
}

function memeAudience(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((seat) => b.includes(seat));
}

/**
 * Répartit chaque pot entre ses gagnants.
 *
 * Le jeton impair d'un partage revient au premier siège à gauche du bouton :
 * règle standard, déterministe, et surtout vérifiable — la somme des parts doit
 * égaler le pot au jeton près.
 */
export function distributePots(
  pots: readonly PokerPot[],
  scores: Map<number, number>,
  button: number,
  seatCount: number,
): PokerAward[] {
  const gains = new Map<number, number>();

  for (const pot of pots) {
    const candidats = pot.eligible.filter((seat) => scores.has(seat));
    if (candidats.length === 0) continue;

    const meilleur = Math.max(...candidats.map((seat) => scores.get(seat) ?? 0));
    const gagnants = candidats.filter((seat) => scores.get(seat) === meilleur);

    const part = Math.floor(pot.amount / gagnants.length);
    let reste = pot.amount - part * gagnants.length;
    for (const seat of gagnants) gains.set(seat, (gains.get(seat) ?? 0) + part);

    // Le reste se distribue un jeton à la fois, en partant du bouton.
    let siege = button;
    while (reste > 0) {
      siege = (siege + 1) % seatCount;
      if (!gagnants.includes(siege)) continue;
      gains.set(siege, (gains.get(siege) ?? 0) + 1);
      reste -= 1;
    }
  }

  return [...gains.entries()]
    .map(([seat, amount]) => ({ seat, amount }))
    .sort((a, b) => a.seat - b.seat);
}

/** Clôt la main : pots, abattage, versement des gains aux tapis. */
function terminer(state: PokerHandState): PokerHandState {
  state.pots = buildPots(state.seats);
  state.turn = null;

  const enLice = contenders(state);
  const scores = new Map<number, number>();

  if (enLice.length > 1) {
    // Abattage : chacun compose sa meilleure main de cinq parmi ses deux cartes
    // et les cinq du tableau.
    state.street = "showdown";
    for (const joueur of enLice) {
      if (!joueur.cards) continue;
      const rang = evaluateSeven([...joueur.cards, ...state.board]);
      scores.set(joueur.seat, rang.score);
      state.showdown.push({ seat: joueur.seat, rank: rang });
    }
  } else {
    // Un seul joueur debout : il ramasse sans rien montrer.
    const seul = enLice[0];
    if (seul) scores.set(seul.seat, 1);
  }

  state.awards = distributePots(state.pots, scores, state.button, state.seats.length);
  for (const gain of state.awards) {
    const siege = state.seats[gain.seat];
    if (siege) siege.stack += gain.amount;
  }

  state.street = "ended";
  return state;
}

/** Total en jeu, pour l'afficher au centre de la table. */
export function pokerPotTotal(state: PokerHandState): number {
  return state.seats.reduce((total, seat) => total + (seat?.totalCommitted ?? 0), 0);
}

/** Jeu mélangé, prêt pour une main. Aléa fourni par l'appelant. */
export function createPokerHandDeck(randomIndex: RandomIndex): PokerEngineCard[] {
  return createPokerDeck(randomIndex);
}
