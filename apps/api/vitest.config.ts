import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `env.ts` refuse de démarrer sans ces variables et coupe le processus :
    // il faut donc les fournir avant le premier import de la base.
    env: {
      NODE_ENV: "test",
      SESSION_SECRET: "secret-de-test-suffisamment-long-pour-passer-la-validation",
      LOG_LEVEL: "error",
      ADMIN_EMAIL: "",
      ADMIN_PSEUDO: "",
      ADMIN_PASSWORD: "",
    },
    // Les tests du porte-monnaie partagent une même base : les exécuter en
    // parallèle mélangerait les comptes et fausserait les compteurs.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
