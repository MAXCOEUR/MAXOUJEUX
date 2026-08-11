/**
 * Moteurs de jeu — règles pures, sans entrée/sortie.
 *
 * Consommés par l'API (qui les fait tourner) **et** par le front (qui y lit les
 * coups légaux pour son affichage). Aucune règle de jeu ne doit être réécrite
 * dans un composant React ni dans un gestionnaire de socket.
 */

export * from "./types.js";
export * from "./grid.js";
export * from "./connect4.js";
export * from "./blackjack.js";
export * from "./motus.js";
export * from "./tictactoe.js";

import type { DuelGame } from "@maxoujeux/shared";
import { connect4 } from "./connect4.js";
import { tictactoe } from "./tictactoe.js";
import type { Engine } from "./types.js";

/** Moteur d'un jeu de duel. Le catalogue reste dans `@maxoujeux/shared`. */
export const ENGINES: Record<DuelGame, Engine> = {
  connect4,
  tictactoe,
};

export function getEngine(game: DuelGame): Engine {
  return ENGINES[game];
}
