import type { ApiError } from "@maxoujeux/shared";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { isProduction } from "../env.js";

/**
 * Erreur métier destinée au client. Tout ce qui n'en est pas une est un bug :
 * le gestionnaire global le journalise et renvoie un 500 opaque, pour ne jamais
 * laisser fuiter une trace de pile ou un message PostgreSQL.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Aplatit une erreur Zod en `{ champ: message }` pour un affichage sous l'input. */
function flattenZod(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Forme des erreurs HTTP levées par les plugins Fastify (limitation de débit, JSON illisible…). */
interface HttpishError {
  statusCode?: number;
  code?: string;
  message?: string;
}

function asHttpish(error: unknown): HttpishError {
  return typeof error === "object" && error !== null ? (error as HttpishError) : {};
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      const body: ApiError = {
        error: { code: error.code, message: error.message, ...(error.fields && { fields: error.fields }) },
      };
      return reply.status(error.statusCode).send(body);
    }

    if (error instanceof ZodError) {
      const body: ApiError = {
        error: {
          code: "VALIDATION_ERROR",
          message: "Certains champs sont invalides",
          fields: flattenZod(error),
        },
      };
      return reply.status(400).send(body);
    }

    const httpish = asHttpish(error);

    // Erreurs levées par les plugins Fastify (limitation de débit, corps JSON illisible…)
    if (typeof httpish.statusCode === "number" && httpish.statusCode < 500) {
      const body: ApiError = {
        error: {
          code: httpish.code ?? "BAD_REQUEST",
          message: httpish.message ?? "Requête invalide",
        },
      };
      return reply.status(httpish.statusCode).send(body);
    }

    // Tout ce qui arrive ici est un bug : on le journalise complètement et on
    // ne renvoie au client qu'un message opaque en production.
    request.log.error({ err: error }, "Erreur non gérée");
    const body: ApiError = {
      error: {
        code: "INTERNAL_ERROR",
        message: isProduction
          ? "Une erreur interne est survenue"
          : (httpish.message ?? "Erreur inconnue"),
      },
    };
    return reply.status(500).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiError = {
      error: { code: "NOT_FOUND", message: `Route inconnue : ${request.method} ${request.url}` },
    };
    return reply.status(404).send(body);
  });
}
