export * from "./auth.js";
export * from "./admin.js";
export * from "./blackjack.js";
export * from "./chat.js";
export * from "./economy.js";
export * from "./games.js";
export * from "./motus.js";
export * from "./realtime.js";
export * from "./roulette.js";
export * from "./tables.js";

/** Enveloppe d'erreur uniforme renvoyée par l'API sur tout statut >= 400. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Erreurs de validation champ par champ, pour un affichage sous l'input concerné. */
    fields?: Record<string, string>;
  };
}
