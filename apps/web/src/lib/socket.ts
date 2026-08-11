import type {
  ClientToServerEvents,
  CurrentUser,
  PresenceSnapshot,
  ServerToClientEvents,
} from "@maxoujeux/shared";
import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import { queryClient } from "./queryClient";
import { sessionQueryKey } from "./session";
import { walletQueryKey } from "./wallet";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface RealtimeState {
  socket: GameSocket | null;
  status: "idle" | "connecting" | "connected" | "disconnected";
  presence: PresenceSnapshot;
  connect: () => void;
  disconnect: () => void;
}

const EMPTY_PRESENCE: PresenceSnapshot = { online: 0, players: [] };

/**
 * Une seule socket pour toute l'application, dans un store hors React.
 *
 * Le montage/démontage des composants ne doit jamais couper la connexion :
 * naviguer du lobby vers une table de poker ne peut pas déconnecter le joueur
 * de sa partie. C'est aussi ce qui permettra, au lot 1, de conserver l'état de
 * partie pendant un changement de page.
 */
export const useRealtime = create<RealtimeState>((set, get) => ({
  socket: null,
  status: "idle",
  presence: EMPTY_PRESENCE,

  connect: () => {
    if (get().socket) return;

    set({ status: "connecting" });

    // Le cookie de session part avec le handshake : aucune identité n'est
    // transmise dans le code client, elle est résolue côté serveur.
    const socket: GameSocket = io({
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });

    socket.on("connect", () => {
      set({ status: "connected" });
      // Après une coupure réseau, l'état local peut avoir dérivé : on
      // redemande systématiquement un instantané complet.
      socket.emit("presence:sync");
    });

    socket.on("disconnect", () => set({ status: "disconnected", presence: EMPTY_PRESENCE }));
    socket.on("presence:update", (presence) => set({ presence }));

    // Le solde peut bouger sans action de cet onglet : bonus encaissé ailleurs,
    // gain d'une main de poker. On écrit directement dans le cache de session
    // plutôt que de relancer une requête HTTP.
    socket.on("wallet:update", ({ balance }) => {
      queryClient.setQueryData(sessionQueryKey, (previous: CurrentUser | null | undefined) =>
        previous ? { ...previous, balance } : previous,
      );
      void queryClient.invalidateQueries({ queryKey: walletQueryKey });
    });

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    socket?.disconnect();
    set({ socket: null, status: "idle", presence: EMPTY_PRESENCE });
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
