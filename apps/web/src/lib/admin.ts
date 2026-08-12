import type {
  AdminAccount,
  CreatePlayerInput,
  CurrentUser,
  ResetPlayerPasswordInput,
  SetPlayerBalanceInput,
} from "@maxoujeux/shared";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { sessionQueryKey } from "./session";

export const adminAccountsQueryKey = ["admin", "accounts"] as const;

interface AccountsResponse {
  accounts: AdminAccount[];
}

/** Protection visuelle : le serveur applique la même règle à chaque mutation. */
export function adminActionAllowed(account: AdminAccount): boolean {
  return !account.isAdmin;
}

export function onAdminMutationSuccess(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: adminAccountsQueryKey });
}

export function updateCurrentAccountBalance(
  queryClient: QueryClient,
  accountId: string,
  balance: number,
): void {
  queryClient.setQueryData<CurrentUser | null>(sessionQueryKey, (current) =>
    current?.id === accountId ? { ...current, balance } : current,
  );
}

export function useAdminAccounts() {
  return useQuery({
    queryKey: adminAccountsQueryKey,
    queryFn: () => api.get<AccountsResponse>("/admin/accounts"),
    select: (response) => response.accounts,
  });
}

export function useCreatePlayer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlayerInput) => api.post<{ account: AdminAccount }>("/admin/accounts", input),
    onSuccess: () => onAdminMutationSuccess(queryClient),
  });
}

export function useResetPlayerPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, input }: { accountId: string; input: ResetPlayerPasswordInput }) =>
      api.patch<void>(`/admin/accounts/${accountId}/password`, input),
    onSuccess: () => onAdminMutationSuccess(queryClient),
  });
}

export function useSetPlayerBalance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, input }: { accountId: string; input: SetPlayerBalanceInput }) =>
      api.patch<{ balance: number }>(`/admin/accounts/${accountId}/balance`, input),
    onSuccess: ({ balance }, { accountId }) => {
      onAdminMutationSuccess(queryClient);
      updateCurrentAccountBalance(queryClient, accountId, balance);
    },
  });
}

export function useDeletePlayer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => api.delete<void>(`/admin/accounts/${accountId}`),
    onSuccess: () => onAdminMutationSuccess(queryClient),
  });
}
