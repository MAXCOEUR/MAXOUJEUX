/**
 * Plinko — chute pure.
 *
 * La bille prend douze décisions indépendantes à pile ou face. Le trajet est
 * conservé et renvoyé : l'animation du front le rejoue au lieu d'inventer un
 * chemin qui, à l'arrivée, ne tomberait pas dans la bonne fente.
 */

import {
  PLINKO_ROWS,
  plinkoMultiplier,
  plinkoRightChance,
  type PlinkoRisk,
  type PlinkoStep,
} from "@maxoujeux/shared";
import type { RandomIndex } from "./blackjack.js";

export interface PlinkoDrop {
  path: PlinkoStep[];
  slot: number;
  multiplierTenths: number;
}

/**
 * Lâche la bille.
 *
 * L'aléa est fourni par l'appelant, comme pour la roue et le sabot.
 *
 * La fente est le **nombre de rebonds vers la droite** : douze pile à gauche
 * donnent la fente 0, douze face à droite la fente 12. Un tirage uniforme sur
 * treize fentes rendrait les bords aussi fréquents que le centre et ferait
 * exploser le barème du risque élevé.
 */
export function dropPlinkoBall(randomIndex: RandomIndex, risk: PlinkoRisk): PlinkoDrop {
  const path: PlinkoStep[] = [];
  let slot = 0;

  for (let row = 0; row < PLINKO_ROWS; row += 1) {
    // Le rebond n'est pas un pile ou face équilibré : la bille est poussée vers
    // l'extérieur à proportion de l'écart déjà pris. C'est ce qui dégarnit le
    // centre sans jamais favoriser un côté — voir `PLINKO_SPREAD`.
    const chance = plinkoRightChance(row, slot);
    // `randomIndex` rend un entier : on tire sur dix mille pour disposer d'une
    // précision suffisante sur une probabilité fractionnaire.
    const right = randomIndex(10_000) < Math.round(chance * 10_000);
    path.push(right ? "right" : "left");
    if (right) slot += 1;
  }

  return { path, slot, multiplierTenths: plinkoMultiplier(risk, slot) };
}

/** Fente d'arrivée d'un trajet donné. Sert à vérifier un trajet reçu. */
export function plinkoSlotOf(path: readonly PlinkoStep[]): number {
  return path.reduce((total, step) => total + (step === "right" ? 1 : 0), 0);
}
