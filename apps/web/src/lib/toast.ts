/**
 * Notifications éphémères.
 *
 * Nécessaires parce que certains refus n'ont pas de bouton où s'afficher : un
 * forfait déclenché par le serveur, une table qui disparaît, un `error:app`
 * arrivant hors de tout geste du joueur. Les erreurs rattachées à une action
 * précise restent, elles, affichées **sous le bouton concerné** — un message
 * détaché du geste ne dit pas ce qui a échoué.
 */

import { create } from "zustand";

export type ToastTone = "info" | "erreur" | "gain";

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (tone: ToastTone, message: string, ttlMs?: number) => void;
  dismiss: (id: number) => void;
  clear: () => void;
}

/** Au-delà, la pile masquerait le jeu. Les plus anciennes cèdent la place. */
const MAX_VISIBLE = 3;

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],

  push: (tone, message, ttlMs = 5_000) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, tone, message }].slice(-MAX_VISIBLE) }));
    window.setTimeout(() => get().dismiss(id), ttlMs);
  },

  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  clear: () => set({ toasts: [] }),
}));

/** Émission depuis l'extérieur de React — gestionnaires de socket compris. */
export function pushToast(tone: ToastTone, message: string, ttlMs?: number): void {
  useToasts.getState().push(tone, message, ttlMs);
}
