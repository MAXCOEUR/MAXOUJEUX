import type { WalletEntry, WalletSummary } from "@maxoujeux/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { sessionQueryKey } from "./session";

export const walletQueryKey = ["wallet"] as const;
export const walletHistoryQueryKey = ["wallet", "history"] as const;

interface ClaimResult {
  amount: number;
  streak: number;
  balance: number;
}

export function useWallet(enabled: boolean) {
  return useQuery({
    queryKey: walletQueryKey,
    queryFn: () => api.get<WalletSummary>("/wallet"),
    enabled,
    // Le compte à rebours affiché est recalculé côté client à partir de
    // `nextClaimAt` : inutile de réinterroger le serveur chaque seconde.
    staleTime: 60_000,
  });
}

export function useWalletHistory(enabled: boolean) {
  return useQuery({
    queryKey: walletHistoryQueryKey,
    queryFn: () => api.get<{ entries: WalletEntry[] }>("/wallet/history?limit=15"),
    enabled,
    staleTime: 30_000,
  });
}

export function useClaimDailyBonus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<ClaimResult>("/wallet/daily-bonus"),
    onSuccess: (result) => {
      // Mise à jour immédiate du solde affiché dans l'en-tête. L'événement
      // `wallet:update` fera la même chose pour les autres onglets ouverts.
      queryClient.setQueryData(sessionQueryKey, (previous: unknown) =>
        previous && typeof previous === "object"
          ? { ...previous, balance: result.balance }
          : previous,
      );
      void queryClient.invalidateQueries({ queryKey: walletQueryKey });
      void queryClient.invalidateQueries({ queryKey: walletHistoryQueryKey });
    },
  });
}
