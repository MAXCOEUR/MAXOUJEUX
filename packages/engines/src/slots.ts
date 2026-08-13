/**
 * Machine à sous — tirage pur.
 *
 * Le barème et l'évaluation de la ligne vivent dans `@maxoujeux/shared` ; ici on
 * ne fait que tourner les rouleaux. Aucune entrée/sortie, aucun accès au
 * porte-monnaie : le service API se charge du débit et du versement.
 */

import {
  SLOTS_REELS,
  SLOTS_REEL_WEIGHT,
  SLOT_SYMBOLS,
  slotsOutcome,
  type SlotsOutcome,
} from "@maxoujeux/shared";
import type { RandomIndex } from "./blackjack.js";

export interface SlotsSpin {
  /** Les trois symboles, de gauche à droite. */
  reels: number[];
  outcome: SlotsOutcome;
}

/**
 * Arrête un rouleau sur un symbole.
 *
 * Le tirage se fait sur les poids, jamais sur les six symboles à égalité : un
 * MAXOU aussi probable qu'une cerise sortirait en triple une fois sur 216, et
 * la machine rendrait sept fois la mise au lieu de neuf dixièmes.
 */
function spinReel(randomIndex: RandomIndex): number {
  let ticket = randomIndex(SLOTS_REEL_WEIGHT);
  for (let index = 0; index < SLOT_SYMBOLS.length; index += 1) {
    const symbol = SLOT_SYMBOLS[index];
    if (!symbol) break;
    if (ticket < symbol.weight) return index;
    ticket -= symbol.weight;
  }
  // Inatteignable tant que `randomIndex` respecte sa borne. Mieux vaut une
  // erreur franche qu'un symbole choisi par défaut, qui fausserait le barème
  // en silence.
  throw new Error("Tirage hors du rouleau");
}

/**
 * Lance les trois rouleaux.
 *
 * L'aléa est **fourni par l'appelant**, comme pour le sabot du blackjack, la
 * bille de roulette et la roue : c'est ce qui permet à un test d'imposer un
 * MAXOU triple sans détourner le hasard global du processus.
 *
 * Les rouleaux sont **indépendants** : c'est ce qui rend le jackpot rare. Une
 * machine qui tirerait une ligne parmi une liste prédéfinie serait plus simple
 * à truquer qu'à équilibrer.
 */
export function spinSlots(randomIndex: RandomIndex): SlotsSpin {
  const reels: number[] = [];
  for (let reel = 0; reel < SLOTS_REELS; reel += 1) {
    reels.push(spinReel(randomIndex));
  }
  return { reels, outcome: slotsOutcome(reels) };
}
