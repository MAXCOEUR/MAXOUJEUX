import { z } from "zod";

/**
 * Plinko — barèmes et contrat partagés.
 *
 * Une bille, douze rangées de picots, treize fentes. Le niveau de risque ne
 * change ni le plateau ni la fréquence des gains : uniquement ce que paie
 * chaque fente.
 *
 * Les trois barèmes suivent la **même structure**, celle d'une planche de
 * casino lisible d'un coup d'œil :
 *
 * - les trois fentes centrales font perdre — une bille sur deux y tombe ;
 * - les deux fentes suivantes rendent exactement la mise — une sur quatre ;
 * - tout le reste paie — une sur quatre.
 *
 * Le risque ne déplace pas ces frontières, seulement les montants : le centre
 * fait peur (jusqu'à ×0,2 en risque élevé), les bords récompensent (jusqu'à
 * ×19). Les trois rendent **95 à 96 %** sur la durée, bien plus qu'un vrai
 * casino, mais la maison garde son avantage.
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
  low: [20, 16, 14, 12, 10, 8, 7],
  medium: [60, 30, 20, 14, 10, 6, 4],
  high: [190, 58, 23, 14, 10, 3, 2],
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
 * Poussée de la bille vers l'extérieur, à chaque rebond.
 *
 * Une planche parfaitement équitable suit une loi binomiale, et six billes sur
 * dix finissent alors dans les trois fentes centrales : mathématiquement juste,
 * mais monotone à jouer — on regarde toujours la bille tomber au même endroit.
 *
 * Ce biais fait dépendre chaque rebond de l'écart déjà pris : plus la bille est
 * décalée, plus elle a de chances de continuer dans le même sens. La planche
 * reste **parfaitement symétrique** — aucun côté n'est favorisé — mais la
 * dispersion s'élargit : le centre passe de 61 % à 50 %.
 */
export const PLINKO_SPREAD = 0.1;

/**
 * Probabilité d'aller à droite, connaissant la rangée et l'écart déjà pris.
 *
 * Partagée entre le moteur, qui la joue, et le calcul de distribution, qui la
 * somme : deux formules séparées finiraient par diverger, et les taux affichés
 * ne décriraient plus le jeu réel.
 */
export function plinkoRightChance(row: number, right: number): number {
  if (row === 0) return 0.5;
  const ecart = (right - row / 2) / (row / 2);
  return Math.min(0.95, Math.max(0.05, 0.5 + PLINKO_SPREAD * ecart));
}

/**
 * Probabilité d'atterrir dans chaque fente.
 *
 * Calculée en propageant la masse rangée par rangée plutôt que par une formule
 * fermée : le biais rend les rebonds dépendants du passé, ce qu'aucun
 * coefficient binomial ne sait décrire.
 */
function distribution(): number[] {
  let etat = new Map<number, number>([[0, 1]]);
  for (let row = 0; row < PLINKO_ROWS; row += 1) {
    const suivant = new Map<number, number>();
    for (const [right, masse] of etat) {
      const droite = plinkoRightChance(row, right);
      suivant.set(right + 1, (suivant.get(right + 1) ?? 0) + masse * droite);
      suivant.set(right, (suivant.get(right) ?? 0) + masse * (1 - droite));
    }
    etat = suivant;
  }
  return Array.from({ length: PLINKO_SLOTS }, (_, slot) => etat.get(slot) ?? 0);
}

/** La distribution ne dépend que des constantes : inutile de la refaire. */
const DISTRIBUTION = distribution();

export function plinkoProbability(slot: number): number {
  const chance = DISTRIBUTION[slot];
  if (chance === undefined) throw new Error(`Fente de Plinko inconnue : ${slot}`);
  return chance;
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
