import type { BlackjackView } from "@maxoujeux/shared";
import { create } from "zustand";
import { syncServerClock } from "./clock.js";
import { navigate, useRouteStore } from "./route.js";
import type { GameSocket } from "./socket-types.js";
import { pushToast } from "./toast.js";
import { isNewerBlackjackView } from "./blackjack-state.js";

const PENDING_TIMEOUT_MS = 4_000;

interface BlackjackStore {
  view: BlackjackView | null;
  pending: string | null;
  apply(view: BlackjackView): void;
  markPending(intent: string): void;
  clearPending(): void;
  clear(): void;
}

let watchdog: ReturnType<typeof setTimeout> | null = null;
function stopWatchdog(): void {
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
}

export const useBlackjack = create<BlackjackStore>((set, get) => ({
  view: null,
  pending: null,
  apply: (view) => {
    syncServerClock(view.now);
    if (!isNewerBlackjackView(get().view, view)) return;
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

export function bindBlackjackEvents(socket: GameSocket): void {
  socket.on("blackjack:state", (view) => {
    useBlackjack.getState().apply(view);
    const route = useRouteStore.getState().route;
    if (!(route.name === "table" && route.tableId === view.id)) {
      navigate({ name: "table", tableId: view.id });
    }
  });
}
