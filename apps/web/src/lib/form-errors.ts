import type { ZodError } from "zod";
import { ApiClientError } from "./api";

/**
 * Traduction des erreurs en messages posés sous le bon champ.
 *
 * Sorties d'`AuthPage` et d'`AdminPage`, où elles vivaient en double, le jour où
 * un troisième écran de formulaire en a eu besoin.
 */

export function toFieldErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[issue.path.join(".")] ??= issue.message;
  return errors;
}

/**
 * Sépare ce qui se dit sous un champ de ce qui se dit en bandeau.
 *
 * Une erreur d'API sans `fields` n'appartient à aucun champ : l'afficher sous le
 * premier venu serait trompeur.
 */
export function mutationError(error: unknown): {
  fields: Record<string, string>;
  message: string | null;
} {
  if (error instanceof ApiClientError) {
    return {
      fields: error.fields,
      message: Object.keys(error.fields).length === 0 ? error.message : null,
    };
  }
  return { fields: {}, message: "Une erreur inattendue est survenue." };
}
