/**
 * Enregistrement des manches, progression des succès.
 *
 * Point de passage **unique** de tout ce qui alimente les classements, sur le
 * modèle du service de porte-monnaie : aucun jeu ne doit écrire lui-même dans
 * `stats`, `game_stats_daily` ou `user_achievements`.
 *
 * Deux règles gouvernent ce fichier :
 *
 * 1. **Tous les compteurs sont incrémentés en SQL.** Jamais de lecture, calcul,
 *    puis écriture : deux manches qui se terminent au même instant s'écraseraient
 *    l'une l'autre. `greatest` et `least` valent de même pour les records.
 * 2. **La prime d'un succès se verse une fois et une seule.** La condition est
 *    *dans* l'UPDATE, comme le débit du porte-monnaie : zéro ligne renvoyée
 *    signifie déjà débloqué, donc aucun MaxouCoin versé.
 */

import {
  achievementReward,
  evaluateAchievements,
  evaluateDailyStreak,
  getAchievement,
  parisDay,
  parisHour,
  type AchievementProgress,
  type GameCode,
  type RoundFlag,
} from "@maxoujeux/shared";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { gameStatsDaily, stats, userAchievements, wallets } from "../../db/schema.js";
import { notifyAchievements, notifyWallet } from "../../realtime/notify.js";
import { creditInTx, type Executor } from "../wallet/service.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type RoundOutcome = "win" | "loss" | "draw";

export interface RoundInput {
  userId: string;
  game: GameCode;
  /** MaxouCoin engagés sur la manche, mises additionnelles comprises. */
  wagered: number;
  /** MaxouCoin récupérés, mise comprise. Un remboursement compte ici. */
  returned: number;
  outcome: RoundOutcome;
  /** Essais consommés au Motus. Ignoré ailleurs. */
  attempts?: number | null;
  /** Durée de la manche, en millisecondes. */
  durationMs?: number | null;
  /** Coups d'éclat qu'aucun cumul ne permet de deviner. */
  flags?: readonly RoundFlag[];
  at?: Date;
}

/**
 * Ce qu'il reste à diffuser **une fois la transaction validée**.
 *
 * Rien n'est envoyé depuis l'intérieur : un succès annoncé puis annulé par un
 * rollback serait pire que pas d'annonce du tout.
 */
export interface RoundReceipt {
  userId: string;
  unlocked: string[];
  /** Nouveau solde, non nul seulement si une prime a été versée. */
  balance: number | null;
}

const EMPTY_RECEIPT = (userId: string): RoundReceipt => ({ userId, unlocked: [], balance: null });

/**
 * Verdict d'une manche de casino, lu sur l'argent seul.
 *
 * Il n'y a pas d'adversaire à battre à la roue, au Plinko ou à la machine : la
 * seule question est de savoir si le joueur ressort avec plus qu'il n'a engagé.
 * Récupérer exactement sa mise — un ×1 à la roue, une égalité au blackjack —
 * n'est ni une victoire ni une défaite.
 */
export function casinoOutcome(wagered: number, returned: number): RoundOutcome {
  if (returned > wagered) return "win";
  if (returned === wagered) return "draw";
  return "loss";
}

/**
 * Enregistre une manche terminée et fait progresser les succès qu'elle touche.
 *
 * À appeler **dans la transaction de règlement du jeu, après les mouvements de
 * porte-monnaie** : le solde lu ici sert au succès du coffre bien garni, et le
 * net doit correspondre à ce que le joueur a réellement encaissé.
 *
 * @returns de quoi notifier le joueur après le commit
 */
export async function recordRoundInTx(
  tx: Transaction,
  input: RoundInput,
): Promise<RoundReceipt> {
  const at = input.at ?? new Date();
  const day = parisDay(at);
  const net = input.returned - input.wagered;
  const won = input.outcome === "win";
  const flags = input.flags ?? [];

  // Un record ne se retient que sur une manche gagnée : perdre au sixième essai
  // ne doit pas inscrire « 6 essais » comme meilleure performance.
  const attempts = won ? (input.attempts ?? null) : null;
  const bestTimeMs = won ? (input.durationMs ?? null) : null;
  // Le meilleur coup est un **gain** : une manche perdue ne concourt pas.
  const bestWin = Math.max(0, net);

  await tx
    .insert(gameStatsDaily)
    .values({
      userId: input.userId,
      game: input.game,
      day,
      rounds: 1,
      wins: won ? 1 : 0,
      losses: input.outcome === "loss" ? 1 : 0,
      draws: input.outcome === "draw" ? 1 : 0,
      wagered: input.wagered,
      returned: input.returned,
      net,
      bestWin,
      durationMs: input.durationMs ?? 0,
      bestTimeMs,
      bestAttempts: attempts,
    })
    .onConflictDoUpdate({
      target: [gameStatsDaily.userId, gameStatsDaily.game, gameStatsDaily.day],
      set: {
        rounds: sql`${gameStatsDaily.rounds} + 1`,
        wins: sql`${gameStatsDaily.wins} + ${won ? 1 : 0}`,
        losses: sql`${gameStatsDaily.losses} + ${input.outcome === "loss" ? 1 : 0}`,
        draws: sql`${gameStatsDaily.draws} + ${input.outcome === "draw" ? 1 : 0}`,
        wagered: sql`${gameStatsDaily.wagered} + ${input.wagered}`,
        returned: sql`${gameStatsDaily.returned} + ${input.returned}`,
        net: sql`${gameStatsDaily.net} + ${net}`,
        bestWin: sql`greatest(${gameStatsDaily.bestWin}, ${bestWin})`,
        durationMs: sql`${gameStatsDaily.durationMs} + ${input.durationMs ?? 0}`,
        // `least` et `greatest` ignorent les NULL : le premier record s'inscrit
        // sans cas particulier, et une manche sans chrono ne l'efface pas.
        bestTimeMs: sql`least(${gameStatsDaily.bestTimeMs}, ${bestTimeMs})`,
        bestAttempts: sql`least(${gameStatsDaily.bestAttempts}, ${attempts})`,
      },
    });

  const [totals] = await tx
    .insert(stats)
    .values({
      userId: input.userId,
      game: input.game,
      played: 1,
      won: won ? 1 : 0,
      lost: input.outcome === "loss" ? 1 : 0,
      drawn: input.outcome === "draw" ? 1 : 0,
      wagered: input.wagered,
      returned: input.returned,
      net,
      bestWin,
      winStreak: won ? 1 : 0,
      bestWinStreak: won ? 1 : 0,
      bestTimeMs,
      bestAttempts: attempts,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [stats.userId, stats.game],
      set: {
        played: sql`${stats.played} + 1`,
        won: sql`${stats.won} + ${won ? 1 : 0}`,
        lost: sql`${stats.lost} + ${input.outcome === "loss" ? 1 : 0}`,
        drawn: sql`${stats.drawn} + ${input.outcome === "draw" ? 1 : 0}`,
        wagered: sql`${stats.wagered} + ${input.wagered}`,
        returned: sql`${stats.returned} + ${input.returned}`,
        net: sql`${stats.net} + ${net}`,
        bestWin: sql`greatest(${stats.bestWin}, ${bestWin})`,
        // Une défaite ou une égalité rompt la série. Le record, lui, reste.
        winStreak: won ? sql`${stats.winStreak} + 1` : sql`0`,
        bestWinStreak: won
          ? sql`greatest(${stats.bestWinStreak}, ${stats.winStreak} + 1)`
          : sql`${stats.bestWinStreak}`,
        bestTimeMs: sql`least(${stats.bestTimeMs}, ${bestTimeMs})`,
        bestAttempts: sql`least(${stats.bestAttempts}, ${attempts})`,
        updatedAt: at,
      },
    })
    .returning();

  if (!totals) {
    // L'upsert renvoie toujours sa ligne ; l'absence trahirait un bug de pilote.
    throw new Error(`Cumuls introuvables après enregistrement : ${input.userId} / ${input.game}`);
  }

  const [overall] = await tx
    .select({
      rounds: sql<number>`coalesce(sum(${stats.played}), 0)::int`,
      wins: sql<number>`coalesce(sum(${stats.won}), 0)::int`,
      net: sql<number>`coalesce(sum(${stats.net}), 0)::bigint`,
      wagered: sql<number>`coalesce(sum(${stats.wagered}), 0)::bigint`,
      bestWin: sql<number>`coalesce(max(${stats.bestWin}), 0)::bigint`,
      gamesPlayed: sql<number>`count(*) filter (where ${stats.played} > 0)::int`,
      gamesWon: sql<number>`count(*) filter (where ${stats.won} > 0)::int`,
    })
    .from(stats)
    .where(eq(stats.userId, input.userId));

  const [wallet] = await tx
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.userId, input.userId))
    .limit(1);

  const progress = evaluateAchievements({
    game: input.game,
    round: {
      net,
      outcome: input.outcome,
      attempts: input.attempts ?? null,
      durationMs: input.durationMs ?? null,
      hour: parisHour(at),
    },
    flags,
    gameTotals: {
      rounds: totals.played,
      wins: totals.won,
      net: totals.net,
      wagered: totals.wagered,
      bestWin: totals.bestWin,
      winStreak: totals.winStreak,
    },
    overall: {
      rounds: Number(overall?.rounds ?? 0),
      wins: Number(overall?.wins ?? 0),
      net: Number(overall?.net ?? 0),
      wagered: Number(overall?.wagered ?? 0),
      bestWin: Number(overall?.bestWin ?? 0),
      gamesPlayed: Number(overall?.gamesPlayed ?? 0),
      gamesWon: Number(overall?.gamesWon ?? 0),
    },
    balance: wallet?.balance ?? 0,
  });

  return applyProgressInTx(tx, input.userId, progress, at);
}

/**
 * Fait avancer une liste de succès et débloque ceux qui atteignent leur palier.
 *
 * La progression enregistrée est le **maximum jamais atteint** : une évaluation
 * rejouée, ou arrivée dans le désordre après une reprise, ne fait jamais reculer
 * une barre ni compter deux fois.
 */
async function applyProgressInTx(
  tx: Transaction,
  userId: string,
  progress: AchievementProgress[],
  at: Date,
): Promise<RoundReceipt> {
  if (progress.length === 0) return EMPTY_RECEIPT(userId);

  const rows = await tx
    .insert(userAchievements)
    .values(progress.map((entry) => ({ userId, code: entry.code, progress: entry.progress })))
    .onConflictDoUpdate({
      target: [userAchievements.userId, userAchievements.code],
      set: {
        progress: sql`greatest(${userAchievements.progress}, excluded.progress)`,
      },
    })
    .returning({
      code: userAchievements.code,
      progress: userAchievements.progress,
      unlockedAt: userAchievements.unlockedAt,
    });

  const candidates = rows
    .filter((row) => row.unlockedAt === null)
    .filter((row) => {
      const achievement = getAchievement(row.code);
      return achievement !== undefined && row.progress >= achievement.goal;
    })
    .map((row) => row.code);

  if (candidates.length === 0) return EMPTY_RECEIPT(userId);

  // `unlocked_at is null` **dans** la clause WHERE : deux manches simultanées qui
  // franchissent le même palier ne peuvent pas verser deux fois la prime. Celle
  // qui arrive seconde ne récupère aucune ligne.
  const unlocked = await tx
    .update(userAchievements)
    .set({ unlockedAt: at })
    .where(
      and(
        eq(userAchievements.userId, userId),
        inArray(userAchievements.code, candidates),
        sql`${userAchievements.unlockedAt} is null`,
      ),
    )
    .returning({ code: userAchievements.code });

  let balance: number | null = null;
  for (const { code } of unlocked) {
    const reward = achievementReward(code);
    // Une ligne de journal par succès : « +2 500 MC — Succès débloqué » se relit,
    // un total fusionné ne se relie à rien.
    if (reward > 0) balance = await creditInTx(tx, userId, reward, "achievement_reward");
  }

  return { userId, unlocked: unlocked.map((row) => row.code), balance };
}

/**
 * Diffuse un reçu de manche. À appeler **après** la validation de la transaction.
 *
 * Tolère un reçu vide : les jeux peuvent l'appeler systématiquement sans avoir à
 * tester si un succès est tombé.
 */
export function publishRoundReceipt(receipt: RoundReceipt | null | undefined): void {
  if (!receipt || receipt.unlocked.length === 0) return;
  if (receipt.balance !== null) notifyWallet(receipt.userId, receipt.balance);
  notifyAchievements(receipt.userId, receipt.unlocked);
}

/**
 * Succès d'assiduité, à l'encaissement du bonus quotidien.
 *
 * Hors de la transaction du bonus, et volontairement : le service de statistiques
 * dépend du porte-monnaie, l'inverse créerait un cycle d'imports. La perte d'un
 * déblocage sur un plantage entre les deux se rattrape d'elle-même — la
 * progression étant le maximum atteint, le lendemain la réévalue avec la série
 * courante.
 */
export async function recordDailyStreak(
  userId: string,
  streak: number,
  at = new Date(),
): Promise<void> {
  const progress = evaluateDailyStreak(streak);
  if (progress.length === 0) return;

  const receipt = await db.transaction((tx) => applyProgressInTx(tx, userId, progress, at));
  publishRoundReceipt(receipt);
}

/** État des succès d'un joueur, catalogue compris. Lecture seule. */
export async function achievementStates(
  exec: Executor,
  userId: string,
): Promise<{ code: string; progress: number; unlockedAt: Date | null }[]> {
  return exec
    .select({
      code: userAchievements.code,
      progress: userAchievements.progress,
      unlockedAt: userAchievements.unlockedAt,
    })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));
}

/** Nombre de succès débloqués, pour les tuiles de profil. */
export async function unlockedCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userAchievements)
    .where(and(eq(userAchievements.userId, userId), isNotNull(userAchievements.unlockedAt)));
  return Number(row?.count ?? 0);
}
