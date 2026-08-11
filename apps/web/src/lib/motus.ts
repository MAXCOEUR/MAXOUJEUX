/** État Motus autoritaire, partagé par tous les écrans et tous les événements socket. */

import type { MotusView } from "@maxoujeux/shared";
import { create } from "zustand";
import { syncServerClock } from "./clock.js";
import type { GameSocket } from "./socket-types.js";
import { pushToast } from "./toast.js";

export type MotusPending = "start" | "guess" | "abandon";

interface MotusState {
  view: MotusView | null;
  pending: MotusPending | null;
  watchers: number;
  apply: (view: MotusView) => void;
  markPending: (action: MotusPending) => void;
  clearPending: () => void;
  clear: () => void;
}

const PENDING_TIMEOUT_MS = 5_000;
let pendingWatchdog: number | null = null;

function stopWatchdog(): void {
  if (pendingWatchdog !== null) {
    window.clearTimeout(pendingWatchdog);
    pendingWatchdog = null;
  }
}

export const useMotus = create<MotusState>((set, get) => ({
  view: null,
  pending: null,
  watchers: 0,

  apply: (view) => {
    syncServerClock(view.now);
    const current = get().view;
    if (current) {
      const currentSlot = new Date(current.slotStart).getTime();
      const incomingSlot = new Date(view.slotStart).getTime();
      // Une diffusion de l'ancien créneau peut arriver après le démarrage du
      // suivant. Sur un même créneau, seule une version strictement neuve passe.
      if (incomingSlot < currentSlot) return;
      if (incomingSlot === currentSlot && view.version < current.version) return;
      if (
        incomingSlot === currentSlot &&
        view.version === current.version &&
        view.status === current.status &&
        view.guesses.length <= current.guesses.length
      ) return;
    }
    stopWatchdog();
    set({ view, pending: null });
  },

  markPending: (action) => {
    stopWatchdog();
    set({ pending: action });
    pendingWatchdog = window.setTimeout(() => {
      if (get().pending !== action) return;
      set({ pending: null });
      pushToast("erreur", "Action non confirmée par le serveur. Réessaie.");
    }, PENDING_TIMEOUT_MS);
  },

  clearPending: () => {
    stopWatchdog();
    set({ pending: null });
  },

  clear: () => {
    stopWatchdog();
    set({ view: null, pending: null, watchers: 0 });
  },
}));

export function retainMotusWatcher(): boolean {
  const current = useMotus.getState().watchers;
  useMotus.setState({ watchers: current + 1 });
  return current === 0;
}

export function releaseMotusWatcher(): boolean {
  const current = useMotus.getState().watchers;
  const next = Math.max(0, current - 1);
  useMotus.setState({ watchers: next });
  return current > 0 && next === 0;
}

export function isWatchingMotus(): boolean {
  return useMotus.getState().watchers > 0;
}

/** Branché une seule fois pour ne jamais doubler les mises à jour en StrictMode. */
export function bindMotusEvents(socket: GameSocket): void {
  socket.on("motus:state", (view) => useMotus.getState().apply(view));
}
