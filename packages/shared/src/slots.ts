import { z } from "zod";

/**
 * Machine à sous — barème et contrat partagés.
 *
 * Trois rouleaux identiques, six symboles pondérés, une ligne de gain. Un triple
 * paie plein tarif, une paire paie un lot de consolation : sans elle, le joueur
 * ne gagnerait qu'un tour sur cinq et la machine serait injouable.
 *
 * Elle rend **95,9 %** sur le long terme : moins qu'elle n'encaisse, donc c'est
 * toujours un puits de MaxouCoin, mais nettement plus généreuse qu'un vrai
 * casino. Les paires portent les deux tiers de ce taux — ce sont elles qui font
 * qu'on repart rarement les mains vides.
 */

/** Rouleaux de la machine. Trois : au-delà, la table de gains explose. */
export const SLOTS_REELS = 3;

/**
 * Durée d'un tirage à l'écran, du départ au dernier rouleau arrêté.
 *
 * Partagée parce que le serveur s'en sert pour savoir quand la machine est de
 * nouveau libre, et le client pour caler son animation. Deux valeurs séparées
 * finiraient par diverger, et la machine redeviendrait cliquable avant d'avoir
 * fini de tourner.
 */
export const SLOTS_SPIN_MS = 2_400;

/**
 * Décalage d'arrêt entre deux rouleaux voisins.
 *
 * Les trois rouleaux ne s'arrêtent pas ensemble : c'est ce délai qui crée le
 * suspense de la machine à sous — deux MAXOU alignés et le troisième qui tourne
 * encore. Les arrêts tombent donc à 1 200, 1 800 et 2 400 ms.
 */
export const SLOTS_REEL_STAGGER_MS = 600;

/** Instant d'arrêt d'un rouleau, en millisecondes depuis le départ. */
export function slotsReelStopAt(reel: number): number {
  return SLOTS_SPIN_MS - (SLOTS_REELS - 1 - reel) * SLOTS_REEL_STAGGER_MS;
}

export interface SlotSymbol {
  code: string;
  name: string;
  /** Poids sur `SLOTS_REEL_WEIGHT`, identique sur les trois rouleaux. */
  weight: number;
  /** Trois identiques, en dixièmes de la mise. */
  tripleTenths: number;
  /** Exactement deux identiques, en dixièmes de la mise. */
  pairTenths: number;
}

/**
 * Les six symboles, du plus commun au plus rare.
 *
 * Les multiplicateurs sont en **dixièmes** : avec un pas de mise de 10
 * MaxouCoin, c'est ce qui garantit un versement entier. Le ×1,5 du sac tomberait
 * sur 10,5 MC en centièmes, et le code refuserait de payer plutôt que
 * d'arrondir.
 */
export const SLOT_SYMBOLS: readonly SlotSymbol[] = [
  { code: "cerise", name: "Cerise", weight: 34, tripleTenths: 30, pairTenths: 10 },
  { code: "cloche", name: "Cloche", weight: 28, tripleTenths: 40, pairTenths: 11 },
  { code: "sac", name: "Sac", weight: 20, tripleTenths: 60, pairTenths: 15 },
  { code: "couronne", name: "Couronne", weight: 12, tripleTenths: 130, pairTenths: 22 },
  { code: "diamant", name: "Diamant", weight: 5, tripleTenths: 320, pairTenths: 45 },
  { code: "maxou", name: "MAXOU", weight: 1, tripleTenths: 1_500, pairTenths: 110 },
] as const;

export const SLOTS_REEL_WEIGHT = SLOT_SYMBOLS.reduce((total, symbol) => total + symbol.weight, 0);

export function slotSymbol(index: number): SlotSymbol {
  const symbol = SLOT_SYMBOLS[index];
  if (!symbol) throw new Error(`Symbole de machine inconnu : ${index}`);
  return symbol;
}

/** Probabilité qu'un rouleau s'arrête sur ce symbole. */
export function slotSymbolProbability(index: number): number {
  return slotSymbol(index).weight / SLOTS_REEL_WEIGHT;
}

export type SlotsOutcomeKind = "triple" | "pair" | "none";

export interface SlotsOutcome {
  kind: SlotsOutcomeKind;
  /** Symbole qui paie, `null` quand la ligne ne paie rien. */
  symbol: number | null;
  multiplierTenths: number;
}

/**
 * Ce que paie une ligne de trois symboles.
 *
 * Trois identiques paient le triple. Exactement deux identiques paient la paire
 * du symbole **apparié**, où qu'il soit sur la ligne : une machine qui
 * n'accepterait que les paires adjacentes serait une règle de plus à expliquer
 * pour un gain nul.
 */
export function slotsOutcome(reels: readonly number[]): SlotsOutcome {
  if (reels.length !== SLOTS_REELS) {
    throw new Error(`Une ligne compte ${SLOTS_REELS} rouleaux, pas ${reels.length}`);
  }

  const comptes = new Map<number, number>();
  for (const index of reels) comptes.set(index, (comptes.get(index) ?? 0) + 1);

  for (const [index, compte] of comptes) {
    if (compte === SLOTS_REELS) {
      return { kind: "triple", symbol: index, multiplierTenths: slotSymbol(index).tripleTenths };
    }
    if (compte === 2) {
      return { kind: "pair", symbol: index, multiplierTenths: slotSymbol(index).pairTenths };
    }
  }

  return { kind: "none", symbol: null, multiplierTenths: 0 };
}

/** Versement d'un tirage, mise comprise. Voir `wheelPayout` pour la convention. */
export function slotsPayout(stake: number, multiplierTenths: number): number {
  const payout = (stake * multiplierTenths) / 10;
  if (!Number.isInteger(payout)) {
    throw new Error(`Versement non entier : ${stake} × ${multiplierTenths}/10`);
  }
  return payout;
}

/**
 * Taux de redistribution du barème, entre 0 et 1.
 *
 * Calculé exhaustivement sur les 216 lignes possibles pondérées, et non par une
 * formule refaite à la main : c'est le même chemin que celui du jeu réel, donc
 * un barème retouché sans y penser se voit tout de suite. Un test le surveille.
 */
export function slotsReturnToPlayer(): number {
  let total = 0;
  for (let a = 0; a < SLOT_SYMBOLS.length; a += 1) {
    for (let b = 0; b < SLOT_SYMBOLS.length; b += 1) {
      for (let c = 0; c < SLOT_SYMBOLS.length; c += 1) {
        const chance =
          slotSymbolProbability(a) * slotSymbolProbability(b) * slotSymbolProbability(c);
        total += chance * (slotsOutcome([a, b, c]).multiplierTenths / 10);
      }
    }
  }
  return total;
}

/** Probabilité qu'un tirage paie quelque chose. */
export function slotsHitRate(): number {
  let total = 0;
  for (let a = 0; a < SLOT_SYMBOLS.length; a += 1) {
    for (let b = 0; b < SLOT_SYMBOLS.length; b += 1) {
      for (let c = 0; c < SLOT_SYMBOLS.length; c += 1) {
        if (slotsOutcome([a, b, c]).kind === "none") continue;
        total += slotSymbolProbability(a) * slotSymbolProbability(b) * slotSymbolProbability(c);
      }
    }
  }
  return total;
}

/** Un tirage, tel que le serveur le renvoie. */
export interface SlotsSpinResult {
  id: string;
  /** Les trois symboles, de gauche à droite. */
  reels: number[];
  kind: SlotsOutcomeKind;
  symbol: number | null;
  multiplierTenths: number;
  stake: number;
  payout: number;
  spunAt: string;
}

export interface SlotsPlayer {
  userId: string;
  pseudo: string;
  avatarSeed: string;
}

/**
 * État d'une machine.
 *
 * Une machine appartient à un joueur : lui seul tire. N'importe qui peut la
 * regarder — même partage qu'au Plinko, avec un seul siège.
 */
export interface SlotsTableView {
  id: string;
  owner: SlotsPlayer;
  /** Tirage en cours, résultat compris : les rouleaux sont tirés au départ. */
  spinning: SlotsSpinResult | null;
  /** Derniers tirages, du plus récent au plus ancien. */
  history: SlotsSpinResult[];
  watchers: SlotsPlayer[];
  /** Total misé et rendu depuis l'ouverture, pour la bande de score. */
  wagered: number;
  returned: number;
  version: number;
  now: string;
}

export const slotsSpinSchema = z.object({
  tableId: z.string().uuid(),
  stake: z.number().int().positive(),
});

export type SlotsSpinInput = z.infer<typeof slotsSpinSchema>;

export const SLOTS_ERROR_LABELS = {
  SLOTS_STAKE_INVALID: "Cette mise n'est pas autorisée à la machine.",
  SLOTS_NOT_OWNER: "Cette machine n'est pas la tienne : tu la regardes.",
  SLOTS_BUSY: "Les rouleaux tournent encore.",
} as const;
