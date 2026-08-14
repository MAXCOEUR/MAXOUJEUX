/**
 * Succès — catalogue et évaluation.
 *
 * Le catalogue est une **donnée**, l'évaluation une **fonction pure** : aucune
 * I/O, aucun accès à la base. C'est ce qui permet de vérifier qu'un succès se
 * déclenche au bon moment sans lancer de serveur, et au front d'afficher la même
 * progression que celle calculée par l'API sans la recalculer autrement.
 *
 * Le service `modules/stats` se charge de la partie qui n'est pas pure : lire les
 * cumuls, écrire la progression, verser la prime une seule fois.
 */

import type { GameCode } from "./games.js";

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const ACHIEVEMENT_TIERS = ["bronze", "argent", "or"] as const;

export type AchievementTier = (typeof ACHIEVEMENT_TIERS)[number];

/**
 * Prime versée au déblocage, en MaxouCoin.
 *
 * Un succès d'or vaut cinq jours de bonus quotidien plafonné : assez pour donner
 * envie de le chasser, pas assez pour remplacer le fait de jouer. Le catalogue
 * complet représente environ 157 500 MC, étalés sur des mois de pratique.
 */
export const ACHIEVEMENT_REWARDS: Record<AchievementTier, number> = {
  bronze: 500,
  argent: 2_500,
  or: 10_000,
};

export const ACHIEVEMENT_TIER_LABELS: Record<AchievementTier, string> = {
  bronze: "Bronze",
  argent: "Argent",
  or: "Or",
};

export const ACHIEVEMENT_CATEGORIES = ["Fortune", "Assiduité", "Adresse", "Panache"] as const;

export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export const ACHIEVEMENT_CATEGORY_HINTS: Record<AchievementCategory, string> = {
  Fortune: "Ce que tu amasses.",
  Assiduité: "Ce que tu répètes.",
  Adresse: "Ce que tu maîtrises.",
  Panache: "Ce qui n'arrive presque jamais.",
};

export interface Achievement {
  code: string;
  name: string;
  description: string;
  tier: AchievementTier;
  category: AchievementCategory;
  /** Jeu concerné, ou `null` pour un succès transversal. */
  game: GameCode | null;
  /**
   * Palier à atteindre. `1` désigne un succès ponctuel — il n'a pas de barre de
   * progression, il tombe ou il ne tombe pas.
   */
  goal: number;
  /**
   * L'objectif se lit-il en MaxouCoin ?
   *
   * Sert au seul affichage : « 47 000 / 100 000 MC » plutôt que « 47000 / 100000 ».
   */
  coins?: boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  // --- Fortune ------------------------------------------------------------
  {
    code: "premier_gain",
    name: "Première pièce",
    description: "Remporter une première manche, quelle qu'elle soit.",
    tier: "bronze",
    category: "Fortune",
    game: null,
    goal: 1,
  },
  {
    code: "fortune_10k",
    name: "Petite cagnotte",
    description: "Atteindre 10 000 MaxouCoin de gains nets, tous jeux confondus.",
    tier: "bronze",
    category: "Fortune",
    game: null,
    goal: 10_000,
    coins: true,
  },
  {
    code: "fortune_100k",
    name: "Beau matelas",
    description: "Atteindre 100 000 MaxouCoin de gains nets.",
    tier: "argent",
    category: "Fortune",
    game: null,
    goal: 100_000,
    coins: true,
  },
  {
    code: "fortune_1m",
    name: "Millionnaire",
    description: "Atteindre 1 000 000 de MaxouCoin de gains nets.",
    tier: "or",
    category: "Fortune",
    game: null,
    goal: 1_000_000,
    coins: true,
  },
  {
    code: "mise_100k",
    name: "Joueur régulier",
    description: "Avoir misé 100 000 MaxouCoin en tout.",
    tier: "bronze",
    category: "Fortune",
    game: null,
    goal: 100_000,
    coins: true,
  },
  {
    code: "mise_1m",
    name: "Gros bras",
    description: "Avoir misé 1 000 000 de MaxouCoin en tout.",
    tier: "argent",
    category: "Fortune",
    game: null,
    goal: 1_000_000,
    coins: true,
  },
  {
    code: "mise_10m",
    name: "Pilier du casino",
    description: "Avoir misé 10 000 000 de MaxouCoin en tout.",
    tier: "or",
    category: "Fortune",
    game: null,
    goal: 10_000_000,
    coins: true,
  },
  {
    code: "coup_1000",
    name: "Joli coup",
    description: "Gagner 1 000 MaxouCoin sur une seule manche.",
    tier: "bronze",
    category: "Fortune",
    game: null,
    goal: 1,
  },
  {
    code: "coup_10000",
    name: "Coup fumant",
    description: "Gagner 10 000 MaxouCoin sur une seule manche.",
    tier: "argent",
    category: "Fortune",
    game: null,
    goal: 1,
  },
  {
    code: "coup_50000",
    name: "Briseur de banque",
    description: "Gagner 50 000 MaxouCoin sur une seule manche.",
    tier: "or",
    category: "Fortune",
    game: null,
    goal: 1,
  },
  {
    code: "magot_100k",
    name: "Coffre bien garni",
    description: "Voir son solde franchir 100 000 MaxouCoin.",
    tier: "argent",
    category: "Fortune",
    game: null,
    goal: 1,
  },

  // --- Assiduité ----------------------------------------------------------
  {
    code: "serie_3",
    name: "Trois jours de suite",
    description: "Encaisser le bonus quotidien trois jours d'affilée.",
    tier: "bronze",
    category: "Assiduité",
    game: null,
    goal: 3,
  },
  {
    code: "serie_7",
    name: "Une semaine pleine",
    description: "Encaisser le bonus quotidien sept jours d'affilée.",
    tier: "bronze",
    category: "Assiduité",
    game: null,
    goal: 7,
  },
  {
    code: "serie_30",
    name: "Un mois sans faillir",
    description: "Encaisser le bonus quotidien trente jours d'affilée.",
    tier: "argent",
    category: "Assiduité",
    game: null,
    goal: 30,
  },
  {
    code: "serie_100",
    name: "Increvable",
    description: "Encaisser le bonus quotidien cent jours d'affilée.",
    tier: "or",
    category: "Assiduité",
    game: null,
    goal: 100,
  },
  {
    code: "manches_100",
    name: "Cent manches",
    description: "Jouer cent manches, tous jeux confondus.",
    tier: "bronze",
    category: "Assiduité",
    game: null,
    goal: 100,
  },
  {
    code: "manches_1000",
    name: "Mille manches",
    description: "Jouer mille manches, tous jeux confondus.",
    tier: "argent",
    category: "Assiduité",
    game: null,
    goal: 1_000,
  },
  {
    code: "manches_10000",
    name: "Dix mille manches",
    description: "Jouer dix mille manches, tous jeux confondus.",
    tier: "or",
    category: "Assiduité",
    game: null,
    goal: 10_000,
  },
  {
    code: "touche_a_tout",
    name: "Touche-à-tout",
    description: "Jouer au moins une manche sur chacun des neuf jeux.",
    tier: "argent",
    category: "Assiduité",
    game: null,
    goal: 9,
  },
  {
    code: "grand_chelem",
    name: "Grand chelem",
    description: "Gagner au moins une manche sur chacun des neuf jeux.",
    tier: "or",
    category: "Assiduité",
    game: null,
    goal: 9,
  },

  // --- Adresse ------------------------------------------------------------
  {
    code: "motus_premier",
    name: "Premier mot",
    description: "Trouver un mot au Motus.",
    tier: "bronze",
    category: "Adresse",
    game: "motus",
    goal: 1,
  },
  {
    code: "motus_10",
    name: "Bon lecteur",
    description: "Trouver dix mots au Motus.",
    tier: "bronze",
    category: "Adresse",
    game: "motus",
    goal: 10,
  },
  {
    code: "motus_100",
    name: "Dictionnaire vivant",
    description: "Trouver cent mots au Motus.",
    tier: "argent",
    category: "Adresse",
    game: "motus",
    goal: 100,
  },
  {
    code: "motus_eclair",
    name: "Éclair",
    description: "Trouver un mot au Motus en moins de trente secondes.",
    tier: "argent",
    category: "Adresse",
    game: "motus",
    goal: 1,
  },
  {
    code: "motus_un_essai",
    name: "Du premier coup",
    description: "Trouver le mot du Motus dès la première proposition.",
    tier: "or",
    category: "Adresse",
    game: "motus",
    goal: 1,
  },
  {
    code: "connect4_10",
    name: "Quatre à la suite",
    description: "Gagner dix parties de Puissance 4.",
    tier: "bronze",
    category: "Adresse",
    game: "connect4",
    goal: 10,
  },
  {
    code: "connect4_100",
    name: "Maître de la grille",
    description: "Gagner cent parties de Puissance 4.",
    tier: "argent",
    category: "Adresse",
    game: "connect4",
    goal: 100,
  },
  {
    code: "tictactoe_10",
    name: "Trois d'affilée",
    description: "Gagner dix parties de Morpion.",
    tier: "bronze",
    category: "Adresse",
    game: "tictactoe",
    goal: 10,
  },
  {
    code: "tictactoe_100",
    name: "Roi du morpion",
    description: "Gagner cent parties de Morpion.",
    tier: "argent",
    category: "Adresse",
    game: "tictactoe",
    goal: 100,
  },
  {
    code: "blackjack_naturel",
    name: "Naturel",
    description: "Toucher un blackjack servi.",
    tier: "bronze",
    category: "Adresse",
    game: "blackjack",
    goal: 1,
  },
  {
    code: "blackjack_100",
    name: "Compteur de cartes",
    description: "Gagner cent mains de blackjack.",
    tier: "argent",
    category: "Adresse",
    game: "blackjack",
    goal: 100,
  },
  // Au poker, une manche est une **session de table** : de la cave à la sortie,
  // rebuys compris. C'est la seule borne où les jetons redeviennent des
  // MaxouCoin — et c'est aussi ce que le joueur vit comme une partie.
  {
    code: "poker_10",
    name: "Premiers pots",
    description: "Quitter dix fois une table de poker avec plus qu'en arrivant.",
    tier: "bronze",
    category: "Adresse",
    game: "poker",
    goal: 10,
  },
  {
    code: "poker_100",
    name: "Requin",
    description: "Quitter cinquante fois une table de poker avec plus qu'en arrivant.",
    tier: "argent",
    category: "Adresse",
    game: "poker",
    goal: 50,
  },
  {
    code: "poker_carre",
    name: "Carré",
    description: "Abattre un carré au Texas Hold'em.",
    tier: "argent",
    category: "Adresse",
    game: "poker",
    goal: 1,
  },
  {
    code: "poker_quinte_flush",
    name: "Quinte flush",
    description: "Abattre une quinte flush au Texas Hold'em.",
    tier: "or",
    category: "Adresse",
    game: "poker",
    goal: 1,
  },

  // --- Panache ------------------------------------------------------------
  {
    code: "serie_5_victoires",
    name: "En forme",
    description: "Enchaîner cinq victoires sur un même jeu.",
    tier: "bronze",
    category: "Panache",
    game: null,
    goal: 5,
  },
  {
    code: "serie_10_victoires",
    name: "Intouchable",
    description: "Enchaîner dix victoires sur un même jeu.",
    tier: "argent",
    category: "Panache",
    game: null,
    goal: 10,
  },
  {
    code: "roulette_plein",
    name: "Plein",
    description: "Toucher un numéro plein à la roulette.",
    tier: "argent",
    category: "Panache",
    game: "roulette",
    goal: 1,
  },
  {
    code: "plinko_max",
    name: "Pile au bord",
    description: "Faire tomber la bille dans une fente extrême du Plinko.",
    tier: "or",
    category: "Panache",
    game: "plinko",
    goal: 1,
  },
  {
    code: "slots_maxou",
    name: "MAXOU MAXOU MAXOU",
    description: "Aligner les trois MAXOU de la machine à sous.",
    tier: "or",
    category: "Panache",
    game: "slots",
    goal: 1,
  },
  {
    code: "wheel_max",
    name: "Le gros lot",
    description: "Décrocher le meilleur secteur de la roue de la fortune.",
    tier: "or",
    category: "Panache",
    game: "wheel",
    goal: 1,
  },
  {
    code: "nuit_blanche",
    name: "Nuit blanche",
    description: "Jouer une manche entre deux et cinq heures du matin.",
    tier: "bronze",
    category: "Panache",
    game: null,
    goal: 1,
  },
] as const;

const BY_CODE = new Map(ACHIEVEMENTS.map((a) => [a.code, a]));

export function getAchievement(code: string): Achievement | undefined {
  return BY_CODE.get(code);
}

/** Prime d'un succès. Zéro pour un code inconnu, plutôt qu'une exception. */
export function achievementReward(code: string): number {
  const achievement = BY_CODE.get(code);
  return achievement ? ACHIEVEMENT_REWARDS[achievement.tier] : 0;
}

// ---------------------------------------------------------------------------
// Évaluation
// ---------------------------------------------------------------------------

/**
 * Coups d'éclat qu'aucun cumul ne permet de deviner.
 *
 * Un `net` de 25 fois la mise ne dit pas si la bille est tombée dans la fente
 * extrême ou si le joueur avait misé gros ailleurs. Ces événements-là sont donc
 * signalés par le jeu lui-même, au moment où il les constate.
 */
export const ROUND_FLAGS = [
  "motus_first_guess",
  "blackjack_natural",
  "roulette_straight_up",
  "plinko_max",
  "slots_jackpot",
  "wheel_max",
  "poker_quads",
  "poker_straight_flush",
] as const;

export type RoundFlag = (typeof ROUND_FLAGS)[number];

/** Cumuls d'un joueur, sur un jeu ou sur l'ensemble. */
export interface AchievementTotals {
  rounds: number;
  wins: number;
  /** Net cumulé. Peut être négatif : on ne gagne pas toujours. */
  net: number;
  wagered: number;
  bestWin: number;
  /** Victoires consécutives en cours. */
  winStreak: number;
}

export interface AchievementContext {
  game: GameCode;
  round: {
    net: number;
    outcome: "win" | "loss" | "draw";
    /** Essais consommés au Motus. */
    attempts: number | null;
    /** Durée de la manche, en millisecondes. */
    durationMs: number | null;
    /** Heure civile parisienne de la manche, de 0 à 23. */
    hour: number;
  };
  flags: readonly RoundFlag[];
  /** Cumuls du jeu concerné, **après** enregistrement de la manche. */
  gameTotals: AchievementTotals;
  /**
   * Cumuls tous jeux confondus, après enregistrement de la manche.
   *
   * Sans série de victoires : une série ne se compte que jeu par jeu, alterner
   * morpion et Plinko ne construit pas dix victoires d'affilée.
   */
  overall: Omit<AchievementTotals, "winStreak"> & {
    /** Nombre de jeux distincts joués au moins une fois. */
    gamesPlayed: number;
    /** Nombre de jeux distincts gagnés au moins une fois. */
    gamesWon: number;
  };
  /** Solde du porte-monnaie après la manche. */
  balance: number;
}

export interface AchievementProgress {
  code: string;
  /**
   * Avancement **absolu**, pas un incrément.
   *
   * Le service ne conserve que le maximum jamais atteint : une évaluation rejouée
   * deux fois, ou dans le désordre après une reprise, ne fait donc jamais reculer
   * ni double-compter une progression.
   */
  progress: number;
}

/** `1` quand la condition est remplie, `0` sinon. Lisibilité des succès ponctuels. */
function hit(condition: boolean): number {
  return condition ? 1 : 0;
}

/**
 * Progression de chaque succès concerné par une manche.
 *
 * Ne renvoie que les succès touchés : inutile de réécrire quarante lignes en base
 * à chaque coup joué.
 */
export function evaluateAchievements(context: AchievementContext): AchievementProgress[] {
  const { game, round, flags, gameTotals, overall, balance } = context;
  const has = (flag: RoundFlag) => flags.includes(flag);
  const progress: AchievementProgress[] = [];
  const add = (code: string, value: number) => {
    if (value > 0) progress.push({ code, progress: value });
  };

  // --- Fortune ------------------------------------------------------------
  add("premier_gain", hit(overall.wins > 0));
  add("fortune_10k", Math.max(0, overall.net));
  add("fortune_100k", Math.max(0, overall.net));
  add("fortune_1m", Math.max(0, overall.net));
  add("mise_100k", overall.wagered);
  add("mise_1m", overall.wagered);
  add("mise_10m", overall.wagered);
  add("coup_1000", hit(overall.bestWin >= 1_000));
  add("coup_10000", hit(overall.bestWin >= 10_000));
  add("coup_50000", hit(overall.bestWin >= 50_000));
  add("magot_100k", hit(balance >= 100_000));

  // --- Assiduité ----------------------------------------------------------
  add("manches_100", overall.rounds);
  add("manches_1000", overall.rounds);
  add("manches_10000", overall.rounds);
  add("touche_a_tout", overall.gamesPlayed);
  add("grand_chelem", overall.gamesWon);

  // --- Panache ------------------------------------------------------------
  // La série se mesure jeu par jeu : alterner morpion et Plinko ne construit pas
  // une série de dix victoires.
  add("serie_5_victoires", gameTotals.winStreak);
  add("serie_10_victoires", gameTotals.winStreak);
  add("nuit_blanche", hit(round.hour >= 2 && round.hour < 5));
  add("roulette_plein", hit(has("roulette_straight_up")));
  add("plinko_max", hit(has("plinko_max")));
  add("slots_maxou", hit(has("slots_jackpot")));
  add("wheel_max", hit(has("wheel_max")));

  // --- Adresse, par jeu ---------------------------------------------------
  switch (game) {
    case "motus":
      add("motus_premier", gameTotals.wins);
      add("motus_10", gameTotals.wins);
      add("motus_100", gameTotals.wins);
      add(
        "motus_eclair",
        hit(round.outcome === "win" && round.durationMs !== null && round.durationMs < 30_000),
      );
      add("motus_un_essai", hit(has("motus_first_guess")));
      break;
    case "connect4":
      add("connect4_10", gameTotals.wins);
      add("connect4_100", gameTotals.wins);
      break;
    case "tictactoe":
      add("tictactoe_10", gameTotals.wins);
      add("tictactoe_100", gameTotals.wins);
      break;
    case "blackjack":
      add("blackjack_naturel", hit(has("blackjack_natural")));
      add("blackjack_100", gameTotals.wins);
      break;
    case "poker":
      add("poker_10", gameTotals.wins);
      add("poker_100", gameTotals.wins);
      add("poker_carre", hit(has("poker_quads")));
      add("poker_quinte_flush", hit(has("poker_straight_flush")));
      break;
    default:
      break;
  }

  return progress;
}

/**
 * Progression des succès d'assiduité, à l'encaissement du bonus quotidien.
 *
 * Évaluée à part : la série de jours ne dépend d'aucune manche, et un joueur qui
 * revient chaque jour sans jouer la mérite tout autant.
 */
export function evaluateDailyStreak(streak: number): AchievementProgress[] {
  if (streak <= 0) return [];
  return [
    { code: "serie_3", progress: streak },
    { code: "serie_7", progress: streak },
    { code: "serie_30", progress: streak },
    { code: "serie_100", progress: streak },
  ];
}

// ---------------------------------------------------------------------------
// Contrat d'API
// ---------------------------------------------------------------------------

export interface AchievementState {
  code: string;
  progress: number;
  /** Date ISO du déblocage, ou `null` tant qu'il est verrouillé. */
  unlockedAt: string | null;
}

export interface AchievementBoard {
  states: AchievementState[];
  unlocked: number;
  total: number;
  /** Somme des primes déjà encaissées. */
  earned: number;
}
