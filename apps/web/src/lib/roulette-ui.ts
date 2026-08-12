/**
 * Calculs d'affichage de la table de roulette.
 *
 * Aucune règle de jeu : elles sont dans `@maxoujeux/engines`, et le serveur
 * reste seul arbitre. Ce sont des fonctions de mise en scène — la disposition
 * du tapis, l'angle d'arrêt de la bille, le libellé d'une case — isolées ici
 * pour être testées sans monter un rendu React.
 */

import { ROULETTE_POCKETS, pocketIndex } from "@maxoujeux/engines";
import {
  ROULETTE_ODDS,
  oddsLabel,
  spotKey,
  type RouletteOutside,
  type RouletteSpot,
  type RouletteSpotBet,
  type RouletteView,
} from "@maxoujeux/shared";

export function isNewerRouletteView(current: RouletteView | null, incoming: RouletteView): boolean {
  return !current || current.id !== incoming.id || incoming.version > current.version;
}

/** Informations minimales affichées par le bandeau d'une table quittée du regard. */
export interface RouletteResume {
  tableId: string;
  wager: number;
  phase: RouletteView["phase"];
  deadlineAt: string | null;
}

/** Résume la roulette encore active lorsque le joueur consulte un autre écran. */
export function rouletteResume(
  view: RouletteView | null,
  currentTableId: string | null,
): RouletteResume | null {
  if (!view || view.id === currentTableId) return null;
  const mine = view.players.find((player) => player.userId === view.you);
  return {
    tableId: view.id,
    wager: mine?.totalWager ?? 0,
    phase: view.phase,
    deadlineAt: view.deadlineAt,
  };
}

// ---------------------------------------------------------------------------
// Disposition du tapis
// ---------------------------------------------------------------------------

/**
 * Les trente-six numéros, rangés comme sur un vrai tapis.
 *
 * Trois lignes de douze, **lues de bas en haut** : la colonne 3 (3, 6, 9…) est
 * la ligne du haut. C'est la disposition universelle, et l'inverser rendrait
 * les mises sur colonne incompréhensibles pour quiconque a déjà joué.
 */
export const MAT_ROWS: readonly (readonly number[])[] = [
  Array.from({ length: 12 }, (_, index) => index * 3 + 3),
  Array.from({ length: 12 }, (_, index) => index * 3 + 2),
  Array.from({ length: 12 }, (_, index) => index * 3 + 1),
];

/** Les colonnes, de la ligne du haut à celle du bas — même ordre que `MAT_ROWS`. */
export const MAT_COLUMNS: readonly RouletteOutside[] = ["column3", "column2", "column1"];

export const MAT_DOZENS: readonly RouletteOutside[] = ["dozen1", "dozen2", "dozen3"];

/** Les six mises simples, dans l'ordre du tapis. */
export const MAT_EVEN_MONEY: readonly RouletteOutside[] = ["low", "even", "red", "black", "odd", "high"];

const SPOT_LABELS: Record<RouletteOutside, string> = {
  red: "Rouge",
  black: "Noir",
  even: "Pair",
  odd: "Impair",
  low: "1 à 18",
  high: "19 à 36",
  dozen1: "1re douzaine",
  dozen2: "2e douzaine",
  dozen3: "3e douzaine",
  column1: "1re colonne",
  column2: "2e colonne",
  column3: "3e colonne",
};

/** Nom d'une case, tel qu'il est annoncé. */
export function spotLabel(spot: RouletteSpot): string {
  return spot.kind === "straight" ? `Plein ${spot.number}` : SPOT_LABELS[spot.kind];
}

/**
 * Libellé accessible complet d'une case.
 *
 * Le rapport y figure : c'est l'information dont dépend la décision, et un
 * joueur qui n'a que le nom de la case doit connaître le barème par cœur.
 */
export function spotAria(spot: RouletteSpot, mine: number, total: number): string {
  const base = `${spotLabel(spot)}, ${oddsLabel(spot.kind)}`;
  if (mine > 0) return `${base}, ${mine} MC misés par toi sur ${total} MC`;
  if (total > 0) return `${base}, ${total} MC misés par la table`;
  return base;
}

export function spotOdds(spot: RouletteSpot): number {
  return ROULETTE_ODDS[spot.kind];
}

/** Retrouve le tas posé sur une case. */
export function betOn(bets: readonly RouletteSpotBet[], spot: RouletteSpot): RouletteSpotBet | null {
  const key = spotKey(spot);
  return bets.find((bet) => spotKey(bet.spot) === key) ?? null;
}

/** Somme d'une composition en cours, avant confirmation. */
export function draftTotal(draft: ReadonlyMap<string, { spot: RouletteSpot; amount: number }>): number {
  let total = 0;
  for (const bet of draft.values()) total += bet.amount;
  return total;
}

// ---------------------------------------------------------------------------
// La roue
// ---------------------------------------------------------------------------

/** Angle d'une case sur le cylindre, en degrés, la case du zéro en haut. */
export function pocketAngle(value: number): number {
  return (pocketIndex(value) * 360) / ROULETTE_POCKETS;
}

/** Ouverture angulaire d'une case. */
export const POCKET_ARC = 360 / ROULETTE_POCKETS;

/**
 * Rotation du cylindre pendant un lancer.
 *
 * Un **nombre entier de tours**, indépendant du numéro sorti : le cylindre ne
 * vise rien, il tourne. C'est la correction du défaut d'origine, où la roue
 * pivotait pour amener la case gagnante sous un repère fixe — ce qui donnait à
 * l'écran un point d'arrivée que n'a aucune roulette réelle.
 *
 * Le nombre de tours est constant, sans quoi deux joueurs verraient le même
 * lancer se dérouler différemment.
 */
export function wheelRotation(turns = 3): number {
  return turns * 360;
}

/**
 * Rotation de la bille, en sens **inverse** du cylindre, comme au casino.
 *
 * Elle se termine exactement sur la case sortie : le cylindre s'immobilisant à
 * un multiple de 360°, la case garde son angle de dessin, et la bille n'a qu'à
 * l'atteindre. C'est elle, et elle seule, qui désigne le numéro — plus aucun
 * repère n'est nécessaire.
 */
export function ballRotation(result: number, turns = 6): number {
  return pocketAngle(result) - turns * 360;
}
