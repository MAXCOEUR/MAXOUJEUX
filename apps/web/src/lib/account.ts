import {
  AVATAR_MIME,
  type CurrentUser,
  type DeleteAccountInput,
  type UpdateEmailInput,
  type UpdatePasswordInput,
  type UpdatePseudoInput,
} from "@maxoujeux/shared";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, apiFetch } from "./api";
import { useChat } from "./chat";
import { sessionQueryKey } from "./session";

interface SessionResponse {
  user: CurrentUser;
}

/**
 * Mutations de l'espace « Mon compte ».
 *
 * Le motif est celui de `useLogin` : la réponse porte le profil complet et
 * remplace le cache de session, ce qui rafraîchit l'en-tête — avatar, pseudo,
 * solde — sans aller redemander quoi que ce soit au serveur.
 */
function useProfileMutation<TInput>(appel: (input: TInput) => Promise<SessionResponse>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: appel,
    onSuccess: ({ user }) => queryClient.setQueryData(sessionQueryKey, user),
  });
}

export function useUpdateEmail() {
  return useProfileMutation((input: UpdateEmailInput) =>
    api.patch<SessionResponse>("/account/email", input),
  );
}

export function useUpdatePseudo() {
  return useProfileMutation((input: UpdatePseudoInput) =>
    api.patch<SessionResponse>("/account/pseudo", input),
  );
}

export function useUpdatePassword() {
  return useMutation({
    mutationFn: (input: UpdatePasswordInput) => api.patch<void>("/account/password", input),
  });
}

/** Applique la nouvelle graine d'avatar au profil en cache. */
function applyAvatarSeed(queryClient: QueryClient, avatarSeed: string): void {
  queryClient.setQueryData(sessionQueryKey, (user: CurrentUser | null | undefined) =>
    user ? { ...user, avatarSeed } : user,
  );
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    /**
     * Octets bruts, pas de base64 dans du JSON : l'encodage gonflerait la charge
     * d'un tiers pour rien. La surcharge d'en-tête écrase bien le
     * `Content-Type: application/json` posé par défaut.
     */
    mutationFn: (image: Blob) =>
      apiFetch<{ avatarSeed: string }>("/account/avatar", {
        method: "PUT",
        body: image,
        headers: { "Content-Type": AVATAR_MIME },
      }),
    onSuccess: ({ avatarSeed }) => applyAvatarSeed(queryClient, avatarSeed),
  });
}

export function useRemoveAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ avatarSeed: string }>("/account/avatar"),
    onSuccess: ({ avatarSeed }) => applyAvatarSeed(queryClient, avatarSeed),
  });
}

/**
 * Fermeture du compte.
 *
 * Rejoue le nettoyage de la déconnexion : rien du compte fermé ne doit rester en
 * mémoire. Le portier de session renvoie ensuite seul vers l'écran de connexion.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    // `api.delete` n'accepte pas de corps, et la confirmation en a besoin.
    mutationFn: (input: DeleteAccountInput) =>
      apiFetch<void>("/account", { method: "DELETE", body: JSON.stringify(input) }),
    onSuccess: () => {
      useChat.getState().clear();
      queryClient.setQueryData(sessionQueryKey, null);
      queryClient.clear();
    },
  });
}
