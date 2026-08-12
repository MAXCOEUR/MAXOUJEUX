import type { RouletteView } from "@maxoujeux/shared";
import { create } from "zustand";
import { syncServerClock } from "./clock.js";
import { isNewerRouletteView } from "./roulette-ui.js";
import type { GameSocket } from "./socket-types.js";
import { pushToast } from "./toast.js";

const PENDING_TIMEOUT_MS = 4_000;

interface RouletteStore {
  view: RouletteView | null;
  pending: string | null;
  apply(view: RouletteView): void;
  markPending(intent: string): void;
  clearPending(): void;
  clear(): void;
}

let watchdog: ReturnType<typeof setTimeout> | null = null;
function stopWatchdog(): void {
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
}

export const useRoulette = create<RouletteStore>((set, get) => ({
  view: null,
  pending: null,
  apply: (view) => {
    syncServerClock(view.now);
    if (!isNewerRouletteView(get().view, view)) return;
    stopWatchdog();
    set({ view, pending: null });
  },
  markPending: (intent) => {
    stopWatchdog();
    set({ pending: intent });
    watchdog = setTimeout(() => {
      if (!get().pending) return;
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
    set({ view: null, pending: null });
  },
}));

export function bindRouletteEvents(socket: GameSocket): void {
  socket.on("roulette:state", (view) => useRoulette.getState().apply(view));
}
