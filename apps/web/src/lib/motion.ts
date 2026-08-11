/**
 * Réglage système « réduire les animations ».
 *
 * La règle CSS de `index.css` neutralise déjà les durées d'animation et de
 * transition, mais elle ne peut rien contre une animation **pilotée par JS** —
 * et surtout, elle porte un `!important` qui bat les styles en ligne. L'anneau
 * de temps, dont la durée est fournie en ligne, se viderait donc
 * instantanément : il afficherait un tour expiré alors qu'il reste 25 secondes.
 * Ce hook permet de rendre autre chose plutôt que de mentir.
 */

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Lecture synchrone, utilisable hors de React. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia(QUERY).matches;
}

/**
 * `useSyncExternalStore` plutôt que `useState` + `useEffect` : la valeur est
 * juste dès le premier rendu, sans passer par un état initial faux.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
