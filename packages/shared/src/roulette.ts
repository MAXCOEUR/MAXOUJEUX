/**
 * Contrat de la roulette européenne — lot 3.
 *
 * Une table, plusieurs joueurs, des mises **simultanées** : contrairement au
 * Blackjack il n'y a ni siège ni tour de parole. Tout le monde pose ses jetons
 * pendant la même fenêtre, voit ceux des autres s'empiler, puis la bille part.
 *
 * Les barèmes et les plafonds vivent ici et nulle part ailleurs : le front les
 * lit pour griser une case, le serveur les rejoue pour refuser une requête
 * forgée. Deux tables de valeurs finiraient par diverger, et c'est l'écart
 * entre les deux qui deviendrait exploitable.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Durées
// ---------------------------------------------------------------------------

/**
 * Fenêtre de mise, ouverte par la première mise confirmée.
 *
 * Alignée sur celle du blackjack : c'est le même geste, il n'y a pas de raison
 * qu'il dure une demi-minute ici et vingt secondes là. Elle est écourtée à
 * `ALL_BETS_PLACED_MS` dès que tous les joueurs présents ont posé leurs jetons.
 */
export const ROULETTE_BETTING_MS = 20_000;

/**
 * Durée du lancer.
 *
 * Le numéro est tiré au **début** de cette fenêtre et voyage dans l'état : un
 * joueur peut donc le lire dans le réseau avant l'arrêt de la bille. Sans
 * conséquence — les mises sont fermées, plus aucune action n'est possible — et
 * c'est le seul moyen pour qu'un joueur arrivant en cours de lancer voie une
 * roue cohérente plutôt qu'une bille repartant de zéro.
 */
export const ROULETTE_SPIN_MS = 7_000;

/**
 * Règlement des gains avant le retour à la table vide.
 *
 * Court volontairement : le numéro sorti reste au bandeau des derniers tirages
 * et le solde est déjà à jour dans l'en-tête. Faire patienter huit secondes
 * devant une table figée cassait le rythme entre deux lancers.
 */
export const ROULETTE_RESULT_MS = 2_000;

export const ROULETTE_DISCONNECT_GRACE_MS = 45_000;

/** Places à la table. Sans siège attribué : c'est un plafond de charge, pas une règle. */
export const ROULETTE_MAX_PLAYERS = 8;

/** Numéros conservés au bandeau, comme au tableau lumineux d'une vraie table. */
export const ROULETTE_HISTORY = 10;

// ---------------------------------------------------------------------------
// Cases de mise
// ---------------------------------------------------------------------------

/** Les douze mises extérieures. Le plein (`straight`) porte en plus son numéro. */
export const ROULETTE_OUTSIDE = [
  "red", "black", "even", "odd", "low", "high",
  "dozen1", "dozen2", "dozen3",
  "column1", "column2", "column3",
] as const;

export type RouletteOutside = (typeof ROULETTE_OUTSIDE)[number];
export type RouletteSpotKind = "straight" | RouletteOutside;

export type RouletteSpot =
  | { kind: "straight"; number: number }
  | { kind: RouletteOutside };

/** Cases distinctes : 37 pleins et 12 extérieures. Borne la taille d'une mise. */
export const ROULETTE_MAX_SPOTS = 49;

/**
 * Clé canonique d'une case : `straight:17`, `red`.
 *
 * Sert de clé de `Map` côté serveur **et** de clé React côté front. Une seule
 * fonction pour les deux : deux conventions de nommage finiraient par se
 * désaccorder sur le zéro ou sur la casse, et l'agrégat afficherait deux tas
 * distincts sur la même case.
 */
export function spotKey(spot: RouletteSpot): string {
  return spot.kind === "straight" ? `straight:${spot.number}` : spot.kind;
}

// ---------------------------------------------------------------------------
// Barème et plafonds
// ---------------------------------------------------------------------------

/** Rapport « pour un ». Un plein à 35 rend 36 fois la mise, celle-ci comprise. */
export const ROULETTE_ODDS: Record<RouletteSpotKind, number> = {
  straight: 35,
  dozen1: 2, dozen2: 2, dozen3: 2,
  column1: 2, column2: 2, column3: 2,
  red: 1, black: 1, even: 1, odd: 1, low: 1, high: 1,
};

/**
 * Mise minimale sur une case, et pas entre deux mises.
 *
 * **Il n'y a plus de plafond** : ni par case, ni par tour. Le seul maximum est
 * ce que le joueur possède, et le débit atomique du porte-monnaie s'en charge.
 * Les anciennes limites — un plein bridé à 100 MC pour borner son rapport de
 * 35:1 — protégeaient l'économie du site ; c'est un arbitrage assumé au profit
 * de la liberté de jeu.
 *
 * Le pas de 10 n'est pas un plafond et reste en place : il garantit des
 * versements entiers sur tous les barèmes du site.
 */
export const ROULETTE_MIN_BET = 10;
export const ROULETTE_BET_STEP = 10;

/** Gain brut d'une case gagnante, mise comprise. */
export function rouletteReturn(kind: RouletteSpotKind, amount: number): number {
  return amount * (ROULETTE_ODDS[kind] + 1);
}

/** Libellé du rapport, tel qu'il est sérigraphié sur un tapis. */
export function oddsLabel(kind: RouletteSpotKind): string {
  return `${ROULETTE_ODDS[kind]}:1`;
}

// ---------------------------------------------------------------------------
// Vue
// ---------------------------------------------------------------------------

export type RoulettePhase = "idle" | "betting" | "spinning" | "result";

export interface RoulettePlayerView {
  userId: string;
  pseudo: string;
  avatarSeed: string;
  connected: boolean;
  /** Total engagé sur le tour en cours. */
  totalWager: number;
  /** Gain net du tour, `null` tant qu'il n'est pas réglé. */
  roundNet: number | null;
}

/**
 * Le tas de jetons posé sur une case.
 *
 * `total` est la mise de toute la table, `mine` la part du destinataire. C'est
 * ce qui répond à « on voit ce que les autres font » sans faire grossir la
 * charge : au plus 49 entrées, quel que soit le nombre de joueurs. Détailler
 * qui a misé quoi sur chaque case multiplierait la charge par le nombre de
 * joueurs pour une information que personne ne lit case par case.
 */
export interface RouletteSpotBet {
  spot: RouletteSpot;
  total: number;
  mine: number;
}

export interface RouletteView {
  id: string;
  game: "roulette";
  phase: RoulettePhase;
  players: RoulettePlayerView[];
  maxPlayers: number;
  /** Identifiant du destinataire s'il est à la table. */
  you: string | null;
  roundId: string | null;
  bets: RouletteSpotBet[];
  /** Numéro sorti. Rempli dès `spinning`, pour que la roue sache où s'arrêter. */
  result: number | null;
  /** Derniers numéros, du plus récent au plus ancien. */
  history: number[];
  deadlineAt: string | null;
  /** Durée du lancer, pour que le front cale son animation sur le serveur. */
  spinMs: number;
  version: number;
  now: string;
}

// ---------------------------------------------------------------------------
// Validation des intentions
// ---------------------------------------------------------------------------

export const rouletteSpotSchema = z.union([
  z.object({ kind: z.literal("straight"), number: z.number().int().min(0).max(36) }),
  z.object({ kind: z.enum(ROULETTE_OUTSIDE) }),
]);

/**
 * Confirmation d'une mise.
 *
 * **Un tableau de cases**, parce que le joueur compose sur le tapis puis
 * confirme : une seule transaction, un seul débit, et « tout passe ou rien ne
 * passe ». Poser jeton par jeton multiplierait les écritures et ouvrirait un
 * chemin de remboursement pour chaque retrait.
 *
 * **Aucun numéro de version**, pour la raison déjà retenue sur `blackjack:sit` :
 * la version bouge à chaque mise d'un autre joueur, et un garde de version
 * ferait échouer une mise parfaitement légitime, composée pendant que le voisin
 * posait la sienne. La phase et l'échéance sont les vraies gardes.
 */
export const rouletteBetSchema = z.object({
  tableId: z.string().uuid(),
  bets: z
    .array(
      z.object({
        spot: rouletteSpotSchema,
        amount: z
          .number()
          .int()
          .min(ROULETTE_MIN_BET)
          .refine((amount) => amount % ROULETTE_BET_STEP === 0, {
            message: `La mise doit être un multiple de ${ROULETTE_BET_STEP}.`,
          }),
      }),
    )
    .min(1)
    .max(ROULETTE_MAX_SPOTS),
});

export const rouletteTableRefSchema = z.object({ tableId: z.string().uuid() });

export type RouletteBetInput = z.infer<typeof rouletteBetSchema>;
export type RouletteTableRefInput = z.infer<typeof rouletteTableRefSchema>;

export const ROULETTE_ERROR_LABELS = {
  ROULETTE_BETTING_CLOSED: "Rien ne va plus, les mises sont fermées.",
  ROULETTE_BET_INVALID: "Cette mise n'est pas autorisée.",
} as const;

export type RouletteErrorCode = keyof typeof ROULETTE_ERROR_LABELS;
