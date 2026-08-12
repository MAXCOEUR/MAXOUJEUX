import type { BlackjackView } from "@maxoujeux/shared";
import { create } from "zustand";
import { syncServerClock } from "./clock.js";
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

/**
 * Branche l'état de la table.
 *
 * **Aucune navigation ici.** L'état d'une table de blackjack arrive à chaque
 * carte, à chaque mise et à chaque minuterie : rediriger sur sa réception
 * happait le joueur dès qu'il tentait de partir, même seul à la table, et la
 * page se rouvrait toute seule. Ce n'était pas un garde-fou contre les départs
 * sauvages mais un effet de bord, aux jeux de duel le même gestionnaire ne
 * navigue qu'au **démarrage** d'une partie.
 *
 * Le retour se fait par le bandeau de reprise, et c'est le salon qui navigue
 * après un `tables:join`. Quitter la page ne coupe rien : la place et la mise
 * restent au joueur, exactement comme aux autres jeux.
 */
export function bindBlackjackEvents(socket: GameSocket): void {
  socket.on("blackjack:state", (view) => useBlackjack.getState().apply(view));
}
