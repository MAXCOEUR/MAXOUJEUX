/**
 * Roulette européenne — règles pures.
 *
 * Aucune entrée/sortie, aucune socket, aucune base : la totalité des règles se
 * teste en millisecondes, sans lancer de serveur. La couche temps réel n'est
 * qu'un transport autour.
 *
 * Roulette **européenne**, à un seul zéro. Ni « la partage » ni « en prison » :
 * ces règles n'existent qu'aux tables françaises, elles doubleraient le nombre
 * de cas à couvrir pour un gain de réalisme que personne ne réclame. Ici le
 * zéro fait tout perdre, sauf un plein posé sur le zéro.
 */

import {
  ROULETTE_ODDS,
  rouletteReturn,
  type RouletteSpot,
  type RouletteSpotKind,
} from "@maxoujeux/shared";
import type { RandomIndex } from "./blackjack.js";

/**
 * Ordre réel des cases sur le cylindre européen, dans le sens horaire.
 *
 * Ce n'est **pas** 0..36 : les numéros sont dispersés pour que les rouges et
 * les noirs alternent et que les hauts et les bas s'équilibrent sur chaque
 * moitié. L'ordre ne change rien aux probabilités, mais il détermine où la
 * bille s'immobilise à l'écran — une roue rangée dans l'ordre croissant se
 * reconnaît au premier coup d'œil comme fausse.
 */
export const ROULETTE_WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
  10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

export const ROULETTE_POCKETS = ROULETTE_WHEEL.length;

/** Les dix-huit numéros rouges. Les autres sont noirs, hormis le zéro. */
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type RouletteColor = "red" | "black" | "green";

export function rouletteColor(value: number): RouletteColor {
  if (value === 0) return "green";
  return RED.has(value) ? "red" : "black";
}

/** Position d'un numéro sur le cylindre, pour savoir où arrêter la bille. */
export function pocketIndex(value: number): number {
  const index = ROULETTE_WHEEL.indexOf(value as (typeof ROULETTE_WHEEL)[number]);
  if (index < 0) throw new Error(`Numéro hors du cylindre : ${value}`);
  return index;
}

/** Colonne d'un numéro, de 1 à 3. Le zéro n'appartient à aucune. */
function columnOf(value: number): 1 | 2 | 3 | 0 {
  if (value === 0) return 0;
  const rest = value % 3;
  return rest === 0 ? 3 : (rest as 1 | 2);
}

/** Douzaine d'un numéro, de 1 à 3. Le zéro n'appartient à aucune. */
function dozenOf(value: number): 1 | 2 | 3 | 0 {
  if (value === 0) return 0;
  return (Math.floor((value - 1) / 12) + 1) as 1 | 2 | 3;
}

/**
 * La case couvre-t-elle le numéro sorti ?
 *
 * Le zéro est traité en premier et sans exception : c'est l'avantage de la
 * maison, et le laisser passer sur « pair » ou sur « manque » — deux erreurs
 * classiques, puisque 0 est pair et inférieur à 18 — supprimerait purement et
 * simplement cet avantage.
 */
export function covers(spot: RouletteSpot, result: number): boolean {
  if (spot.kind === "straight") return spot.number === result;
  if (result === 0) return false;

  switch (spot.kind) {
    case "red":
      return rouletteColor(result) === "red";
    case "black":
      return rouletteColor(result) === "black";
    case "even":
      return result % 2 === 0;
    case "odd":
      return result % 2 === 1;
    case "low":
      return result >= 1 && result <= 18;
    case "high":
      return result >= 19 && result <= 36;
    case "dozen1":
      return dozenOf(result) === 1;
    case "dozen2":
      return dozenOf(result) === 2;
    case "dozen3":
      return dozenOf(result) === 3;
    case "column1":
      return columnOf(result) === 1;
    case "column2":
      return columnOf(result) === 2;
    case "column3":
      return columnOf(result) === 3;
  }
}

/**
 * Total rendu au joueur pour une case, mise comprise.
 *
 * Même convention que `blackjackPayout` : c'est un **versement**, pas un gain
 * net. Une case perdante rend zéro, la mise ayant déjà été débitée à la
 * confirmation.
 */
export function roulettePayout(spot: RouletteSpot, amount: number, result: number): number {
  return covers(spot, result) ? rouletteReturn(spot.kind, amount) : 0;
}

/** Rapport d'une case, repris du barème partagé. */
export function rouletteOdds(kind: RouletteSpotKind): number {
  return ROULETTE_ODDS[kind];
}

/**
 * Lance la bille.
 *
 * L'aléa est **fourni par l'appelant**, comme pour `createShoe` : c'est ce qui
 * permet de rejouer un règlement avec un numéro imposé dans un test, sans
 * détourner le hasard global du processus.
 */
export function spinRoulette(randomIndex: RandomIndex): number {
  const index = randomIndex(ROULETTE_POCKETS);
  const pocket = ROULETTE_WHEEL[index];
  if (pocket === undefined) throw new Error("Tirage hors du cylindre");
  return pocket;
}
