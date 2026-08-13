import { z } from "zod";

/**
 * Plinko — barèmes et contrat partagés.
 *
 * Une bille, douze rangées de picots, treize fentes. Le niveau de risque ne
 * change ni le plateau ni la fréquence des gains : uniquement ce que paie
 * chaque fente. Les trois barèmes rendent 91 à 92 % sur le long terme.
 */

/** Rangées de picots traversées par la bille. */
export const PLINKO_ROWS = 12;

/** Une rangée de plus que de picots : douze rebonds donnent treize arrivées. */
export const PLINKO_SLOTS = PLINKO_ROWS + 1;

export const PLINKO_RISKS = ["low", "medium", "high"] as const;
export type PlinkoRisk = (typeof PLINKO_RISKS)[number];

export const PLINKO_RISK_LABELS: Record<PlinkoRisk, string> = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
};

/**
 * Barèmes, exprimés en **dixièmes** de la mise et du bord vers le centre.
 *
 * Seule la moitié est écrite : le plateau est symétrique, et deux moitiés
 * saisies à la main finiraient par diverger d'un chiffre. `plinkoTable` la
 * déplie.
 *
 * Les dixièmes ne sont pas cosmétiques : avec un pas de mise de 10 MaxouCoin,
 * ils garantissent un versement entier. Un barème en centièmes ferait tomber
 * une mise de 10 sur 10,5 MC.
 */
const HALF_TABLES: Record<PlinkoRisk, readonly number[]> = {
  low: [30, 19, 15, 12, 11, 9, 5],
  medium: [80, 30, 20, 15, 11, 8, 4],
  high: [250, 90, 40, 20, 11, 5, 2],
};

/** Barème complet d'un risque : treize fentes, de la gauche vers la droite. */
export function plinkoTable(risk: PlinkoRisk): readonly number[] {
  const half = HALF_TABLES[risk];
  // Le centre n'est pas répété : il n'a pas de miroir.
  return [...half, ...half.slice(0, -1).reverse()];
}

/** Multiplicateur d'une fente, en dixièmes de la mise. */
export function plinkoMultiplier(risk: PlinkoRisk, slot: number): number {
  const value = plinkoTable(risk)[slot];
  if (value === undefined) throw new Error(`Fente de Plinko inconnue : ${slot}`);
  return value;
}

/**
 * Probabilité d'atterrir dans une fente donnée.
 *
 * Loi binomiale : la bille prend douze décisions indépendantes à pile ou face,
 * et le nombre de « droite » détermine la fente. La fente centrale sort 924 fois
 * sur 4 096, chaque fente de bord une seule fois.
 */
export function plinkoProbability(slot: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PLINKO_SLOTS) {
    throw new Error(`Fente de Plinko inconnue : ${slot}`);
  }
  let coefficient = 1;
  for (let i = 0; i < slot; i += 1) {
    coefficient = (coefficient * (PLINKO_ROWS - i)) / (i + 1);
  }
  return coefficient / 2 ** PLINKO_ROWS;
}

/** Versement d'une chute, mise comprise. Voir `wheelPayout` pour la convention. */
export function plinkoPayout(stake: number, multiplierTenths: number): number {
  const payout = (stake * multiplierTenths) / 10;
  if (!Number.isInteger(payout)) {
    throw new Error(`Versement non entier : ${stake} × ${multiplierTenths}/10`);
  }
  return payout;
}

/** Taux de redistribution d'un barème, entre 0 et 1. Un test le surveille. */
export function plinkoReturnToPlayer(risk: PlinkoRisk): number {
  return plinkoTable(risk).reduce(
    (total, tenths, slot) => total + (tenths / 10) * plinkoProbability(slot),
    0,
  );
}

/** Chaque rebond, de la première rangée à la dernière. Sert à l'animation. */
export type PlinkoStep = "left" | "right";

/**
 * Durée de la chute à l'écran.
 *
 * Partagée parce que le serveur s'en sert pour purger les billes retombées, et
 * le client pour placer chaque bille en fonction du temps écoulé depuis son
 * lâcher. Deux valeurs séparées finiraient par diverger, et une bille resterait
 * collée en bas du plateau.
 */
export const PLINKO_FALL_MS = 1_800;

/**
 * Délai minimal entre deux billes d'un même joueur.
 *
 * Le Plinko s'enchaîne, c'est son intérêt : plusieurs billes tombent en même
 * temps. Mais sans cadence minimale, un script viderait un solde en une
 * seconde, et l'écran deviendrait illisible.
 *
 * Huit billes par seconde : assez rapide pour que marteler le bouton produise
 * une vraie pluie, assez lent pour qu'on distingue encore les billes.
 */
export const PLINKO_MIN_INTERVAL_MS = 120;

/**
 * Billes simultanément en vol sur une table.
 *
 * Ce plafond doit rester **atteignable** avec la cadence ci-dessus, sinon il ne
 * sert à rien : à 120 ms d'intervalle sur 1,8 s de chute, une quinzaine de
 * billes peuvent coexister, et douze est le seuil au-delà duquel le plateau
 * devient un rideau illisible.
 */
export const PLINKO_MAX_BALLS = 12;

export interface PlinkoDropResult {
  risk: PlinkoRisk;
  /** Douze rebonds : le front rejoue exactement le trajet tiré par le serveur. */
  path: readonly PlinkoStep[];
  slot: number;
  multiplierTenths: number;
  stake: number;
  payout: number;
  droppedAt: string;
}

/** Une bille en vol, telle que la voient le joueur et ses spectateurs. */
export interface PlinkoBallView extends PlinkoDropResult {
  id: string;
}

export interface PlinkoWatcher {
  userId: string;
  pseudo: string;
  avatarSeed: string;
}

/**
 * État d'une table.
 *
 * Une table appartient à un joueur : lui seul lâche des billes et choisit le
 * risque. Les autres regardent — la même distinction qu'entre un siège et un
 * spectateur au Blackjack.
 */
export interface PlinkoTableView {
  id: string;
  owner: PlinkoWatcher;
  risk: PlinkoRisk;
  /** Billes encore en vol. Le client les place d'après `droppedAt`. */
  balls: PlinkoBallView[];
  watchers: PlinkoWatcher[];
  /** Total gagné et misé depuis l'ouverture de la table, pour la bande de score. */
  wagered: number;
  returned: number;
  version: number;
  now: string;
}

export const plinkoDropSchema = z.object({
  tableId: z.string().uuid(),
  stake: z.number().int().positive(),
});

export type PlinkoDropInput = z.infer<typeof plinkoDropSchema>;

export const plinkoRiskSchema = z.object({
  tableId: z.string().uuid(),
  risk: z.enum(PLINKO_RISKS),
});

export type PlinkoRiskInput = z.infer<typeof plinkoRiskSchema>;

export const PLINKO_ERROR_LABELS = {
  PLINKO_STAKE_INVALID: "Cette mise n'est pas autorisée au Plinko.",
  PLINKO_NOT_OWNER: "Cette table n'est pas la tienne : tu la regardes.",
  PLINKO_TOO_FAST: "Laisse la bille partir avant la suivante.",
  PLINKO_TOO_MANY_BALLS: "Trop de billes en l'air. Laisse la table se vider.",
} as const;
