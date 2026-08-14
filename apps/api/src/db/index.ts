import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env, isProduction, isTest } from "../env.js";
import * as schema from "./schema.js";

export { schema };

/**
 * Deux pilotes, une seule API.
 *
 * - Production (et tout environnement disposant d'un `DATABASE_URL`) : PostgreSQL
 *   via postgres-js.
 * - Développement sans `DATABASE_URL` : PGlite, un vrai PostgreSQL compilé en
 *   WebAssembly qui persiste dans `.data/`. Le projet se lance donc sans
 *   installer ni Docker ni PostgreSQL, tout en exécutant exactement les mêmes
 *   migrations SQL qu'en production.
 *
 * Les deux pilotes exposent la même surface de requête ; on type l'export avec
 * celui de postgres-js pour garder une inférence propre côté appelant.
 */
export type Database = PostgresJsDatabase<typeof schema>;

/** Répertoire des migrations générées par drizzle-kit, relatif au dossier de travail. */
const migrationsFolder = path.resolve(process.cwd(), "drizzle");

interface Connection {
  db: Database;
  driver: "postgres" | "pglite";
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

async function connectPostgres(url: string): Promise<Connection> {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");

  // Pool volontairement modeste : un NAS n'a pas besoin de 50 connexions,
  // et PostgreSQL en réserve une part pour la maintenance.
  const client = postgres(url, { max: 10, idle_timeout: 30, connect_timeout: 10 });
  const db = drizzlePostgres(client, { schema });

  return {
    db,
    driver: "postgres",
    migrate: () => migrate(db, { migrationsFolder }),
    close: () => client.end({ timeout: 5 }),
  };
}

async function connectPglite(): Promise<Connection> {
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);

  // Chaque processus Vitest reçoit sa base en mémoire : un serveur `pnpm dev`
  // peut rester ouvert sans que les tests et lui écrivent simultanément dans
  // le même répertoire PGlite, configuration que ce pilote ne supporte pas.
  const dataDir = isTest ? "memory://" : path.resolve(process.cwd(), ".data/pglite");
  if (!isTest) {
    // PGlite ne crée pas l'arborescence parente : sans ce mkdir récursif, un
    // premier lancement sur un dépôt fraîchement cloné échoue en ENOENT.
    mkdirSync(dataDir, { recursive: true });
  }

  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });

  // PGlite est **mono-processus** : deux `pnpm dev`, ou un `pnpm dev` et une
  // suite de tests pointant sur le même répertoire, corrompent le dossier de
  // données et échouent ensuite sur un « RuntimeError: Aborted() » venu du
  // WebAssembly, qui ne dit rien à personne. On traduit une bonne fois.
  if (!isTest) {
    try {
      await client.query("select 1");
    } catch (error) {
      throw new Error(
        "Base de développement PGlite illisible.\n" +
          "Cause la plus fréquente : une autre instance de l'API tourne déjà sur le même " +
          `répertoire (${dataDir}).\n` +
          "Arrête l'autre `pnpm dev`, puis relance. Si le problème persiste, supprime ce " +
          "répertoire : il sera recréé, au prix des comptes de test qu'il contient.",
        { cause: error },
      );
    }
  }

  return {
    db: db as unknown as Database,
    driver: "pglite",
    migrate: () => migrate(db, { migrationsFolder }),
    close: () => client.close(),
  };
}

const connection: Connection = env.DATABASE_URL
  ? await connectPostgres(env.DATABASE_URL)
  : await connectPglite();

if (connection.driver === "pglite" && isProduction) {
  // Ceinture et bretelles : env.ts l'interdit déjà, mais une base éphémère
  // en production mérite deux garde-fous.
  throw new Error("PGlite ne doit jamais être utilisé en production");
}

export const db = connection.db;
export const dbDriver = connection.driver;
export const runMigrations = connection.migrate;
export const closeDatabase = connection.close;

/**
 * Lignes d'un `db.execute` de SQL brut, quel que soit le pilote.
 *
 * Les deux pilotes ne rendent **pas** la même chose : postgres-js renvoie
 * directement un tableau de lignes, PGlite un objet `{ rows }`. Sans cette
 * normalisation, une requête écrite en développement marcherait sur PGlite et
 * rendrait un tableau vide en production — précisément l'écart qui ne se
 * découvre qu'après déploiement.
 *
 * Ne concerne que le SQL brut : le constructeur de requêtes de Drizzle rend déjà
 * un tableau des deux côtés.
 */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
