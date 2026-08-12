/**
 * Calculs d'affichage de la table de blackjack.
 *
 * Les jetons n'y sont plus : ils servent aussi à la roulette et vivent
 * désormais dans `lib/chips.ts`.
 *
 * Rien ici n'est une règle du jeu — le serveur reste seul arbitre. Ce sont des
 * fonctions de mise en scène : combien de jetons dessiner pour représenter une
 * mise, quel siège occupe quelle place sur l'arc, d'où arrive une carte. Elles
 * vivent dans un module à part pour être testées sans monter un rendu React,
 * les composants n'ayant plus alors que du balisage à produire.
 */

import {
  BLACKJACK_ACTION_MS,
  BLACKJACK_BETTING_MS,
  BLACKJACK_INSURANCE_MS,
  BLACKJACK_RESULT_MS,
  type BlackjackCard,
  type BlackjackHandStatus,
  type BlackjackPhase,
} from "@maxoujeux/shared";

/**
 * Durée nominale de la phase courante, pour dimensionner l'anneau de temps.
 *
 * Les échéances arrivent du serveur en ISO, sans leur durée d'origine : sans
 * cette table, l'anneau ne saurait pas quelle fraction de tour il lui reste à
 * vider. Les constantes sont celles du paquet partagé — le serveur arme ses
 * minuteries avec les mêmes.
 */
export function phaseDurationMs(phase: BlackjackPhase): number | null {
  switch (phase) {
    case "betting":
      return BLACKJACK_BETTING_MS;
    case "insurance":
      return BLACKJACK_INSURANCE_MS;
    case "players":
      return BLACKJACK_ACTION_MS;
    case "result":
      return BLACKJACK_RESULT_MS;
    default:
      return null;
  }
}

/** Ce que la table fait en ce moment, du point de vue de qui regarde. */
export function phaseLabel(phase: BlackjackPhase, yourTurn: boolean): string {
  switch (phase) {
    case "idle":
      return "Table ouverte";
    case "betting":
      return "Faites vos jeux";
    case "insurance":
      return "Assurance proposée";
    case "players":
      return yourTurn ? "À toi de jouer" : "Tour des joueurs";
    case "dealer":
      return "Le croupier joue";
    case "result":
      return "Paiement";
  }
}

/** Cachet apposé sur une main réglée. `null` : la main est encore en jeu. */
export function handVerdict(
  status: BlackjackHandStatus,
): { label: string; tone: "gain" | "perte" | "nul" } | null {
  switch (status) {
    case "blackjack":
      return { label: "Blackjack", tone: "gain" };
    case "won":
      return { label: "Gagné", tone: "gain" };
    case "lost":
      return { label: "Perdu", tone: "perte" };
    case "push":
      return { label: "Égalité", tone: "nul" };
    case "busted":
      return { label: "Sauté", tone: "perte" };
    default:
      return null;
  }
}

const RANK_NAMES: Record<BlackjackCard["rank"], string> = {
  A: "As", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7",
  "8": "8", "9": "9", "10": "10", J: "Valet", Q: "Dame", K: "Roi",
};

const SUIT_NAMES: Record<BlackjackCard["suit"], string> = {
  clubs: "trèfle", diamonds: "carreau", hearts: "cœur", spades: "pique",
};

export const SUIT_GLYPHS: Record<BlackjackCard["suit"], string> = {
  clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠",
};

/** Nom parlé d'une carte. `null` est le dos, dont rien ne doit filtrer. */
export function cardLabel(card: BlackjackCard | null): string {
  if (!card) return "Carte fermée";
  return `${RANK_NAMES[card.rank]} de ${SUIT_NAMES[card.suit]}`;
}

export function isRedSuit(suit: BlackjackCard["suit"]): boolean {
  return suit === "hearts" || suit === "diamonds";
}

/**
 * Ordre des sièges sur l'arc : `retour[place] = numéro de siège`.
 *
 * Le joueur est toujours assis au **milieu**, face au croupier, et ses voisins
 * gardent leur ordre autour de l'ovale. C'est ainsi que fonctionne une vraie
 * table : on ne se déplace pas pour occuper la place numéro 3, on s'assoit et
 * la table tourne autour de soi. Le numéro de siège réel reste dans le libellé
 * accessible, il n'est pas perdu.
 *
 * Un spectateur — qui n'a pas de siège — voit l'ordre naturel.
 */
export function seatOrder(you: number | null, maxSeats: number): number[] {
  const places = Array.from({ length: maxSeats }, (_, place) => place);
  if (you === null) return places;
  const centre = Math.floor(maxSeats / 2);
  return places.map((place) => (place + you - centre + maxSeats) % maxSeats);
}

/**
 * Recul et échelle d'une place sur l'arc.
 *
 * Le siège du milieu est le plus proche du spectateur : il reste en bas et à
 * taille pleine. Plus on s'éloigne du centre, plus le siège remonte vers le
 * croupier et rapetisse. Sans la réduction d'échelle, les sièges du bord
 * paraissent flotter au lieu d'être au fond de la table.
 *
 * Le recul est exprimé en `rem`, **pas** en pourcentage de la hauteur du
 * siège : un siège vide fait le quart de la hauteur d'un siège à deux mains
 * séparées, et un recul proportionnel le laisserait presque sur place. L'arc se
 * tordait alors autour des places libres.
 */
export function arcPose(place: number, maxSeats: number): { y: number; scale: number } {
  const centre = (maxSeats - 1) / 2;
  const ecart = Math.abs(place - centre) / centre;
  return {
    y: Number((ecart * ecart * 3.4).toFixed(2)),
    scale: Number((1 - ecart * 0.16).toFixed(3)),
  };
}

/**
 * Abscisse de départ d'une carte distribuée, en pourcentage de sa largeur.
 *
 * Le sabot est en haut à droite de la table. Une carte destinée au siège de
 * gauche vient donc de bien plus loin qu'une carte destinée au siège de droite.
 */
export function dealOriginX(place: number, maxSeats: number): number {
  return 90 + (maxSeats - 1 - place) * 85;
}
