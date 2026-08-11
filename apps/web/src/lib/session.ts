import type { CurrentUser, LoginInput, RegisterInput } from "@maxoujeux/shared";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { api, ApiClientError } from "./api";

interface SessionResponse {
  user: CurrentUser;
}

export const sessionQueryKey = ["session"] as const;

/**
 * Source de vérité de l'identité côté front.
 *
 * `null` signifie « vérifié, non connecté » — à distinguer de `undefined`
 * (« pas encore vérifié »), sinon on redirigerait vers la page de connexion
 * pendant le premier chargement.
 */
export function useSession(): UseQueryResult<CurrentUser | null> {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      try {
        const { user } = await api.get<SessionResponse>("/auth/me");
        return user;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) return null;
        throw error;
      }
    },
    // Inutile de reposer la question au serveur à chaque retour d'onglet :
    // une session expirée se manifestera au premier appel protégé.
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<SessionResponse>("/auth/login", input),
    onSuccess: ({ user }) => queryClient.setQueryData(sessionQueryKey, user),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.post<SessionResponse>("/auth/register", input),
    onSuccess: ({ user }) => queryClient.setQueryData(sessionQueryKey, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>("/auth/logout"),
    onSuccess: () => {
      queryClient.setQueryData(sessionQueryKey, null);
      // Purge complète : aucune donnée du compte précédent ne doit rester en
      // cache si un autre joueur se connecte sur la même machine.
      queryClient.clear();
    },
  });
}
