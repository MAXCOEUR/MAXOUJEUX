/**
 * Contrat commun des moteurs de jeu.
 *
 * Un moteur est un automate **sans entrée/sortie** : ni socket, ni base, ni
 * horloge. C'est ce qui permet de tester les règles en millisecondes avec
 * Vitest, sans lancer de serveur ni ouvrir trois navigateurs. La couche
 * Socket.IO n'est qu'un transport autour.
 */

import type { Cell, GameCode, Seat } from "@maxoujeux/shared";

/** Un coup joué : le siège qui joue et l'intention, propre au jeu. */
export interface Move {
  seat: Seat;
  /** Colonne pour le Puissance 4, index de case pour le Morpion. */
  value: number;
}

/** État d'un plateau à grille. Commun aux deux jeux du lot 1. */
export interface GridState {
  readonly rows: number;
  readonly cols: number;
  /**
   * Grille aplatie : index = ligne × `cols` + colonne, ligne 0 en haut.
   *
   * Un tableau plat et non un tableau de tableaux : `noUncheckedIndexedAccess`
   * est actif, `grid[r][c]` imposerait deux gardes par lecture. Et un tableau
   * plat sérialise directement en JSON pour le réseau.
   */
  readonly cells: readonly Cell[];
  /** Siège au trait. Le siège 0 commence toujours. */
  readonly turn: Seat;
  /** Nombre de coups joués, pour détecter la grille pleine sans la parcourir. */
  readonly moves: number;
  readonly winner: Seat | null;
  /** Cases alignées, dans l'ordre du balayage. */
  readonly winningLine: readonly number[] | null;
  readonly finished: boolean;
  /** Dernier coup, pour que le front n'anime que celui-là. */
  readonly lastMove: { index: number; seat: Seat } | null;
}

/**
 * Fait de jeu produit par un coup.
 *
 * Ne transite pas sur le réseau — le front rejoue les animations depuis
 * `lastMove` et `winningLine` de l'état. Ces événements servent au serveur :
 * décider du règlement, et journaliser une partie sans réinterpréter la grille.
 */
export type EngineEvent =
  | { type: "moved"; seat: Seat; index: number; row: number; col: number }
  | { type: "won"; seat: Seat; line: number[] }
  | { type: "draw" };

export interface EngineResult {
  state: GridState;
  events: EngineEvent[];
}

export interface Engine {
  readonly code: GameCode;
  readonly rows: number;
  readonly cols: number;
  /** Grille vierge. Le siège 0 joue en premier. */
  create(): GridState;
  /**
   * Applique un coup et renvoie un **nouvel** état.
   * @throws IllegalMove si le coup est refusé — c'est un cas métier, pas un bug.
   */
  reduce(state: GridState, move: Move): EngineResult;
  /**
   * Vue destinée à un joueur.
   *
   * Le Puissance 4 et le Morpion n'ont aucune information cachée : la vue est
   * donc la grille entière. La signature reste celle qu'imposera le poker, pour
   * que la couche transport n'ait pas à changer de forme au lot 4.
   */
  view(state: GridState, seat: Seat | null): GridState;
  /** Coups légaux, pour que le front puisse griser une colonne pleine. */
  legalMoves(state: GridState): number[];
}

export type IllegalMoveCode =
  | "NOT_YOUR_TURN"
  | "OUT_OF_BOUNDS"
  | "COLUMN_FULL"
  | "CELL_TAKEN"
  | "GAME_OVER";

/**
 * Coup refusé par les règles.
 *
 * Volontairement distincte de l'`AppError` de l'API : un moteur n'a pas à
 * connaître les codes HTTP. C'est la couche transport qui traduit.
 */
export class IllegalMove extends Error {
  constructor(readonly code: IllegalMoveCode) {
    super(code);
    this.name = "IllegalMove";
  }
}
