/**
 * Roue de la fortune — tirage pur.
 *
 * Le barème vit dans `@maxoujeux/shared` ; ici on ne fait que choisir un
 * secteur en respectant ses poids. Aucune entrée/sortie, aucun accès au
 * porte-monnaie : le service API se charge du débit et du versement.
 */

import { WHEEL_SEGMENTS, WHEEL_TOTAL_WEIGHT } from "@maxoujeux/shared";
import type { RandomIndex } from "./blackjack.js";

/**
 * Choisit un secteur.
 *
 * L'aléa est **fourni par l'appelant**, comme pour le sabot du blackjack et la
 * bille de roulette : c'est ce qui permet à un test d'imposer le ×20 sans
 * détourner le hasard global du processus.
 *
 * Le tirage se fait sur les poids, jamais sur les neuf secteurs à égalité : la
 * roue est dessinée en parts égales, mais un ×20 aussi probable qu'un ×1
 * remplirait les porte-monnaie en une semaine.
 *
 * @returns l'index du secteur, qui commande aussi l'angle d'arrêt à l'écran.
 */
export function spinWheel(randomIndex: RandomIndex): number {
  // Un tirage uniforme sur la somme des poids, puis la conversion en secteur :
  // c'est la roulette à secteurs inégaux la plus simple qui soit, et elle ne
  // demande qu'un seul appel à l'aléa.
  let ticket = randomIndex(WHEEL_TOTAL_WEIGHT);
  for (let index = 0; index < WHEEL_SEGMENTS.length; index += 1) {
    const segment = WHEEL_SEGMENTS[index];
    if (!segment) break;
    if (ticket < segment.weight) return index;
    ticket -= segment.weight;
  }
  // Inatteignable tant que `randomIndex` respecte sa borne. Mieux vaut une
  // erreur franche qu'un secteur choisi par défaut, qui fausserait le barème
  // en silence.
  throw new Error("Tirage hors de la roue");
}
