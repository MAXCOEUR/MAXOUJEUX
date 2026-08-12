import type {
  ActionReply,
  ClientToServerEvents,
  CurrentUser,
  GameCode,
  PresenceSnapshot,
} from "@maxoujeux/shared";
import { useEffect } from "react";
import { io } from "socket.io-client";
import { create } from "zustand";
import { bindGameEvents, useGame } from "./game.js";
import { bindBlackjackEvents, useBlackjack } from "./blackjack.js";
import { bindRouletteEvents, useRoulette } from "./roulette.js";
import {
  bindMotusEvents,
  isWatchingMotus,
  releaseMotusWatcher,
  retainMotusWatcher,
  useMotus,
} from "./motus.js";
import { queryClient } from "./queryClient";
import { sessionQueryKey } from "./session";
import type { GameSocket } from "./socket-types.js";
import { releaseWatcher, retainWatcher, useTables, watchedGames } from "./tables.js";
import { pushToast } from "./toast.js";
import { walletQueryKey } from "./wallet";

export type { GameSocket } from "./socket-types.js";

interface RealtimeState {
  socket: GameSocket | null;
  status: "idle" | "connecting" | "connected" | "disconnected";
  presence: PresenceSnapshot;
  connect: () => void;
  disconnect: () => void;
}

const EMPTY_PRESENCE: PresenceSnapshot = { online: 0, players: [] };

export const useRealtime = create<RealtimeState>((set, get) => ({
  socket: null,
  status: "idle",
  presence: EMPTY_PRESENCE,

  connect: () => {
    if (get().socket) return;
    set({ status: "connecting" });

    const socket: GameSocket = io({
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });

    socket.on("connect", () => {
      set({ status: "connected" });
      socket.emit("presence:sync");

      /**
       * Resynchronisation complète.
       *
       * Une reconnexion Socket.IO fournit un **nouvel identifiant de socket**,
       * donc plus aucune room : sans ces deux appels, un joueur qui perd son
       * réseau trente secondes ne reçoit plus ni sa partie ni la liste des
       * tables, et ne s'en aperçoit qu'en constatant que rien ne bouge.
       */
      socket.emit("match:sync", (reply) => {
        if (!reply.ok) return;
        if (reply.data?.game === "blackjack") useBlackjack.getState().apply(reply.data);
        else if (reply.data?.game === "roulette") useRoulette.getState().apply(reply.data);
        else if (reply.data) useGame.getState().apply(reply.data);
        else {
          useGame.getState().clear();
          useBlackjack.getState().clear();
          useRoulette.getState().clear();
        }
      });

      for (const game of watchedGames()) {
        socket.emit("tables:watch", { game }, (reply) => {
          if (reply.ok) useTables.getState().apply(reply.data);
        });
      }

      if (isWatchingMotus()) {
        socket.emit("motus:watch", (reply) => {
          if (reply.ok) useMotus.getState().apply(reply.data);
          else pushToast("erreur", reply.message);
        });
      }
    });

    socket.on("disconnect", () => {
      useMotus.getState().clearPending();
      useBlackjack.getState().clearPending();
      set({ status: "disconnected", presence: EMPTY_PRESENCE });
    });
    socket.on("presence:update", (presence) => set({ presence }));

    socket.on("wallet:update", ({ balance }) => {
      queryClient.setQueryData(sessionQueryKey, (previous: CurrentUser | null | undefined) =>
        previous ? { ...previous, balance } : previous,
      );
      void queryClient.invalidateQueries({ queryKey: walletQueryKey });
    });

    // Erreurs arrivant hors de tout geste du joueur : forfait déclaré par le
    // serveur, table disparue. Celles qui répondent à une action précise
    // remontent par accusé de réception, pas ici.
    socket.on("error:app", ({ message }) => pushToast("erreur", message));

    socket.on("tables:update", (snapshot) => useTables.getState().apply(snapshot));
    socket.on("tables:counts", (counts) => useTables.getState().setCounts(counts));

    bindGameEvents(socket);
    bindBlackjackEvents(socket);
    bindRouletteEvents(socket);
    bindMotusEvents(socket);

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    socket?.disconnect();
    set({ socket: null, status: "idle", presence: EMPTY_PRESENCE });

    // `useLogout` vide le cache React Query mais pas Zustand : sans cette
    // remise à zéro, le compte suivant sur la même machine verrait la table du
    // précédent.
    useGame.getState().clear();
    useBlackjack.getState().clear();
    useMotus.getState().clear();
    useTables.getState().clear();
  },
}));

/** Ouvre la connexion tant que le joueur est authentifié, la ferme à la déconnexion. */
export function useRealtimeConnection(isAuthenticated: boolean): void {
  const connect = useRealtime((state) => state.connect);
  const disconnect = useRealtime((state) => state.disconnect);
  useEffect(() => {
    if (isAuthenticated) {
      connect();
      return;
    }
    disconnect();
  }, [isAuthenticated, connect, disconnect]);
}

/**
 * Émission typée depuis n'importe où.
 *
 * @returns false si la socket est absente — l'appelant doit alors dire au joueur
 * qu'il est hors ligne plutôt que de laisser un bouton sans effet.
 */
export function emit<E extends keyof ClientToServerEvents>(
  event: E,
  ...args: Parameters<ClientToServerEvents[E]>
): boolean {
  const { socket } = useRealtime.getState();
  if (!socket) return false;
  socket.emit(event, ...args);
  return true;
}

/**
 * Émission avec accusé de réception, en promesse.
 *
 * Les intentions refusables passent par un ack et non par `error:app` : le front
 * doit savoir *quelle* action a échoué pour afficher le message sous le bouton
 * cliqué.
 */
export function request<T>(
  send: (socket: GameSocket, ack: (reply: ActionReply<T>) => void) => void,
): Promise<ActionReply<T>> {
  const { socket } = useRealtime.getState();
  if (!socket) {
    return Promise.resolve({
      ok: false,
      code: "OFFLINE",
      message: "Liaison temps réel perdue. Vérifie ta connexion.",
    });
  }
  return new Promise((resolve) => send(socket, resolve));
}

/**
 * Abonne un écran au salon d'un jeu, avec comptage de références.
 *
 * Le comptage est ce qui rend l'abonnement sûr en `StrictMode`, où React monte
 * puis démonte puis remonte : sans lui, le démontage du premier montage
 * annulerait l'abonnement du second et la liste cesserait de vivre.
 */
export function watchSalon(game: GameCode): () => void {
  if (retainWatcher(game)) {
    emit("tables:watch", { game }, (reply) => {
      if (reply.ok) useTables.getState().apply(reply.data);
      else pushToast("erreur", reply.message);
    });
  }

  return () => {
    if (releaseWatcher(game)) emit("tables:unwatch", { game });
  };
}

/** Abonne la page Motus, avec le même garde StrictMode que les salons. */
export function watchMotus(): () => void {
  if (retainMotusWatcher()) {
    emit("motus:watch", (reply) => {
      if (reply.ok) useMotus.getState().apply(reply.data);
      else pushToast("erreur", reply.message);
    });
  }

  return () => {
    if (releaseMotusWatcher()) emit("motus:unwatch");
  };
}
