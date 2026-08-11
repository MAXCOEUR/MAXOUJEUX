/**
 * Puissance 4 — grille de 7 colonnes sur 6 lignes, quatre disques alignés.
 *
 * Le coup se désigne par une **colonne**, pas par une case : c'est la carte
 * mentale du jeu, et c'est aussi ce qui rend l'interface accessible (7 boutons
 * de colonne au clavier plutôt que 42 cases à parcourir aux flèches).
 */

import type { Cell, Seat } from "@maxoujeux/shared";
import { cellIndex, colOf, emptyGrid, findLine, opponent, rowOf } from "./grid.js";
import { IllegalMove, type Engine, type EngineEvent, type EngineResult, type GridState, type Move } from "./types.js";

export const C4_ROWS = 6;
export const C4_COLS = 7;
export const C4_NEED = 4;

/**
 * Ligne où tomberait un disque dans cette colonne, ou `null` si elle est pleine.
 *
 * Exporté parce que le front s'en sert pour l'aperçu au survol et pour griser
 * une colonne pleine : aucune règle de jeu ne doit être réécrite dans un
 * composant React.
 */
export function dropRow(cells: readonly Cell[], col: number): number | null {
  if (col < 0 || col >= C4_COLS) return null;
  // On part du bas : le premier emplacement libre rencontré est le bon.
  for (let row = C4_ROWS - 1; row >= 0; row -= 1) {
    if ((cells[cellIndex(C4_COLS, row, col)] ?? null) === null) return row;
  }
  return null;
}

export const connect4: Engine = {
  code: "connect4",
  rows: C4_ROWS,
  cols: C4_COLS,

  create(): GridState {
    return emptyGrid(C4_ROWS, C4_COLS);
  },

  reduce(state: GridState, move: Move): EngineResult {
    if (state.finished) throw new IllegalMove("GAME_OVER");
    if (move.seat !== state.turn) throw new IllegalMove("NOT_YOUR_TURN");
    if (!Number.isInteger(move.value) || move.value < 0 || move.value >= C4_COLS) {
      throw new IllegalMove("OUT_OF_BOUNDS");
    }

    const row = dropRow(state.cells, move.value);
    if (row === null) throw new IllegalMove("COLUMN_FULL");

    const index = cellIndex(C4_COLS, row, move.value);
    const cells = [...state.cells];
    cells[index] = move.seat;

    const events: EngineEvent[] = [
      { type: "moved", seat: move.seat, index, row, col: move.value },
    ];

    const line = findLine({ rows: C4_ROWS, cols: C4_COLS, cells }, index, C4_NEED);
    const moves = state.moves + 1;
    const full = moves >= C4_ROWS * C4_COLS;

    if (line) events.push({ type: "won", seat: move.seat, line });
    else if (full) events.push({ type: "draw" });

    return {
      state: {
        rows: C4_ROWS,
        cols: C4_COLS,
        cells,
        // Le trait passe à l'adversaire même sur le coup gagnant : `finished`
        // interdit déjà tout coup, et un `turn` figé simplifie l'affichage.
        turn: opponent(move.seat),
        moves,
        winner: line ? move.seat : null,
        winningLine: line,
        finished: line !== null || full,
        lastMove: { index, seat: move.seat },
      },
      events,
    };
  },

  // Aucune information cachée au Puissance 4 : la vue est l'état.
  view(state: GridState, _seat: Seat | null): GridState {
    return state;
  },

  legalMoves(state: GridState): number[] {
    if (state.finished) return [];
    const moves: number[] = [];
    for (let col = 0; col < C4_COLS; col += 1) {
      if (dropRow(state.cells, col) !== null) moves.push(col);
    }
    return moves;
  },
};

/** Colonne correspondant à une case, pour retrouver un coup depuis un index. */
export function columnOfIndex(index: number): number {
  return colOf(C4_COLS, index);
}

/** Ligne correspondant à une case. */
export function rowOfIndex(index: number): number {
  return rowOf(C4_COLS, index);
}
