export * from "./auth.js";
export * from "./account.js";
export * from "./admin.js";
export * from "./avatar.js";
export * from "./blackjack.js";
export * from "./chat.js";
export * from "./economy.js";
export * from "./games.js";
export * from "./motus.js";
export * from "./plinko.js";
export * from "./realtime.js";
export * from "./roulette.js";
export * from "./slots.js";
export * from "./tables.js";
export * from "./wheel.js";

/** Enveloppe d'erreur uniforme renvoyée par l'API sur tout statut >= 400. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Erreurs de validation champ par champ, pour un affichage sous l'input concerné. */
    fields?: Record<string, string>;
  };
}
