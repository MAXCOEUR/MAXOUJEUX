/**
 * Outils de grille partagés par le Puissance 4 et le Morpion.
 *
 * Une seule implémentation de la détection d'alignement pour les deux jeux : la
 * seule différence est la longueur requise (4 ou 3). Deux implémentations
 * auraient fini par diverger sur un cas limite — typiquement l'alignement en
 * diagonale, celui qu'on oublie de tester.
 */

import type { Cell, Seat } from "@maxoujeux/shared";
import type { GridState } from "./types.js";

export function cellIndex(cols: number, row: number, col: number): number {
  return row * cols + col;
}

export function rowOf(cols: number, index: number): number {
  return Math.floor(index / cols);
}

export function colOf(cols: number, index: number): number {
  return index % cols;
}

/** Lecture d'une case avec les bornes vérifiées. Hors grille = vide. */
export function cellAt(state: Pick<GridState, "rows" | "cols" | "cells">, row: number, col: number): Cell {
  if (row < 0 || row >= state.rows || col < 0 || col >= state.cols) return null;
  // `noUncheckedIndexedAccess` rend cet accès `Cell | undefined` : le `?? null`
  // n'est pas décoratif, il est exigé par le compilateur.
  return state.cells[cellIndex(state.cols, row, col)] ?? null;
}

/** Les quatre axes à explorer : horizontal, vertical, et les deux diagonales. */
const DIRECTIONS: readonly [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * Cherche un alignement de `need` cases passant par `index`.
 *
 * On part de la dernière case posée et on étend dans les deux sens sur chaque
 * axe : c'est le seul endroit où un alignement peut être apparu, inutile de
 * balayer les 42 cases à chaque coup.
 *
 * @returns les index alignés, ordonnés du début à la fin du segment, ou `null`.
 */
export function findLine(
  state: Pick<GridState, "rows" | "cols" | "cells">,
  index: number,
  need: number,
): number[] | null {
  const seat = state.cells[index];
  if (seat === null || seat === undefined) return null;

  const row = rowOf(state.cols, index);
  const col = colOf(state.cols, index);

  for (const [dRow, dCol] of DIRECTIONS) {
    const line: number[] = [index];

    // Sens négatif : on empile devant, pour que le segment reste ordonné.
    for (let step = 1; ; step += 1) {
      const r = row - dRow * step;
      const c = col - dCol * step;
      if (cellAt(state, r, c) !== seat) break;
      line.unshift(cellIndex(state.cols, r, c));
    }

    for (let step = 1; ; step += 1) {
      const r = row + dRow * step;
      const c = col + dCol * step;
      if (cellAt(state, r, c) !== seat) break;
      line.push(cellIndex(state.cols, r, c));
    }

    if (line.length >= need) {
      // Un alignement de 5 contient un alignement de 4 : on renvoie le segment
      // complet, c'est celui que le joueur veut voir surligné.
      return line;
    }
  }

  return null;
}

/** Grille vierge. */
export function emptyGrid(rows: number, cols: number): GridState {
  return {
    rows,
    cols,
    cells: Array.from({ length: rows * cols }, () => null),
    turn: 0,
    moves: 0,
    winner: null,
    winningLine: null,
    finished: false,
    lastMove: null,
  };
}

/** Le siège adverse. Deux joueurs seulement au lot 1. */
export function opponent(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}
