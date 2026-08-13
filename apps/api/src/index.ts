import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { closeDatabase, dbDriver, runMigrations } from "./db/index.js";
import { env, isDevelopment, isProduction } from "./env.js";
import { registerErrorHandler } from "./lib/errors.js";
import { authRoutes } from "./modules/auth/routes.js";
import { accountRoutes, avatarReadRoutes } from "./modules/account/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { bootstrapAdmin } from "./modules/auth/bootstrap-admin.js";
import { lobbyRoutes } from "./modules/lobby/routes.js";
import { shutdown as shutdownTables } from "./modules/tables/manager.js";
import { shutdown as shutdownMotus } from "./modules/motus/service.js";
import { shutdownWheel } from "./modules/wheel/service.js";
import { purgeExpiredSessions } from "./modules/auth/session.js";
import { walletRoutes } from "./modules/wallet/routes.js";
import { attachRealtime } from "./realtime/index.js";
import { recoverBlackjackRounds } from "./modules/blackjack/service.js";
import { recoverRouletteRounds } from "./modules/roulette/service.js";
import { recoverPokerRounds } from "./modules/poker/service.js";

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    ...(isDevelopment && {
      transport: {
        target: "pino-pretty",
        options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
    }),
  },
  // L'API n'est jointe qu'à travers deux mandataires de confiance : Nginx Proxy
  // Manager sur le NAS, puis le nginx du conteneur `web`. Sans trustProxy,
  // toutes les requêtes sembleraient venir de l'IP du conteneur et la
  // limitation de débit s'appliquerait à tous les joueurs d'un seul coup.
  trustProxy: isProduction,
  bodyLimit: 64 * 1024,
});

// --- Sécurité de base -------------------------------------------------------

await app.register(fastifyHelmet, {
  // Fastify ne sert aucune page : la CSP et les en-têtes du front sont posés
  // par le nginx du conteneur `web`.
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "same-site" },
});

await app.register(fastifyCookie, {
  secret: env.SESSION_SECRET,
});

await app.register(fastifyRateLimit, {
  global: true,
  max: 300,
  timeWindow: "1 minute",
  // Les routes d'authentification resserrent ce plafond via `config.rateLimit`.
});

registerErrorHandler(app);

// --- Routes -----------------------------------------------------------------

app.get("/api/health", async () => ({
  status: "ok",
  driver: dbDriver,
  uptime: Math.round(process.uptime()),
}));

await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(accountRoutes, { prefix: "/api/account" });
// Lecture de l'avatar d'un autre joueur : elle parle d'un compte tiers, pas du
// sien, d'où un préfixe distinct de celui des réglages personnels.
await app.register(avatarReadRoutes, { prefix: "/api/users" });
await app.register(adminRoutes, { prefix: "/api/admin" });
await app.register(lobbyRoutes, { prefix: "/api/lobby" });
await app.register(walletRoutes, { prefix: "/api/wallet" });

// --- Temps réel -------------------------------------------------------------

const io = attachRealtime(app);

// --- Démarrage --------------------------------------------------------------

async function start(): Promise<void> {
  app.log.info({ driver: dbDriver }, "Application des migrations");
  await runMigrations();
  await bootstrapAdmin();
  await recoverBlackjackRounds();
  await recoverRouletteRounds();
  await recoverPokerRounds();
  await purgeExpiredSessions();

  // Purge quotidienne des sessions expirées. `unref` pour ne pas retenir le
  // processus au moment de l'arrêt.
  setInterval(() => {
    purgeExpiredSessions().catch((error) => app.log.error({ err: error }, "Purge des sessions échouée"));
  }, 24 * 3_600_000).unref();

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`MaxouJeux API prête — origine publique ${env.PUBLIC_ORIGIN}`);
}

/**
 * Arrêt propre : indispensable derrière Docker, qui envoie SIGTERM puis tue le
 * processus au bout de 10 s. On ferme les sockets avant le serveur HTTP, sinon
 * les clients WebSocket maintiennent la connexion ouverte jusqu'au timeout.
 */
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} reçu, arrêt en cours`);

    void (async () => {
      try {
        // Les minuteries de tables d'abord : un `setTimeout` encore armé
        // empêche Node de rendre la main, et un forfait déclenché pendant
        // l'arrêt écrirait en base alors qu'on la referme.
        shutdownTables();
        shutdownMotus();
        shutdownWheel();
        await io.close();
        await app.close();
        await closeDatabase();
        process.exit(0);
      } catch (error) {
        app.log.error({ err: error }, "Arrêt en erreur");
        process.exit(1);
      }
    })();
  });
}

try {
  await start();
} catch (error) {
  app.log.error({ err: error }, "Démarrage impossible");
  process.exit(1);
}
