import type { Seat } from "@maxoujeux/shared";
import { describe, expect, it } from "vitest";
import { C4_COLS, C4_ROWS, connect4, dropRow } from "./connect4.js";
import { cellIndex, findLine } from "./grid.js";
import { IllegalMove, type GridState } from "./types.js";

/** Joue une suite de colonnes en alternant les sièges, en partant du siège 0. */
function play(columns: number[], from: GridState = connect4.create()): GridState {
  let state = from;
  for (const col of columns) {
    state = connect4.reduce(state, { seat: state.turn, value: col }).state;
  }
  return state;
}

function at(state: GridState, row: number, col: number): Seat | null {
  return state.cells[cellIndex(C4_COLS, row, col)] ?? null;
}

describe("Puissance 4 — grille et coups", () => {
  it("part d'une grille vide où le siège 0 commence", () => {
    const state = connect4.create();
    expect(state.rows).toBe(6);
    expect(state.cols).toBe(7);
    expect(state.cells).toHaveLength(42);
    expect(state.cells.every((cell) => cell === null)).toBe(true);
    expect(state.turn).toBe(0);
    expect(state.finished).toBe(false);
    expect(state.lastMove).toBeNull();
  });

  it("fait tomber le disque sur la première case libre en bas", () => {
    const state = play([3]);
    expect(at(state, C4_ROWS - 1, 3)).toBe(0);
    expect(at(state, C4_ROWS - 2, 3)).toBeNull();
    expect(state.lastMove).toEqual({ index: cellIndex(C4_COLS, 5, 3), seat: 0 });
  });

  it("empile les disques dans l'ordre", () => {
    const state = play([3, 3, 3]);
    expect(at(state, 5, 3)).toBe(0);
    expect(at(state, 4, 3)).toBe(1);
    expect(at(state, 3, 3)).toBe(0);
    expect(state.moves).toBe(3);
  });

  it("passe le trait à l'adversaire après chaque coup", () => {
    expect(play([0]).turn).toBe(1);
    expect(play([0, 1]).turn).toBe(0);
  });

  it("refuse une colonne pleine", () => {
    const state = play([2, 2, 2, 2, 2, 2]);
    expect(dropRow(state.cells, 2)).toBeNull();
    expect(() => connect4.reduce(state, { seat: state.turn, value: 2 })).toThrow(IllegalMove);
    try {
      connect4.reduce(state, { seat: state.turn, value: 2 });
    } catch (error) {
      expect((error as IllegalMove).code).toBe("COLUMN_FULL");
    }
  });

  it("refuse un coup hors du tour", () => {
    const state = connect4.create();
    try {
      connect4.reduce(state, { seat: 1, value: 0 });
      expect.unreachable("le coup aurait dû être refusé");
    } catch (error) {
      expect((error as IllegalMove).code).toBe("NOT_YOUR_TURN");
    }
  });

  it("refuse une colonne hors bornes", () => {
    const state = connect4.create();
    for (const value of [-1, 7, 42, 1.5, Number.NaN]) {
      try {
        connect4.reduce(state, { seat: 0, value });
        expect.unreachable(`la colonne ${value} aurait dû être refusée`);
      } catch (error) {
        expect((error as IllegalMove).code).toBe("OUT_OF_BOUNDS");
      }
    }
  });

  it("ne mute pas l'état d'entrée", () => {
    const before = connect4.create();
    const snapshot = [...before.cells];
    connect4.reduce(before, { seat: 0, value: 4 });
    expect(before.cells).toEqual(snapshot);
    expect(before.moves).toBe(0);
    expect(before.turn).toBe(0);
  });

  it("liste les coups légaux et les vide en fin de partie", () => {
    expect(connect4.legalMoves(connect4.create())).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const columnFull = play([0, 0, 0, 0, 0, 0]);
    expect(connect4.legalMoves(columnFull)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("Puissance 4 — victoires", () => {
  it("détecte un alignement horizontal", () => {
    // Siège 0 en 0,1,2,3 sur la ligne du bas ; siège 1 empile en colonne 6.
    const state = play([0, 6, 1, 6, 2, 6, 3]);
    expect(state.winner).toBe(0);
    expect(state.finished).toBe(true);
    expect(state.winningLine).toEqual([
      cellIndex(C4_COLS, 5, 0),
      cellIndex(C4_COLS, 5, 1),
      cellIndex(C4_COLS, 5, 2),
      cellIndex(C4_COLS, 5, 3),
    ]);
  });

  it("détecte un alignement vertical", () => {
    const state = play([1, 2, 1, 2, 1, 2, 1]);
    expect(state.winner).toBe(0);
    expect(state.winningLine).toEqual([
      cellIndex(C4_COLS, 2, 1),
      cellIndex(C4_COLS, 3, 1),
      cellIndex(C4_COLS, 4, 1),
      cellIndex(C4_COLS, 5, 1),
    ]);
  });

  it("détecte une diagonale montante", () => {
    // Escalier : (5,0) (4,1) (3,2) (2,3) pour le siège 0.
    const state = play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
    expect(state.winner).toBe(0);
    expect(state.winningLine).toEqual([
      cellIndex(C4_COLS, 2, 3),
      cellIndex(C4_COLS, 3, 2),
      cellIndex(C4_COLS, 4, 1),
      cellIndex(C4_COLS, 5, 0),
    ]);
  });

  it("détecte une diagonale descendante", () => {
    // Miroir du cas précédent : (2,3) (3,4) (4,5) (5,6).
    const state = play([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
    expect(state.winner).toBe(0);
    expect(state.winningLine).toHaveLength(4);
    expect(state.winningLine).toContain(cellIndex(C4_COLS, 5, 6));
    expect(state.winningLine).toContain(cellIndex(C4_COLS, 2, 3));
  });

  it("renvoie le segment complet quand cinq disques sont alignés", () => {
    // Le joueur complète 0,1,2,3,4 : c'est le segment de 5 qu'il faut surligner,
    // pas un sous-ensemble arbitraire de 4.
    const state = play([0, 0, 1, 1, 2, 2, 4, 4, 3]);
    expect(state.winner).toBe(0);
    expect(state.winningLine).toHaveLength(5);
  });

  it("émet un événement de victoire avec la ligne", () => {
    const before = play([0, 6, 1, 6, 2, 6]);
    const { events } = connect4.reduce(before, { seat: before.turn, value: 3 });
    expect(events[0]).toMatchObject({ type: "moved", seat: 0 });
    expect(events[1]).toMatchObject({ type: "won", seat: 0 });
  });

  it("refuse tout coup après la fin de la partie", () => {
    const state = play([0, 6, 1, 6, 2, 6, 3]);
    try {
      connect4.reduce(state, { seat: state.turn, value: 5 });
      expect.unreachable("la partie est terminée");
    } catch (error) {
      expect((error as IllegalMove).code).toBe("GAME_OVER");
    }
    expect(connect4.legalMoves(state)).toEqual([]);
  });
});

describe("Puissance 4 — égalité", () => {
  /**
   * Motif de grille nulle.
   *
   * Chaque ligne alterne par colonne (aucune horizontale possible) et les
   * lignes suivent la séquence `g` ci-dessous, choisie pour qu'aucune verticale
   * ni diagonale n'atteigne quatre : les runs verticaux plafonnent à 2 et les
   * diagonaux à 3. `g[i] = true` place le siège 1 sur les colonnes paires.
   *
   * L'état est monté directement plutôt que joué en 41 coups : ce qu'on teste
   * ici est la branche « grille pleine », pas la mécanique de chute déjà
   * couverte plus haut.
   */
  const G = [true, true, false, false, true, false] as const;

  function drawnCells(): (Seat | null)[] {
    const cells: (Seat | null)[] = [];
    for (let row = 0; row < C4_ROWS; row += 1) {
      for (let col = 0; col < C4_COLS; col += 1) {
        const even = col % 2 === 0;
        // Le siège 0 joue en premier, il doit donc avoir 21 disques posés sur
        // les 41 précédents : c'est lui qui reçoit la case majoritaire.
        cells.push(G[row] ? (even ? 1 : 0) : even ? 0 : 1);
      }
    }
    return cells;
  }

  it("déclare une égalité quand la dernière case est posée sans alignement", () => {
    const cells = drawnCells();
    // La case libre est forcément en haut d'une colonne : les disques tombent.
    cells[cellIndex(C4_COLS, 0, 0)] = null;

    const almostFull: GridState = {
      rows: C4_ROWS,
      cols: C4_COLS,
      cells,
      turn: 1,
      moves: 41,
      winner: null,
      winningLine: null,
      finished: false,
      lastMove: null,
    };

    const { state, events } = connect4.reduce(almostFull, { seat: 1, value: 0 });

    expect(state.finished).toBe(true);
    expect(state.winner).toBeNull();
    expect(state.winningLine).toBeNull();
    expect(state.moves).toBe(42);
    expect(events).toEqual([
      { type: "moved", seat: 1, index: cellIndex(C4_COLS, 0, 0), row: 0, col: 0 },
      { type: "draw" },
    ]);
  });

  it("ne contient réellement aucun alignement, vérifié case par case", () => {
    // Le moteur ne cherche un alignement qu'autour du dernier coup. Sans ce
    // contrôle exhaustif, un motif truqué ferait passer le test précédent
    // alors que la grille contient une victoire ailleurs.
    const cells = drawnCells();
    const board = { rows: C4_ROWS, cols: C4_COLS, cells };
    for (let index = 0; index < cells.length; index += 1) {
      expect(findLine(board, index, 4)).toBeNull();
    }
  });

  it("refuse tout coup sur une grille pleine", () => {
    const full: GridState = {
      rows: C4_ROWS,
      cols: C4_COLS,
      cells: drawnCells(),
      turn: 0,
      moves: 42,
      winner: null,
      winningLine: null,
      finished: true,
      lastMove: null,
    };
    expect(connect4.legalMoves(full)).toEqual([]);
    try {
      connect4.reduce(full, { seat: 0, value: 3 });
      expect.unreachable("la grille est pleine");
    } catch (error) {
      expect((error as IllegalMove).code).toBe("GAME_OVER");
    }
  });
});
