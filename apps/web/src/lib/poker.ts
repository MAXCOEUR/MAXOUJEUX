import type { PokerView } from "@maxoujeux/shared";
import { create } from "zustand";
import { syncServerClock } from "./clock.js";
import type { GameSocket } from "./socket-types.js";
import { pushToast } from "./toast.js";

/**
 * Table de poker côté client.
 *
 * L'état arrive **filtré par destinataire** : les cartes des adversaires n'y
 * figurent tout simplement pas. Le front ne masque rien, il affiche ce qu'il
 * reçoit — c'est la seule protection anti-triche qui tienne.
 */

const PENDING_TIMEOUT_MS = 4_000;

interface PokerStore {
  view: PokerView | null;
  /** Intention en vol : le bouton ne doit pas partir deux fois. */
  pending: string | null;
  apply(view: PokerView): void;
  markPending(intent: string): void;
  clearPending(): void;
  clear(): void;
}

let watchdog: ReturnType<typeof setTimeout> | null = null;
function stopWatchdog(): void {
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
}

export const usePoker = create<PokerStore>((set, get) => ({
  view: null,
  pending: null,

  apply: (view) => {
    // L'horloge serveur d'abord : le compte à rebours du tour se calcule
    // dessus, jamais sur celle du poste.
    syncServerClock(view.now);
    const courant = get().view;
    // Deux états peuvent se croiser après une reconnexion : on ne revient
    // jamais en arrière sur une même table.
    if (courant && courant.id === view.id && courant.version > view.version) return;
    stopWatchdog();
    set({ view, pending: null });
  },

  markPending: (intent) => {
    stopWatchdog();
    set({ pending: intent });
    // Si un accusé se perd, l'écran ne doit pas rester figé.
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

export function bindPokerEvents(socket: GameSocket): void {
  socket.on("poker:state", (view) => usePoker.getState().apply(view));
}
