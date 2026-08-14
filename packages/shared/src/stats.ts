/**
 * Statistiques et classements — contrat partagé.
 *
 * Deux responsabilités, et rien d'autre :
 *
 * 1. **Les périodes.** Un classement « de la semaine » doit désigner la même
 *    semaine sur les deux rives. Les bornes sont calculées ici, en jours civils
 *    parisiens, et jamais en SQL : `date_trunc('week', …)` travaillerait dans le
 *    fuseau du serveur PostgreSQL, qui n'est pas celui des joueurs.
 * 2. **La forme des réponses.** Le front en dérive ses types, l'API s'y conforme.
 *
 * Tout ce fichier est constitué de **fonctions pures**, testables sans base.
 */

import { addDays, parisDay } from "./economy.js";
import type { GameCode } from "./games.js";

// ---------------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------------

export const STAT_PERIODS = ["day", "week", "month", "year", "all"] as const;

export type StatPeriod = (typeof STAT_PERIODS)[number];

export const STAT_PERIOD_LABELS: Record<StatPeriod, string> = {
  day: "Aujourd'hui",
  week: "Cette semaine",
  month: "Ce mois",
  year: "Cette année",
  all: "Depuis toujours",
};

/** Forme courte, pour les sélecteurs à cinq segments où la place manque. */
export const STAT_PERIOD_SHORT: Record<StatPeriod, string> = {
  day: "Jour",
  week: "Semaine",
  month: "Mois",
  year: "Année",
  all: "Toujours",
};

export function isStatPeriod(value: string): value is StatPeriod {
  return (STAT_PERIODS as readonly string[]).includes(value);
}

/**
 * Premier jour couvert par les cumuls. Antérieur à toute partie jouée, il rend
 * la période « toujours » exprimable comme un intervalle, au même titre que les
 * quatre autres — une seule requête sert alors les cinq périodes.
 */
const EPOCH_DAY = "1970-01-01";

/** Jour de la semaine d'un jour civil, lundi = 0. */
function weekday(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1));
  // `getUTCDay()` place dimanche à 0 ; la semaine française commence lundi.
  return (utc.getUTCDay() + 6) % 7;
}

export interface DayRange {
  /** Premier jour inclus, `AAAA-MM-JJ`. */
  from: string;
  /** Dernier jour inclus, `AAAA-MM-JJ`. */
  to: string;
}

/**
 * Bornes d'une période, en jours civils parisiens et **bornes incluses**.
 *
 * Semaine du lundi au dimanche, mois et année civils. Toutes les périodes
 * s'arrêtent aujourd'hui : un classement « de ce mois » qui courrait jusqu'au 31
 * afficherait des rangs figés pour des jours qui n'ont pas eu lieu.
 */
export function periodRange(period: StatPeriod, now: Date): DayRange {
  const today = parisDay(now);

  switch (period) {
    case "day":
      return { from: today, to: today };
    case "week":
      return { from: addDays(today, -weekday(today)), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
      return { from: EPOCH_DAY, to: today };
  }
}

// ---------------------------------------------------------------------------
// Classements
// ---------------------------------------------------------------------------

export const LEADERBOARD_METRICS = ["fortune", "rendement"] as const;

export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

export const LEADERBOARD_METRIC_LABELS: Record<LeaderboardMetric, string> = {
  fortune: "Fortune",
  rendement: "Rendement",
};

export const LEADERBOARD_METRIC_HINTS: Record<LeaderboardMetric, string> = {
  fortune: "Ce que tu as gagné, tout compte fait.",
  rendement: "Ce que tu as gagné rapporté à ce que tu as risqué.",
};

export function isLeaderboardMetric(value: string): value is LeaderboardMetric {
  return (LEADERBOARD_METRICS as readonly string[]).includes(value);
}

/**
 * Manches minimales pour figurer au classement du rendement.
 *
 * Sans ce seuil, un joueur qui gagne sa première et unique manche afficherait un
 * rendement de +500 % et coifferait tout le monde. Le classement du rendement ne
 * récompense pas la chance d'un soir, mais la régularité.
 */
export const RENDEMENT_MIN_ROUNDS = 20;

/** Taille du haut de tableau renvoyé par l'API. */
export const LEADERBOARD_TOP = 20;

export interface LeaderboardRow {
  rank: number;
  userId: string;
  pseudo: string;
  avatarSeed: string;
  /** Net en MaxouCoin sur la période : encaissé moins misé. */
  net: number;
  wagered: number;
  rounds: number;
  wins: number;
  /**
   * Net rapporté au total misé, en pour-cent. `null` quand rien n'a été misé —
   * une division par zéro n'a pas de rang.
   */
  rendement: number | null;
  /** Meilleur gain net sur une seule manche de la période. */
  bestWin: number;
}

/**
 * Réponse de tout classement du site.
 *
 * `me` est renvoyé **même lorsque le joueur ne figure pas dans `rows`** : c'est
 * ce qui permet à l'écran d'épingler sa ligne et de lui annoncer « 87e sur 143 »
 * plutôt que de le laisser chercher son pseudo dans une liste où il n'est pas.
 * Le rang vient du serveur, jamais d'un calcul côté client sur un top tronqué.
 */
export interface Leaderboard {
  scope: "global" | GameCode;
  period: StatPeriod;
  metric: LeaderboardMetric;
  rows: LeaderboardRow[];
  me: LeaderboardRow | null;
  /** Nombre de joueurs classés sur la période, `me` compris. */
  total: number;
}

/** `1er`, `2e`, `87e`. */
export function formatRank(rank: number): string {
  return rank === 1 ? "1er" : `${rank}e`;
}

/** `+38 %`, `−12 %`, `—` quand rien n'a été misé. */
export function formatRendement(value: number | null): string {
  if (value === null) return "—";
  const rounded = Math.round(value);
  return `${rounded < 0 ? "−" : "+"}${Math.abs(rounded)} %`;
}

// ---------------------------------------------------------------------------
// Profils
// ---------------------------------------------------------------------------

/** Une journée de la courbe de fortune. */
export interface FortunePoint {
  day: string;
  /** Net du jour. */
  net: number;
  /** Net cumulé depuis le début de la fenêtre affichée. */
  cumulative: number;
}

/** Longueur de la courbe affichée sur un profil. */
export const FORTUNE_WINDOW_DAYS = 30;

/** Une ligne de la répartition par jeu. */
export interface GameBreakdown {
  game: GameCode;
  rounds: number;
  wins: number;
  losses: number;
  draws: number;
  wagered: number;
  net: number;
  bestWin: number;
  /** Meilleur temps Motus, en millisecondes. Absent partout ailleurs. */
  bestTimeMs: number | null;
  /** Meilleur nombre d'essais Motus. Absent partout ailleurs. */
  bestAttempts: number | null;
}

export interface PlayerProfile {
  userId: string;
  pseudo: string;
  avatarSeed: string;
  memberSince: string;
  /** Cumuls depuis toujours, tous jeux confondus. */
  totals: {
    net: number;
    wagered: number;
    rounds: number;
    wins: number;
    bestWin: number;
  };
  /** Courbe des trente derniers jours, un point par jour, trous compris. */
  fortune: FortunePoint[];
  /** Un poste par jeu joué au moins une fois, du plus rentable au moins rentable. */
  games: GameBreakdown[];
  achievements: {
    unlocked: number;
    total: number;
    /** Les derniers débloqués, pour la vitrine du profil. */
    recent: { code: string; unlockedAt: string }[];
  };
}

// ---------------------------------------------------------------------------
// Motus — le classement du chrono
// ---------------------------------------------------------------------------

export interface MotusDailyRow {
  rank: number;
  userId: string;
  pseudo: string;
  avatarSeed: string;
  attempts: number;
  durationMs: number;
  net: number;
}

export interface MotusDaily {
  day: string;
  rows: MotusDailyRow[];
  me: MotusDailyRow | null;
  total: number;
}

/**
 * Ordre du classement Motus : les essais d'abord, le chrono ne départage que les
 * ex æquo. Trouver le mot en deux coups en réfléchissant une minute vaut mieux
 * que le trouver en cinq coups à toute vitesse.
 *
 * Exposé comme fonction pure pour que le front puisse trier une liste reçue sans
 * réinventer la règle — et pour qu'elle soit testable des deux côtés.
 */
export function compareMotusPerformance(
  a: { attempts: number; durationMs: number },
  b: { attempts: number; durationMs: number },
): number {
  return a.attempts - b.attempts || a.durationMs - b.durationMs;
}

/** `1 min 42 s`, `48 s`. Le chrono Motus dépasse rarement le quart d'heure. */
export function formatChrono(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} s`;
  return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}
