/**
 * Classements, profils et succès — côté client.
 *
 * En REST et non par la socket : ce sont des pages que l'on consulte. Un
 * classement qui frémirait à chaque manche jouée ailleurs serait du bruit, et le
 * sondage permanent d'un onglet ouvert coûterait au NAS plus qu'il ne rapporte.
 *
 * `staleTime` court plutôt que nul : revenir sur l'onglet après une partie doit
 * montrer un classement à jour, sans pour autant relancer la requête à chaque
 * clic sur un filtre déjà consulté.
 */

import type {
  AchievementBoard,
  GameCode,
  Leaderboard,
  LeaderboardMetric,
  MotusDaily,
  PlayerProfile,
  StatPeriod,
} from "@maxoujeux/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

const STALE = 30_000;

export function useLeaderboard(
  scope: "global" | GameCode,
  period: StatPeriod,
  metric: LeaderboardMetric,
) {
  return useQuery({
    queryKey: ["classement", scope, period, metric],
    queryFn: () =>
      api.get<Leaderboard>(
        `/stats/leaderboard?scope=${scope}&period=${period}&metric=${metric}`,
      ),
    staleTime: STALE,
  });
}

export function usePlayerProfile(pseudo: string) {
  return useQuery({
    queryKey: ["profil", pseudo.toLowerCase()],
    queryFn: () => api.get<PlayerProfile>(`/stats/players/${encodeURIComponent(pseudo)}`),
    staleTime: STALE,
    // Un pseudo inconnu ne devient pas connu en réessayant.
    retry: false,
  });
}

export function useAchievements() {
  return useQuery({
    queryKey: ["succes"],
    queryFn: () => api.get<AchievementBoard>("/stats/achievements"),
    staleTime: STALE,
  });
}

export function useMotusDaily() {
  return useQuery({
    queryKey: ["motus-du-jour"],
    queryFn: () => api.get<MotusDaily>("/stats/motus/daily"),
    staleTime: STALE,
  });
}
