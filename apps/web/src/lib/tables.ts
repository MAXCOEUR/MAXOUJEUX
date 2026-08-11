/**
 * Salons de tables — état alimenté par la socket.
 *
 * Ce module **n'importe pas** `socket.ts` : il expose la fonction
 * d'enregistrement des gestionnaires, que `connect()` appelle. Le sens unique
 * évite un cycle d'imports ESM, et les émissions passent par le helper `emit`
 * de `socket.ts`.
 */

import type { GameCode, SalonSnapshot, TableCounts } from "@maxoujeux/shared";
import { create } from "zustand";
import { syncServerClock } from "./clock.js";

interface TablesState {
  /** Dernier instantané reçu, par jeu. */
  salons: Partial<Record<GameCode, SalonSnapshot>>;
  /** Comptages du lobby, tous jeux confondus. */
  counts: Partial<Record<GameCode, TableCounts>>;
  /**
   * Nombre d'écrans abonnés à chaque salon.
   *
   * `StrictMode` monte les effets deux fois : sans ce comptage, le démontage du
   * premier montage se désabonnerait alors que le second est toujours actif, et
   * la liste cesserait de se mettre à jour.
   */
  watchers: Partial<Record<GameCode, number>>;
  apply: (snapshot: SalonSnapshot) => void;
  setCounts: (counts: Partial<Record<GameCode, TableCounts>>) => void;
  clear: () => void;
}

export const useTables = create<TablesState>((set) => ({
  salons: {},
  counts: {},
  watchers: {},

  apply: (snapshot) => {
    syncServerClock(snapshot.now);
    set((state) => ({ salons: { ...state.salons, [snapshot.game]: snapshot } }));
  },

  setCounts: (counts) => set({ counts }),

  clear: () => set({ salons: {}, counts: {}, watchers: {} }),
}));

/**
 * @returns true si c'est le premier abonné — l'appelant doit alors émettre
 * `tables:watch` au serveur.
 */
export function retainWatcher(game: GameCode): boolean {
  const current = useTables.getState().watchers[game] ?? 0;
  useTables.setState((state) => ({ watchers: { ...state.watchers, [game]: current + 1 } }));
  return current === 0;
}

/** @returns true si c'était le dernier abonné — émettre alors `tables:unwatch`. */
export function releaseWatcher(game: GameCode): boolean {
  const current = useTables.getState().watchers[game] ?? 0;
  const next = Math.max(0, current - 1);
  useTables.setState((state) => ({ watchers: { ...state.watchers, [game]: next } }));
  return current > 0 && next === 0;
}

/** Salons à réabonner après une reconnexion : les rooms serveur sont perdues. */
export function watchedGames(): GameCode[] {
  const { watchers } = useTables.getState();
  return (Object.keys(watchers) as GameCode[]).filter((game) => (watchers[game] ?? 0) > 0);
}
