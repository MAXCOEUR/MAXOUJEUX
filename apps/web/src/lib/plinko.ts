import type { PlinkoTableView } from "@maxoujeux/shared";
import { create } from "zustand";
import { syncServerClock } from "./clock.js";
import type { GameSocket } from "./socket-types.js";
import { pushToast } from "./toast.js";

/**
 * Table de Plinko côté client.
 *
 * L'état est celui du serveur, billes comprises : le navigateur ne décide de
 * rien, il rejoue les trajets reçus. C'est ce qui permet à un spectateur de voir
 * exactement la même chute que le joueur.
 *
 * Pas de garde anti-régression sur la version comme à la roulette : les billes
 * arrivent vite et une table qui saute un état affiche simplement une bille
 * de moins pendant 120 ms, là où un état de roulette périmé afficherait une
 * mauvaise phase de mise.
 */

interface PlinkoStore {
  view: PlinkoTableView | null;
  /** Bille en cours d'envoi : le bouton ne doit pas partir deux fois. */
  pending: boolean;
  apply(view: PlinkoTableView): void;
  close(tableId: string): void;
  markPending(): void;
  clearPending(): void;
  clear(): void;
}

export const usePlinko = create<PlinkoStore>((set, get) => ({
  view: null,
  pending: false,

  apply: (view) => {
    // L'horloge serveur fait foi : la position d'une bille se calcule à partir
    // de son `droppedAt`, et une horloge locale décalée la ferait apparaître
    // déjà retombée.
    syncServerClock(view.now);
    if (get().view && get().view?.id === view.id && get().view!.version > view.version) return;
    set({ view, pending: false });
  },

  close: (tableId) => {
    if (get().view?.id !== tableId) return;
    set({ view: null, pending: false });
    pushToast("info", "La table a fermé : son propriétaire est parti.");
  },

  markPending: () => set({ pending: true }),
  clearPending: () => set({ pending: false }),
  clear: () => set({ view: null, pending: false }),
}));

export function bindPlinkoEvents(socket: GameSocket): void {
  socket.on("plinko:state", (view) => usePlinko.getState().apply(view));
  socket.on("plinko:closed", ({ tableId }) => usePlinko.getState().close(tableId));
}
