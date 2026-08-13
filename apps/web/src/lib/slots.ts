import type { SlotsTableView } from "@maxoujeux/shared";
import { create } from "zustand";
import { syncServerClock } from "./clock.js";
import type { GameSocket } from "./socket-types.js";
import { pushToast } from "./toast.js";

/**
 * Machine à sous côté client.
 *
 * L'état est celui du serveur, ligne comprise : le navigateur ne tire rien, il
 * rejoue les symboles reçus. C'est ce qui permet à un spectateur de voir les
 * mêmes rouleaux s'arrêter aux mêmes symboles que le joueur.
 */

interface SlotsStore {
  view: SlotsTableView | null;
  /** Tirage en cours d'envoi : le bouton ne doit pas partir deux fois. */
  pending: boolean;
  apply(view: SlotsTableView): void;
  close(tableId: string): void;
  markPending(): void;
  clearPending(): void;
  clear(): void;
}

export const useSlots = create<SlotsStore>((set, get) => ({
  view: null,
  pending: false,

  apply: (view) => {
    // L'horloge serveur fait foi : la position des rouleaux se calcule à partir
    // de `spunAt`, et une horloge locale décalée les arrêterait trop tôt.
    syncServerClock(view.now);
    const courant = get().view;
    if (courant && courant.id === view.id && courant.version > view.version) return;
    set({ view, pending: false });
  },

  close: (tableId) => {
    if (get().view?.id !== tableId) return;
    set({ view: null, pending: false });
    pushToast("info", "La machine a fermé : son propriétaire est parti.");
  },

  markPending: () => set({ pending: true }),
  clearPending: () => set({ pending: false }),
  clear: () => set({ view: null, pending: false }),
}));

export function bindSlotsEvents(socket: GameSocket): void {
  socket.on("slots:state", (view) => useSlots.getState().apply(view));
  socket.on("slots:closed", ({ tableId }) => useSlots.getState().close(tableId));
}
