import { z } from "zod";

/**
 * Roue de la fortune — barème et contrat partagés.
 *
 * Un lancer toutes les 24 h, mise choisie avant de lancer. La roue est un puits
 * de MaxouCoin, pas une source : elle rend 92 % de ce qu'elle encaisse. La seule
 * entrée gratuite du site reste le bonus quotidien du lobby.
 */

/** Délai entre deux lancers d'un même compte. */
export const WHEEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface WheelSegment {
  /**
   * Multiplicateur exprimé en **dixièmes** de la mise : 15 vaut ×1,5.
   *
   * Les entiers évitent d'accumuler des erreurs de virgule flottante sur des
   * montants d'argent, et le pas de mise de 10 MaxouCoin garantit qu'un
   * versement tombe toujours juste — voir `wheelPayout`.
   */
  multiplierTenths: number;
  /** Poids du secteur dans le tirage, sur `WHEEL_TOTAL_WEIGHT`. */
  weight: number;
  /** Étiquette peinte sur le secteur. */
  label: string;
}

/**
 * Les neuf secteurs, **dans l'ordre horaire de la roue**.
 *
 * L'ordre est dispersé et non croissant, pour la même raison que le cylindre de
 * roulette n'est pas rangé de 0 à 36 : deux gros multiplicateurs côte à côte se
 * repèrent au premier coup d'œil et la roue se lit comme un jouet.
 *
 * Les secteurs sont de **taille égale mais de poids très inégaux** : le ×20 est
 * mille fois plus rare que sa part de surface ne le suggère. C'est le compromis
 * assumé de toutes les roues de ce genre — dessiner un secteur proportionnel à
 * 0,1 % donnerait un trait de 0,36°, invisible. En contrepartie, l'écran affiche
 * la probabilité réelle de chaque case à côté de la roue : le joueur doit
 * pouvoir lire ce que la roue ne peut pas montrer.
 */
export const WHEEL_SEGMENTS: readonly WheelSegment[] = [
  { multiplierTenths: 10, weight: 250, label: "×1" },
  { multiplierTenths: 200, weight: 1, label: "×20" },
  { multiplierTenths: 5, weight: 230, label: "×0,5" },
  { multiplierTenths: 30, weight: 30, label: "×3" },
  { multiplierTenths: 0, weight: 245, label: "×0" },
  { multiplierTenths: 15, weight: 145, label: "×1,5" },
  { multiplierTenths: 100, weight: 1, label: "×10" },
  { multiplierTenths: 20, weight: 90, label: "×2" },
  { multiplierTenths: 50, weight: 8, label: "×5" },
] as const;

export const WHEEL_TOTAL_WEIGHT = WHEEL_SEGMENTS.reduce((total, segment) => total + segment.weight, 0);

/** Probabilité d'un secteur, entre 0 et 1. Affichée telle quelle à l'écran. */
export function wheelProbability(index: number): number {
  const segment = WHEEL_SEGMENTS[index];
  if (!segment) throw new Error(`Secteur de roue inconnu : ${index}`);
  return segment.weight / WHEEL_TOTAL_WEIGHT;
}

/**
 * Versement d'un lancer, mise comprise.
 *
 * Même convention que le blackjack et la roulette : c'est un versement brut, la
 * mise ayant déjà été débitée. Un ×0,5 rend donc la moitié de la mise, pas la
 * mise et demie.
 *
 * Un montant non entier n'est jamais arrondi en silence : le pas de 10 MC et
 * des multiplicateurs en dixièmes suffisent à l'éviter, et si un barème futur
 * casse cette propriété, il doit échouer bruyamment plutôt qu'être rogné au
 * détriment du joueur.
 */
export function wheelPayout(stake: number, multiplierTenths: number): number {
  const payout = (stake * multiplierTenths) / 10;
  if (!Number.isInteger(payout)) {
    throw new Error(`Versement non entier : ${stake} × ${multiplierTenths}/10`);
  }
  return payout;
}

/** Taux de redistribution du barème, entre 0 et 1. Un test le surveille. */
export function wheelReturnToPlayer(): number {
  const total = WHEEL_SEGMENTS.reduce(
    (sum, segment) => sum + segment.multiplierTenths * segment.weight,
    0,
  );
  return total / (10 * WHEEL_TOTAL_WEIGHT);
}

/** Instant du prochain lancer autorisé, ou `null` si la roue est disponible. */
export function nextWheelSpinAt(lastSpunAt: Date | null, now: Date): Date | null {
  if (!lastSpunAt) return null;
  const next = new Date(lastSpunAt.getTime() + WHEEL_COOLDOWN_MS);
  return next.getTime() > now.getTime() ? next : null;
}

/**
 * Durée d'un lancer à l'écran, du départ à l'arrêt sur la case.
 *
 * Partagée : le serveur s'en sert pour savoir quand la roue est de nouveau
 * libre, le client pour caler son animation. Deux valeurs séparées finiraient
 * par diverger, et la roue redeviendrait cliquable avant d'avoir fini de
 * tourner.
 */
export const WHEEL_SPIN_MS = 6_000;

/** Résultat d'un lancer, tel que le serveur le renvoie. */
export interface WheelSpinResult {
  /** Secteur atteint : c'est lui qui commande l'angle d'arrêt à l'écran. */
  index: number;
  multiplierTenths: number;
  stake: number;
  payout: number;
  spunAt: string;
}

export interface WheelPlayer {
  userId: string;
  pseudo: string;
  avatarSeed: string;
}

/** Un lancer passé, pour la bande d'historique de la salle. */
export interface WheelHistoryEntry extends WheelSpinResult {
  by: WheelPlayer;
}

/**
 * Le lancer en cours.
 *
 * Il porte déjà son résultat : la roue est tirée au départ, pas à l'arrêt.
 * Le client n'a donc rien à demander à la fin de l'animation, et deux
 * spectateurs arrivés à une seconde d'écart voient la même roue s'arrêter au
 * même endroit.
 */
export interface WheelSpinning {
  by: WheelPlayer;
  result: WheelSpinResult;
  /** Fin de l'animation, en ISO : c'est aussi le moment où la roue se libère. */
  endsAt: string;
}

/**
 * La salle de la roue.
 *
 * Il n'y a **qu'une roue sur tout le site** : personne ne crée de table, on
 * entre dans la salle et on regarde. Miser est un geste distinct, ouvert une
 * fois par 24 h à chacun.
 */
export interface WheelView {
  /** Tous ceux qui sont dans la salle, joueur du moment compris. */
  audience: WheelPlayer[];
  /** Non nul pendant qu'elle tourne — pour tout le monde, pas seulement le joueur. */
  spinning: WheelSpinning | null;
  /** Le destinataire peut-il lancer maintenant ? */
  canSpin: boolean;
  /** Fin de son délai de 24 h, en ISO. `null` s'il peut lancer. */
  nextSpinAt: string | null;
  /** Son dernier lancer, pour lui rappeler ce qu'il a fait. */
  lastSpin: WheelSpinResult | null;
  /** Les derniers lancers de la salle, du plus récent au plus ancien. */
  history: WheelHistoryEntry[];
  /** Horloge serveur : le compte à rebours ne dépend pas du poste client. */
  now: string;
}

export const wheelSpinSchema = z.object({
  stake: z.number().int().positive(),
});

export type WheelSpinInput = z.infer<typeof wheelSpinSchema>;

export const WHEEL_ERROR_LABELS = {
  WHEEL_STAKE_INVALID: "Cette mise n'est pas autorisée pour la roue.",
  WHEEL_COOLDOWN: "La roue a déjà tourné pour toi aujourd'hui.",
  WHEEL_BUSY: "La roue tourne. Attends qu'elle s'arrête.",
  WHEEL_NOT_HERE: "Entre dans la salle avant de miser.",
} as const;
