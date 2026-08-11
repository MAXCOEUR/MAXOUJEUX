import { QueryClient } from "@tanstack/react-query";

/**
 * Client de requêtes unique, exporté depuis un module et non créé dans un
 * composant : la socket vit hors de React et doit pouvoir écrire dans le cache
 * quand un événement `wallet:update` arrive.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Les données de jeu arrivent par WebSocket, pas par revalidation HTTP :
      // recharger au retour d'onglet ne ferait qu'ajouter du trafic inutile.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});
