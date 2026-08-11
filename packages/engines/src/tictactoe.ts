/**
 * Morpion — grille de 3 × 3, trois cases alignées.
 *
 * Le coup se désigne par un **index de case** (0 en haut à gauche, 8 en bas à
 * droite), contrairement au Puissance 4 où c'est une colonne.
 */

import type { Seat } from "@maxoujeux/shared";
import { emptyGrid, findLine, opponent } from "./grid.js";
import { IllegalMove, type Engine, type EngineEvent, type EngineResult, type GridState, type Move } from "./types.js";

export const TTT_ROWS = 3;
export const TTT_COLS = 3;
export const TTT_NEED = 3;
export const TTT_CELLS = TTT_ROWS * TTT_COLS;

export const tictactoe: Engine = {
  code: "tictactoe",
  rows: TTT_ROWS,
  cols: TTT_COLS,

  create(): GridState {
    return emptyGrid(TTT_ROWS, TTT_COLS);
  },

  reduce(state: GridState, move: Move): EngineResult {
    if (state.finished) throw new IllegalMove("GAME_OVER");
    if (move.seat !== state.turn) throw new IllegalMove("NOT_YOUR_TURN");
    if (!Number.isInteger(move.value) || move.value < 0 || move.value >= TTT_CELLS) {
      throw new IllegalMove("OUT_OF_BOUNDS");
    }
    if ((state.cells[move.value] ?? null) !== null) throw new IllegalMove("CELL_TAKEN");

    const index = move.value;
    const cells = [...state.cells];
    cells[index] = move.seat;

    const row = Math.floor(index / TTT_COLS);
    const col = index % TTT_COLS;

    const events: EngineEvent[] = [{ type: "moved", seat: move.seat, index, row, col }];

    const line = findLine({ rows: TTT_ROWS, cols: TTT_COLS, cells }, index, TTT_NEED);
    const moves = state.moves + 1;
    const full = moves >= TTT_CELLS;

    if (line) events.push({ type: "won", seat: move.seat, line });
    else if (full) events.push({ type: "draw" });

    return {
      state: {
        rows: TTT_ROWS,
        cols: TTT_COLS,
        cells,
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

  // Aucune information cachée au Morpion : la vue est l'état.
  view(state: GridState, _seat: Seat | null): GridState {
    return state;
  },

  legalMoves(state: GridState): number[] {
    if (state.finished) return [];
    const moves: number[] = [];
    for (let index = 0; index < TTT_CELLS; index += 1) {
      if ((state.cells[index] ?? null) === null) moves.push(index);
    }
    return moves;
  },
};
