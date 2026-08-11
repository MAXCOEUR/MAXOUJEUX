import { defineConfig } from "drizzle-kit";

/**
 * Configuration de génération des migrations uniquement.
 * `drizzle-kit generate` produit du SQL à partir de `schema.ts` sans se
 * connecter : la même migration est ensuite rejouée sur PGlite (dev) et sur
 * PostgreSQL (production) au démarrage de l'API.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/maxoujeux",
  },
  strict: true,
  verbose: true,
});
