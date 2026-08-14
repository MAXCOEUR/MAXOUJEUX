/**
 * Lectures des classements et des profils.
 *
 * Séparé du service d'écriture : ici rien n'est modifié, et tout est du SQL de
 * lecture assez dense pour mériter son propre fichier.
 *
 * Le fil conducteur de toutes ces requêtes est la **règle du rang** : le joueur
 * qui consulte doit toujours pouvoir se trouver, même 87e sur 143. Le rang est
 * donc calculé par fonction fenêtre sur l'ensemble des joueurs classés, puis on
 * ne garde que le haut du tableau **et** la ligne du demandeur. Tronquer d'abord
 * et chercher son rang ensuite ne donnerait jamais que « tu n'y es pas ».
 */

import {
  FORTUNE_WINDOW_DAYS,
  LEADERBOARD_TOP,
  RENDEMENT_MIN_ROUNDS,
  addDays,
  isGameCode,
  parisDay,
  periodRange,
  type FortunePoint,
  type GameBreakdown,
  type GameCode,
  type Leaderboard,
  type LeaderboardMetric,
  type LeaderboardRow,
  type MotusDaily,
  type MotusDailyRow,
  type PlayerProfile,
  type StatPeriod,
} from "@maxoujeux/shared";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, rowsOf } from "../../db/index.js";
import { gameStatsDaily, stats, userAchievements, users } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";

/** Le rendement, en pour-cent, ou `null` si rien n'a été misé. */
function rendementOf(net: number, wagered: number): number | null {
  return wagered > 0 ? (net / wagered) * 100 : null;
}

function toRow(raw: Record<string, unknown>): LeaderboardRow {
  const net = Number(raw.net ?? 0);
  const wagered = Number(raw.wagered ?? 0);
  return {
    rank: Number(raw.rank ?? 0),
    userId: String(raw.user_id),
    pseudo: String(raw.pseudo),
    avatarSeed: String(raw.avatar_seed),
    net,
    wagered,
    rounds: Number(raw.rounds ?? 0),
    wins: Number(raw.wins ?? 0),
    rendement: rendementOf(net, wagered),
    bestWin: Number(raw.best_win ?? 0),
  };
}

/**
 * Classement d'une période, global ou pour un jeu.
 *
 * Une seule requête pour trois besoins : le haut du tableau, la ligne du
 * demandeur, et le nombre total de classés. Les faire en trois allers-retours
 * risquerait d'afficher un rang calculé sur un ensemble différent de celui du
 * tableau — un joueur peut terminer une manche entre deux requêtes.
 */
export async function leaderboard(
  viewerId: string,
  scope: "global" | GameCode,
  period: StatPeriod,
  metric: LeaderboardMetric,
  now = new Date(),
): Promise<Leaderboard> {
  const { from, to } = periodRange(period, now);

  // Le rendement n'est ouvert qu'aux joueurs qui ont assez joué : sans ce seuil,
  // une unique manche gagnée afficherait +500 % et coifferait tout le monde.
  const eligibility =
    metric === "rendement"
      ? sql`having sum(d.rounds) >= ${RENDEMENT_MIN_ROUNDS} and sum(d.wagered) > 0`
      : sql`having sum(d.rounds) > 0`;

  const order =
    metric === "rendement"
      ? sql`(agg.net::numeric / nullif(agg.wagered, 0)) desc nulls last, agg.net desc`
      : sql`agg.net desc`;

  const scopeFilter = scope === "global" ? sql`` : sql`and d.game = ${scope}`;

  const result = await db.execute(sql`
    with agg as (
      select
        u.id as user_id,
        u.pseudo,
        u.avatar_seed,
        coalesce(sum(d.net), 0)::bigint as net,
        coalesce(sum(d.wagered), 0)::bigint as wagered,
        coalesce(sum(d.rounds), 0)::int as rounds,
        coalesce(sum(d.wins), 0)::int as wins,
        coalesce(max(d.best_win), 0)::bigint as best_win
      from ${gameStatsDaily} d
      join ${users} u on u.id = d.user_id
      where d.day between ${from} and ${to} ${scopeFilter}
      group by u.id, u.pseudo, u.avatar_seed
      ${eligibility}
    ),
    ranked as (
      select
        agg.*,
        -- row_number et non rank : deux joueurs à zéro MaxouCoin doivent occuper
        -- deux lignes distinctes, et le pseudo tranche pour que l'ordre ne bouge
        -- pas d'un rafraîchissement à l'autre.
        row_number() over (order by ${order}, agg.pseudo asc) as rank,
        count(*) over () as total
      from agg
    )
    select * from ranked
    where rank <= ${LEADERBOARD_TOP} or user_id = ${viewerId}
    order by rank asc
  `);

  const raws = rowsOf(result);
  const all = raws.map(toRow);

  return {
    scope,
    period,
    metric,
    rows: all.filter((row) => row.rank <= LEADERBOARD_TOP),
    me: all.find((row) => row.userId === viewerId) ?? null,
    total: Number(raws[0]?.total ?? 0),
  };
}

/**
 * Profil public d'un joueur.
 *
 * Les cumuls viennent de `stats` et la courbe de `game_stats_daily` : sommer
 * trente jours pour obtenir un total « depuis toujours » obligerait à scanner
 * toute l'histoire du compte à chaque affichage.
 */
export async function playerProfile(pseudo: string, now = new Date()): Promise<PlayerProfile> {
  const [user] = await db
    .select({
      id: users.id,
      pseudo: users.pseudo,
      avatarSeed: users.avatarSeed,
      createdAt: users.createdAt,
    })
    .from(users)
    // Recherche insensible à la casse, comme l'unicité des pseudos : une adresse
    // recopiée à la main ne doit pas tomber sur une page vide.
    .where(sql`lower(${users.pseudo}) = lower(${pseudo})`)
    .limit(1);

  if (!user) {
    throw new AppError(404, "PLAYER_NOT_FOUND", "Aucun joueur de ce nom.");
  }

  const perGame = await db
    .select()
    .from(stats)
    .where(eq(stats.userId, user.id))
    .orderBy(desc(stats.net));

  const games: GameBreakdown[] = perGame
    .filter((row) => isGameCode(row.game) && row.played > 0)
    .map((row) => ({
      game: row.game as GameCode,
      rounds: row.played,
      wins: row.won,
      losses: row.lost,
      draws: row.drawn,
      wagered: row.wagered,
      net: row.net,
      bestWin: row.bestWin,
      bestTimeMs: row.bestTimeMs,
      bestAttempts: row.bestAttempts,
    }));

  const totals = games.reduce(
    (sum, game) => ({
      net: sum.net + game.net,
      wagered: sum.wagered + game.wagered,
      rounds: sum.rounds + game.rounds,
      wins: sum.wins + game.wins,
      bestWin: Math.max(sum.bestWin, game.bestWin),
    }),
    { net: 0, wagered: 0, rounds: 0, wins: 0, bestWin: 0 },
  );

  const today = parisDay(now);
  const firstDay = addDays(today, -(FORTUNE_WINDOW_DAYS - 1));

  const dailyRows = await db
    .select({
      day: gameStatsDaily.day,
      net: sql<number>`sum(${gameStatsDaily.net})::bigint`,
    })
    .from(gameStatsDaily)
    .where(
      and(
        eq(gameStatsDaily.userId, user.id),
        sql`${gameStatsDaily.day} between ${firstDay} and ${today}`,
      ),
    )
    .groupBy(gameStatsDaily.day);

  const netByDay = new Map(dailyRows.map((row) => [String(row.day), Number(row.net)]));

  // Une journée sans partie vaut zéro, et non « pas de point » : une courbe qui
  // saute les jours creux ferait paraître une semaine d'absence aussi courte
  // qu'une journée.
  let cumulative = 0;
  const fortune: FortunePoint[] = [];
  for (let index = 0; index < FORTUNE_WINDOW_DAYS; index += 1) {
    const day = addDays(firstDay, index);
    const net = netByDay.get(day) ?? 0;
    cumulative += net;
    fortune.push({ day, net, cumulative });
  }

  const [unlocked] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userAchievements)
    .where(and(eq(userAchievements.userId, user.id), isNotNull(userAchievements.unlockedAt)));

  const recent = await db
    .select({ code: userAchievements.code, unlockedAt: userAchievements.unlockedAt })
    .from(userAchievements)
    .where(and(eq(userAchievements.userId, user.id), isNotNull(userAchievements.unlockedAt)))
    .orderBy(desc(userAchievements.unlockedAt))
    .limit(6);

  return {
    userId: user.id,
    pseudo: user.pseudo,
    avatarSeed: user.avatarSeed,
    memberSince: user.createdAt.toISOString(),
    totals,
    fortune,
    games,
    achievements: {
      unlocked: Number(unlocked?.count ?? 0),
      total: 0, // renseigné par la route, à partir du catalogue partagé
      recent: recent
        .filter((row) => row.unlockedAt !== null)
        .map((row) => ({ code: row.code, unlockedAt: row.unlockedAt!.toISOString() })),
    },
  };
}

function toMotusRow(raw: Record<string, unknown>): MotusDailyRow {
  return {
    rank: Number(raw.rank ?? 0),
    userId: String(raw.user_id),
    pseudo: String(raw.pseudo),
    avatarSeed: String(raw.avatar_seed),
    attempts: Number(raw.attempts ?? 0),
    durationMs: Number(raw.duration_ms ?? 0),
    net: Number(raw.net ?? 0),
  };
}

/**
 * Le tableau des exploits Motus du jour : essais d'abord, chrono en départage.
 *
 * Une journée compte deux créneaux de douze heures : on ne retient donc que la
 * **meilleure** grille de chaque joueur, sinon un habitué occuperait à lui seul
 * les deux premières places.
 */
export async function motusDaily(viewerId: string, now = new Date()): Promise<MotusDaily> {
  const day = parisDay(now);

  const result = await db.execute(sql`
    with resolues as (
      select
        a.user_id,
        u.pseudo,
        u.avatar_seed,
        jsonb_array_length(a.guesses) as attempts,
        (extract(epoch from (a.finished_at - a.started_at)) * 1000)::bigint as duration_ms,
        (a.reward - a.stake)::bigint as net,
        row_number() over (
          partition by a.user_id
          order by jsonb_array_length(a.guesses) asc, (a.finished_at - a.started_at) asc
        ) as meilleure
      from motus_attempts a
      join ${users} u on u.id = a.user_id
      where a.solved
        and a.finished_at is not null
        -- Le fuseau est nommé : la journée de classement est celle du joueur.
        and (a.finished_at at time zone 'Europe/Paris')::date = ${day}
    ),
    ranked as (
      select
        resolues.*,
        row_number() over (order by attempts asc, duration_ms asc, pseudo asc) as rank,
        count(*) over () as total
      from resolues
      where meilleure = 1
    )
    select * from ranked
    where rank <= ${LEADERBOARD_TOP} or user_id = ${viewerId}
    order by rank asc
  `);

  const raws = rowsOf(result);
  const all = raws.map(toMotusRow);

  return {
    day,
    rows: all.filter((row) => row.rank <= LEADERBOARD_TOP),
    me: all.find((row) => row.userId === viewerId) ?? null,
    total: Number(raws[0]?.total ?? 0),
  };
}
