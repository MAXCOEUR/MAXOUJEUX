import {
  ACHIEVEMENTS,
  achievementReward,
  isGameCode,
  isLeaderboardMetric,
  isStatPeriod,
  type AchievementBoard,
  type GameCode,
  type LeaderboardMetric,
  type StatPeriod,
} from "@maxoujeux/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../../lib/errors.js";
import { currentUser, requireAuth } from "../../lib/require-auth.js";
import { leaderboard, motusDaily, playerProfile } from "./queries.js";
import { achievementStates } from "./service.js";
import { db } from "../../db/index.js";

/**
 * Classements, profils et succès.
 *
 * En REST et non en Socket.IO : ce sont des pages que l'on consulte, pas des
 * tables qui vivent. Un classement du jour qui bougerait à chaque manche jouée
 * ailleurs serait du bruit, et le sondage d'une page ouverte coûterait au NAS
 * plus que ce qu'il apporte.
 *
 * Tout est **public entre joueurs connectés** : chacun peut lire le profil et le
 * rang de n'importe qui. Les MaxouCoin étant strictement virtuels, il n'y a
 * aucune donnée financière à protéger — et un classement dont on ne verrait que
 * sa propre ligne ne serait pas un classement.
 */
export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/leaderboard", async (request, reply) => {
    const user = currentUser(request);
    const { scope, period, metric } = readLeaderboardQuery(request);
    return reply.send(await leaderboard(user.id, scope, period, metric));
  });

  /**
   * Profil public.
   *
   * Le joueur lit le sien par la même route que celui des autres : c'est la
   * garantie qu'il voit exactement ce qui est montré de lui.
   */
  app.get("/players/:pseudo", async (request, reply) => {
    const { pseudo } = request.params as { pseudo: string };
    const profile = await playerProfile(pseudo);
    profile.achievements.total = ACHIEVEMENTS.length;
    return reply.send(profile);
  });

  app.get("/achievements", async (request, reply) => {
    const user = currentUser(request);
    const rows = await achievementStates(db, user.id);
    const byCode = new Map(rows.map((row) => [row.code, row]));

    // Le catalogue fait autorité sur la liste et sur l'ordre : un succès retiré
    // du code disparaît de l'écran même si sa ligne traîne encore en base.
    const states = ACHIEVEMENTS.map((achievement) => {
      const row = byCode.get(achievement.code);
      return {
        code: achievement.code,
        progress: Math.min(row?.progress ?? 0, achievement.goal),
        unlockedAt: row?.unlockedAt?.toISOString() ?? null,
      };
    });

    const board: AchievementBoard = {
      states,
      unlocked: states.filter((state) => state.unlockedAt !== null).length,
      total: ACHIEVEMENTS.length,
      earned: states
        .filter((state) => state.unlockedAt !== null)
        .reduce((sum, state) => sum + achievementReward(state.code), 0),
    };

    return reply.send(board);
  });

  app.get("/motus/daily", async (request, reply) => {
    const user = currentUser(request);
    return reply.send(await motusDaily(user.id));
  });
}

interface LeaderboardQuery {
  scope: "global" | GameCode;
  period: StatPeriod;
  metric: LeaderboardMetric;
}

/**
 * Les trois paramètres du classement, validés côté serveur.
 *
 * Rien n'empêche d'appeler l'API à la main avec `metric=peuimporte` : les
 * valeurs entrent dans du SQL, elles sont donc rejouées contre les listes
 * partagées plutôt que reprises telles quelles.
 */
function readLeaderboardQuery(request: FastifyRequest): LeaderboardQuery {
  const query = request.query as Record<string, string | undefined>;

  const scopeRaw = query.scope ?? "global";
  if (scopeRaw !== "global" && !isGameCode(scopeRaw)) {
    throw new AppError(400, "VALIDATION_ERROR", "Jeu inconnu", { scope: "Jeu inconnu" });
  }

  const periodRaw = query.period ?? "day";
  if (!isStatPeriod(periodRaw)) {
    throw new AppError(400, "VALIDATION_ERROR", "Période inconnue", { period: "Période inconnue" });
  }

  const metricRaw = query.metric ?? "fortune";
  if (!isLeaderboardMetric(metricRaw)) {
    throw new AppError(400, "VALIDATION_ERROR", "Classement inconnu", {
      metric: "Classement inconnu",
    });
  }

  return { scope: scopeRaw, period: periodRaw, metric: metricRaw };
}
