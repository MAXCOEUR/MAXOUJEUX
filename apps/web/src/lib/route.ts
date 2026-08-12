/**
 * Routeur de l'application — trois écrans, adossé à l'API History.
 *
 * Pourquoi pas `react-router-dom` : c'est **le serveur** qui décide quand une
 * partie démarre. Le gestionnaire de socket, enregistré hors de React, doit
 * donc pouvoir amener le joueur sur `/table/:id` sans qu'aucun composant soit
 * monté au bon endroit. Un store Zustand — la même famille que `useRealtime` —
 * le fait en une ligne, là où `react-router` imposerait de tenir une instance
 * de routeur et de la faire connaître à la couche socket.
 *
 * Le repli SPA nécessaire est déjà en place des deux côtés : `try_files` dans
 * `apps/web/nginx.conf`, et le comportement par défaut de Vite en développement.
 * Rafraîchir sur `/table/abc` fonctionne donc sans configuration nouvelle.
 */

import type { GameCode } from "@maxoujeux/shared";
import { create } from "zustand";

export type Route =
  | { name: "lobby" }
  | { name: "admin" }
  | { name: "salon"; game: GameCode }
  | { name: "table"; tableId: string };

/** Chemin canonique d'une route. Segments en français, comme le reste du site. */
export function routePath(route: Route): string {
  switch (route.name) {
    case "admin":
      return "/admin";
    case "salon":
      return `/jeu/${route.game}`;
    case "table":
      return `/table/${route.tableId}`;
    case "lobby":
      return "/";
  }
}

/** Toute adresse inconnue retombe sur le lobby plutôt que sur une page d'erreur. */
export function parseRoute(pathname: string): Route {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "admin" && segments.length === 1) {
    return { name: "admin" };
  }
  if (segments[0] === "jeu" && segments[1]) {
    return { name: "salon", game: segments[1] as GameCode };
  }
  if (segments[0] === "table" && segments[1]) {
    return { name: "table", tableId: segments[1] };
  }
  return { name: "lobby" };
}

interface RouteState {
  route: Route;
  /** Navigation normale : empile une entrée d'historique. */
  push: (route: Route) => void;
  /** Correction d'adresse : ne laisse pas d'entrée, le bouton retour reste utile. */
  replace: (route: Route) => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  // Les rendus statiques de composants ne disposent pas de `window`.
  route: parseRoute(typeof window === "undefined" ? "/" : window.location.pathname),

  push: (route) => {
    const path = routePath(route);
    if (path !== window.location.pathname) {
      window.history.pushState(null, "", path);
      // Changer d'écran sans remonter en haut laisserait un joueur au milieu
      // d'une page qui n'a plus rien à voir.
      window.scrollTo(0, 0);
    }
    set({ route });
  },

  replace: (route) => {
    const path = routePath(route);
    if (path !== window.location.pathname) {
      window.history.replaceState(null, "", path);
    }
    set({ route });
  },
}));

// Enregistré une seule fois au chargement du module, pas dans un `useEffect` :
// c'est un abonnement au navigateur, pas au cycle de vie d'un composant.
// Le navigateur restaure lui-même la position de défilement, on n'y touche pas.
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    useRouteStore.setState({ route: parseRoute(window.location.pathname) });
  });
}

export function useRoute(): Route {
  return useRouteStore((state) => state.route);
}

/** Navigation depuis l'extérieur de React — gestionnaires de socket compris. */
export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const { push, replace } = useRouteStore.getState();
  if (options.replace) replace(route);
  else push(route);
}
