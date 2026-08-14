import type { WheelView } from "@maxoujeux/shared";
import { create } from "zustand";
import { syncServerClock } from "./clock.js";
import type { GameSocket } from "./socket-types.js";

/**
 * La salle de la roue, côté client.
 *
 * L'état arrive par socket comme celui d'une table : il n'y a qu'une roue sur
 * le site, et tout le monde doit la voir tourner en même temps. Le résultat
 * voyage dès le départ du lancer — l'écran n'a rien à demander à l'arrivée.
 */

interface WheelStore {
  view: WheelView | null;
  /**
   * Écrans abonnés à la salle.
   *
   * Même garde `StrictMode` que Motus et les salons : React monte, démonte puis
   * remonte, et sans comptage le démontage du premier montage sortirait de la
   * salle qu'on vient de rejoindre.
   */
  watchers: number;
  /** Lancer en cours d'envoi : le bouton ne doit pas partir deux fois. */
  pending: boolean;
  apply(view: WheelView): void;
  markPending(): void;
  clearPending(): void;
  clear(): void;
}

export const useWheel = create<WheelStore>((set) => ({
  view: null,
  watchers: 0,
  pending: false,

  apply: (view) => {
    // L'horloge serveur fait foi : le compte à rebours jusqu'à minuit et la fin de
    // l'animation se calculent dessus, jamais sur l'horloge du poste.
    syncServerClock(view.now);
    set({ view, pending: false });
  },

  markPending: () => set({ pending: true }),
  clearPending: () => set({ pending: false }),
  clear: () => set({ view: null, pending: false, watchers: 0 }),
}));

export function retainWheelWatcher(): boolean {
  const current = useWheel.getState().watchers;
  useWheel.setState({ watchers: current + 1 });
  return current === 0;
}

export function releaseWheelWatcher(): boolean {
  const current = useWheel.getState().watchers;
  const next = Math.max(0, current - 1);
  useWheel.setState({ watchers: next });
  return current > 0 && next === 0;
}

export function isInWheelRoom(): boolean {
  return useWheel.getState().watchers > 0;
}

export function bindWheelEvents(socket: GameSocket): void {
  socket.on("wheel:state", (view) => useWheel.getState().apply(view));
}
