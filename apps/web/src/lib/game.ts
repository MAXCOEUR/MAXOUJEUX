/**
 * Partie en cours — état poussé par le serveur.
 *
 * Store séparé de `useRealtime` parce que les durées de vie diffèrent : la
 * présence est jetable, une partie doit **survivre à tout démontage**. Naviguer
 * du lobby vers une table, ou ouvrir son porte-monnaie, ne doit rien
 * interrompre — c'est la règle posée dans `CLAUDE.md`.
 *
 * **Aucun coup n'est jamais appliqué localement.** Le serveur est autoritaire :
 * on verrouille le plateau le temps de l'aller-retour, on n'anticipe pas le
 * résultat. Un « appliquer puis réconcilier » ferait clignoter un plateau
 * désynchronisé, et ouvrirait la porte à un client modifié.
 */

import type { MatchView } from "@maxoujeux/shared";
import { create } from "zustand";
import { syncServerClock } from "./clock.js";
import { navigate, useRouteStore } from "./route.js";
import type { GameSocket } from "./socket-types.js";
import { pushToast } from "./toast.js";

/** Au-delà, on considère le coup perdu et on rend la main au joueur. */
const PENDING_TIMEOUT_MS = 4_000;

interface GameState {
  match: MatchView | null;
  /** Coup émis, réponse non reçue : le plateau est verrouillé. */
  pending: number | null;
  /** Le résultat a-t-il été acquitté ? Pilote la superposition de fin. */
  resultSeen: boolean;

  apply: (view: MatchView) => void;
  markPending: (move: number) => void;
  clearPending: () => void;
  acknowledgeResult: () => void;
  clear: () => void;
}

let pendingWatchdog: number | null = null;

function stopWatchdog(): void {
  if (pendingWatchdog !== null) {
    window.clearTimeout(pendingWatchdog);
    pendingWatchdog = null;
  }
}

export const useGame = create<GameState>((set, get) => ({
  match: null,
  pending: null,
  resultSeen: false,

  apply: (view) => {
    syncServerClock(view.now);

    const current = get().match;
    // Les messages peuvent se croiser après une reconnexion : un état plus
    // ancien que celui affiché doit être ignoré, sinon le plateau revient en
    // arrière puis ressaute.
    if (current && current.id === view.id && view.version <= current.version) return;

    stopWatchdog();
    // Tout état accepté est un état neuf : si la partie vient de se terminer,
    // le résultat n'a pas encore été vu. Le gestionnaire n'émet plus rien après
    // la fin d'une partie, l'acquittement du joueur ne sera donc pas écrasé.
    set({ match: view, pending: null, resultSeen: false });
  },

  markPending: (move) => {
    stopWatchdog();
    set({ pending: move });
    pendingWatchdog = window.setTimeout(() => {
      if (get().pending === null) return;
      set({ pending: null });
      pushToast("erreur", "Coup non confirmé par le serveur. Réessaie.");
    }, PENDING_TIMEOUT_MS);
  },

  clearPending: () => {
    stopWatchdog();
    set({ pending: null });
  },

  acknowledgeResult: () => set({ resultSeen: true }),

  clear: () => {
    stopWatchdog();
    set({ match: null, pending: null, resultSeen: false });
  },
}));

/**
 * Branche les événements de partie.
 *
 * Appelé **une seule fois**, depuis `connect()`. Un `useEffect` dans le
 * composant de table perdrait les événements pendant que le joueur consulte le
 * lobby, et s'abonnerait deux fois en `StrictMode`.
 */
export function bindGameEvents(socket: GameSocket): void {
  socket.on("match:state", (view) => {
    const previous = useGame.getState().match;
    useGame.getState().apply(view);

    // La partie vient de démarrer : c'est le serveur qui l'a décidé, en asseyant
    // un adversaire. L'hôte est encore dans le salon, il faut l'amener à sa
    // table — sans quoi son compte à rebours de 30 s tourne sans lui.
    const justStarted = view.status === "playing" && previous?.status !== "playing";
    const route = useRouteStore.getState().route;
    if (justStarted && !(route.name === "table" && route.tableId === view.id)) {
      navigate({ name: "table", tableId: view.id });
    }
  });

  socket.on("match:none", () => {
    useGame.getState().clear();
    const route = useRouteStore.getState().route;
    if (route.name === "table") {
      // L'adresse est périmée : on corrige sans laisser d'entrée d'historique,
      // pour que le bouton retour ne ramène pas sur une table morte.
      navigate({ name: "lobby" }, { replace: true });
      pushToast("info", "Cette partie est terminée.");
    }
  });
}
