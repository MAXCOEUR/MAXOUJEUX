export * from "./auth.js";
export * from "./economy.js";
export * from "./games.js";
export * from "./realtime.js";

/** Enveloppe d'erreur uniforme renvoyée par l'API sur tout statut >= 400. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Erreurs de validation champ par champ, pour un affichage sous l'input concerné. */
    fields?: Record<string, string>;
  };
}
