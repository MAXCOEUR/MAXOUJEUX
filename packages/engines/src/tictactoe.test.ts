import { describe, expect, it } from "vitest";
import { IllegalMove, type GridState } from "./types.js";
import { TTT_CELLS, tictactoe } from "./tictactoe.js";

/** Joue une suite de cases en alternant, en partant du siège 0. */
function play(cells: number[], from: GridState = tictactoe.create()): GridState {
  let state = from;
  for (const cell of cells) {
    state = tictactoe.reduce(state, { seat: state.turn, value: cell }).state;
  }
  return state;
}

/** Les huit alignements de la grille 3 × 3. */
const LINES: readonly number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

describe("Morpion — grille et coups", () => {
  it("part d'une grille de neuf cases vides où le siège 0 commence", () => {
    const state = tictactoe.create();
    expect(state.cells).toHaveLength(TTT_CELLS);
    expect(state.cells.every((cell) => cell === null)).toBe(true);
    expect(state.turn).toBe(0);
    expect(state.finished).toBe(false);
  });

  it("pose la marque sur la case demandée", () => {
    const state = play([4]);
    expect(state.cells[4]).toBe(0);
    expect(state.turn).toBe(1);
    expect(state.lastMove).toEqual({ index: 4, seat: 0 });
  });

  it("refuse une case déjà prise", () => {
    const state = play([4]);
    try {
      tictactoe.reduce(state, { seat: 1, value: 4 });
      expect.unreachable("la case est occupée");
    } catch (error) {
      expect((error as IllegalMove).code).toBe("CELL_TAKEN");
    }
  });

  it("refuse un coup hors du tour", () => {
    try {
      tictactoe.reduce(tictactoe.create(), { seat: 1, value: 0 });
      expect.unreachable("le siège 0 commence");
    } catch (error) {
      expect((error as IllegalMove).code).toBe("NOT_YOUR_TURN");
    }
  });

  it("refuse une case hors bornes", () => {
    for (const value of [-1, 9, 2.5, Number.NaN]) {
      try {
        tictactoe.reduce(tictactoe.create(), { seat: 0, value });
        expect.unreachable(`la case ${value} aurait dû être refusée`);
      } catch (error) {
        expect((error as IllegalMove).code).toBe("OUT_OF_BOUNDS");
      }
    }
  });

  it("ne mute pas l'état d'entrée", () => {
    const before = tictactoe.create();
    const snapshot = [...before.cells];
    tictactoe.reduce(before, { seat: 0, value: 0 });
    expect(before.cells).toEqual(snapshot);
    expect(before.moves).toBe(0);
  });

  it("liste les cases libres", () => {
    expect(tictactoe.legalMoves(tictactoe.create())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(tictactoe.legalMoves(play([4, 0]))).toEqual([1, 2, 3, 5, 6, 7, 8]);
  });
});

describe("Morpion — victoires", () => {
  it("détecte les huit alignements", () => {
    for (const line of LINES) {
      // Le siège 0 complète la ligne ; le siège 1 occupe des cases hors ligne.
      const filler = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((cell) => !line.includes(cell));
      const sequence: number[] = [];
      for (let i = 0; i < line.length; i += 1) {
        sequence.push(line[i] as number);
        if (i < line.length - 1) sequence.push(filler[i] as number);
      }

      const state = play(sequence);
      expect(state.winner, `alignement ${line.join("-")}`).toBe(0);
      expect(state.finished).toBe(true);
      expect([...(state.winningLine ?? [])].sort()).toEqual([...line].sort());
    }
  });

  it("émet un événement de victoire", () => {
    const before = play([0, 3, 1, 4]);
    const { events } = tictactoe.reduce(before, { seat: 0, value: 2 });
    expect(events).toEqual([
      { type: "moved", seat: 0, index: 2, row: 0, col: 2 },
      { type: "won", seat: 0, line: [0, 1, 2] },
    ]);
  });

  it("refuse tout coup après la fin de la partie", () => {
    const state = play([0, 3, 1, 4, 2]);
    expect(state.finished).toBe(true);
    try {
      tictactoe.reduce(state, { seat: state.turn, value: 8 });
      expect.unreachable("la partie est terminée");
    } catch (error) {
      expect((error as IllegalMove).code).toBe("GAME_OVER");
    }
  });
});

describe("Morpion — égalité", () => {
  /** Siège 0 sur 0-2-3-7-8, siège 1 sur 4-1-5-6, sans alignement intermédiaire. */
  const DRAWN_ORDER = [0, 4, 2, 1, 3, 5, 7, 6, 8];

  it("déclare une égalité après neuf coups sans alignement", () => {
    // Grille nulle classique :  0 | 1 | 0
    //                           0 | 1 | 1
    //                           1 | 0 | 0
    // L'ordre compte autant que le motif : mal ordonné, un joueur aligne avant
    // le neuvième coup et la partie se termine sur une victoire.
    const state = play(DRAWN_ORDER);
    expect(state.moves).toBe(9);
    expect(state.finished).toBe(true);
    expect(state.winner).toBeNull();
    expect(state.winningLine).toBeNull();
    expect(tictactoe.legalMoves(state)).toEqual([]);
  });

  it("émet un événement d'égalité au dernier coup", () => {
    const before = play(DRAWN_ORDER.slice(0, 8));
    expect(before.finished).toBe(false);
    const { events } = tictactoe.reduce(before, { seat: before.turn, value: 8 });
    expect(events.at(-1)).toEqual({ type: "draw" });
  });
});
