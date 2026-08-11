import { SIGNUP_BONUS } from "@maxoujeux/shared";
import { z } from "zod";

/**
 * Configuration validée au démarrage. Le serveur refuse de démarrer si une
 * variable est manquante ou incohérente : mieux vaut un crash immédiat et
 * explicite qu'une session non signée découverte trois semaines plus tard.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default("0.0.0.0"),

    /**
     * Chaîne de connexion PostgreSQL.
     * Absente en développement, l'API bascule sur PGlite (PostgreSQL embarqué)
     * dans `.data/` — aucune installation requise pour lancer le projet.
     */
    DATABASE_URL: z.string().url().optional(),

    /** Clé de signature des cookies. 32 caractères minimum. */
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET doit faire au moins 32 caractères"),

    /** Durée de vie d'une session, en jours. */
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

    /**
     * Origine publique du site. Sert au réglage du cookie et au contrôle
     * d'origine du handshake Socket.IO.
     */
    PUBLIC_ORIGIN: z.string().url().default("http://localhost:5173"),

    /**
     * MaxouCoin offerts à la création du compte. La valeur par défaut vient du
     * paquet partagé, pour que l'écran d'inscription annonce le bon montant.
     */
    STARTING_BALANCE: z.coerce.number().int().nonnegative().default(SIGNUP_BONUS),

    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && !value.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "DATABASE_URL est obligatoire en production (PGlite est réservé au développement)",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(racine)"} : ${issue.message}`)
    .join("\n");
  console.error(`Configuration invalide :\n${details}`);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
