/**
 * Évaluation des mains de poker — règles pures.
 *
 * Écrit à la main plutôt que délégué à `pokersolver`, pour trois raisons
 * concrètes : la bibliothèque n'expose pas de types TypeScript et ce paquet est
 * consommé en source par l'API **et** par le front ; ses libellés sont anglais
 * alors que l'écran doit annoncer « Full aux rois par les huit » ; et les pots
 * secondaires réclament un **score entier comparable**, pas un objet à comparer
 * par un comparateur maison de toute façon.
 *
 * Le classement retenu est celui du Texas Hold'em, sans joker et sans couleur
 * dominante : deux mains de même score sont **strictement** à égalité et
 * partagent le pot.
 */

import {
  POKER_CATEGORIES,
  POKER_RANKS,
  POKER_SUITS,
  type PokerCategory,
  type PokerRank,
  type PokerSuit,
} from "@maxoujeux/shared";

export { POKER_CATEGORIES, POKER_RANKS, POKER_SUITS };
export type { PokerCategory, PokerRank, PokerSuit };

/**
 * Carte du moteur.
 *
 * Structurellement identique à `PokerCard` du contrat partagé — c'est
 * volontaire : ce qui sort du moteur part tel quel sur la socket, sans
 * conversion, et le composant de carte du blackjack l'affiche sans adaptateur.
 * La quinte flush royale n'est **pas** une catégorie à part : c'est une quinte
 * flush à l'as, et l'inventer casserait la comparaison.
 */
export interface PokerEngineCard {
  readonly rank: PokerRank;
  readonly suit: PokerSuit;
}

export interface PokerHandRank {
  /**
   * Score entier, comparable par soustraction.
   *
   * Construit en base 13 : la catégorie pèse plus que le premier départage, qui
   * pèse plus que le deuxième, etc. Deux mains à égalité stricte ont exactement
   * le même score — c'est ce qui permet de partager un pot sans comparateur
   * spécial.
   */
  score: number;
  category: PokerCategory;
  /** Rangs signifiants, du plus déterminant au moins : sert à écrire le libellé. */
  ranks: number[];
  /** Les cinq cartes retenues, pour les mettre en avant à l'écran. */
  cards: PokerEngineCard[];
}

export function pokerRankIndex(rank: PokerRank): number {
  const index = POKER_RANKS.indexOf(rank);
  if (index < 0) throw new Error(`Rang inconnu : ${rank}`);
  return index;
}

/** Jeu de 52 cartes, mélangé par l'aléa fourni. */
export function createPokerDeck(
  randomIndex: (maximumExclusive: number) => number,
): PokerEngineCard[] {
  const cards: PokerEngineCard[] = [];
  for (const suit of POKER_SUITS) {
    for (const rank of POKER_RANKS) cards.push({ rank, suit });
  }
  // Fisher-Yates, comme le sabot du blackjack : un mélange partiel laisserait
  // des suites entières du jeu neuf en place.
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    const a = cards[i];
    const b = cards[j];
    if (a && b) {
      cards[i] = b;
      cards[j] = a;
    }
  }
  return cards;
}

/** Compose le score à partir de la catégorie et des rangs de départage. */
function composeScore(category: PokerCategory, ranks: number[]): number {
  let score = POKER_CATEGORIES.indexOf(category);
  for (let i = 0; i < 5; i += 1) {
    score = score * 13 + (ranks[i] ?? 0);
  }
  return score;
}

/**
 * Rang le plus haut d'une suite contenue dans ce masque, ou `null`.
 *
 * La **roue** A-2-3-4-5 est traitée à part : l'as y vaut 1, et la suite compte
 * comme la plus faible de toutes. L'oublier ferait battre un brelan d'as par
 * une roue, ce qui est faux.
 */
function straightHigh(mask: number): number | null {
  for (let high = 12; high >= 4; high -= 1) {
    const fenetre = 0b11111 << (high - 4);
    if ((mask & fenetre) === fenetre) return high;
  }
  // As-2-3-4-5 : l'as (index 12) complète le bas du tableau.
  const roue = (1 << 12) | 0b1111;
  return (mask & roue) === roue ? 3 : null;
}

/**
 * Évalue une main de **cinq** cartes.
 *
 * Les rangs de départage sont toujours rangés du plus déterminant au moins :
 * un brelan se départage sur ses deux kickers, une double paire sur la paire
 * haute puis la basse puis le kicker. Tronquer ces départages est l'erreur qui
 * fait perdre un pot au bon joueur.
 */
export function evaluateFive(cards: readonly PokerEngineCard[]): PokerHandRank {
  if (cards.length !== 5) {
    throw new Error(`Une main se compose de cinq cartes, pas ${cards.length}`);
  }

  const indexes = cards.map((card) => pokerRankIndex(card.rank));
  const parCouleur = new Map<PokerSuit, number>();
  const parRang = new Map<number, number>();
  let masque = 0;

  for (const [position, card] of cards.entries()) {
    parCouleur.set(card.suit, (parCouleur.get(card.suit) ?? 0) + 1);
    const rang = indexes[position] ?? 0;
    parRang.set(rang, (parRang.get(rang) ?? 0) + 1);
    masque |= 1 << rang;
  }

  const couleur = [...parCouleur.values()].some((compte) => compte === 5);
  const suite = straightHigh(masque);
  const retenues = [...cards];

  // Groupes de rangs, triés par taille puis par force : c'est l'ordre des
  // départages pour toutes les catégories à paires.
  const groupes = [...parRang.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0],
  );
  const rangs = groupes.map(([rang]) => rang);
  const tailles = groupes.map(([, compte]) => compte);

  if (couleur && suite !== null) {
    return { score: composeScore("quinte-flush", [suite]), category: "quinte-flush", ranks: [suite], cards: retenues };
  }
  if (tailles[0] === 4) {
    const ordre = [rangs[0] ?? 0, rangs[1] ?? 0];
    return { score: composeScore("carre", ordre), category: "carre", ranks: ordre, cards: retenues };
  }
  if (tailles[0] === 3 && tailles[1] === 2) {
    const ordre = [rangs[0] ?? 0, rangs[1] ?? 0];
    return { score: composeScore("full", ordre), category: "full", ranks: ordre, cards: retenues };
  }
  if (couleur) {
    const ordre = [...indexes].sort((a, b) => b - a);
    return { score: composeScore("couleur", ordre), category: "couleur", ranks: ordre, cards: retenues };
  }
  if (suite !== null) {
    return { score: composeScore("suite", [suite]), category: "suite", ranks: [suite], cards: retenues };
  }
  if (tailles[0] === 3) {
    return { score: composeScore("brelan", rangs), category: "brelan", ranks: rangs, cards: retenues };
  }
  if (tailles[0] === 2 && tailles[1] === 2) {
    return { score: composeScore("double-paire", rangs), category: "double-paire", ranks: rangs, cards: retenues };
  }
  if (tailles[0] === 2) {
    return { score: composeScore("paire", rangs), category: "paire", ranks: rangs, cards: retenues };
  }
  const ordre = [...indexes].sort((a, b) => b - a);
  return { score: composeScore("carte-haute", ordre), category: "carte-haute", ranks: ordre, cards: retenues };
}

/**
 * Meilleure main de cinq cartes parmi les sept disponibles.
 *
 * Énumération des vingt et une combinaisons, sans ruse. Un évaluateur à tables
 * précalculées serait dix fois plus rapide, mais on parle de deux cents
 * évaluations par main jouée, soit quelques microsecondes : la lisibilité vaut
 * mieux ici, et cette version se vérifie exhaustivement.
 */
export function evaluateSeven(cards: readonly PokerEngineCard[]): PokerHandRank {
  if (cards.length < 5) {
    throw new Error(`Il faut au moins cinq cartes pour évaluer une main, pas ${cards.length}`);
  }
  if (cards.length === 5) return evaluateFive(cards);

  let meilleure: PokerHandRank | null = null;
  const combinaison: PokerEngineCard[] = [];

  const explorer = (debut: number): void => {
    if (combinaison.length === 5) {
      const rang = evaluateFive(combinaison);
      if (!meilleure || rang.score > meilleure.score) meilleure = rang;
      return;
    }
    for (let i = debut; i < cards.length; i += 1) {
      const carte = cards[i];
      if (!carte) continue;
      combinaison.push(carte);
      explorer(i + 1);
      combinaison.pop();
    }
  };
  explorer(0);

  if (!meilleure) throw new Error("Aucune combinaison évaluable");
  return meilleure;
}

/** Ordre décroissant : la plus forte main d'abord. Zéro = égalité stricte. */
export function comparePokerHands(a: PokerHandRank, b: PokerHandRank): number {
  return b.score - a.score;
}
