/**
 * État du lobby au chargement.
 *
 * `GET /api/lobby` existait depuis le lot 0 sans jamais être appelé. Il sert
 * ici à peupler les compteurs de tables **avant** que la socket soit établie :
 * sans lui, les cartes des jeux affichent « 0 table » pendant la première
 * seconde, ce qui est faux et dissuasif.
 *
 * Ensuite, c'est la socket qui tient les compteurs à jour (`tables:counts`).
 */

import type { GameCode, PresenceSnapshot, TableCounts } from "@maxoujeux/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { syncServerClock } from "./clock.js";

interface LobbyState {
  presence: PresenceSnapshot;
  tables: Partial<Record<GameCode, TableCounts>>;
  now: string;
}

export const lobbyQueryKey = ["lobby"] as const;

export function useLobby() {
  return useQuery({
    queryKey: lobbyQueryKey,
    queryFn: async () => {
      const state = await api.get<LobbyState>("/lobby");
      // Premier recalage de l'horloge : dès le chargement, avant toute partie.
      syncServerClock(state.now);
      return state;
    },
    // Les compteurs vivent en temps réel après le premier chargement : les
    // rafraîchir au retour d'onglet ne ferait que du trafic inutile.
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}
