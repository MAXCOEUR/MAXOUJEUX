/**
 * Les jetons, communs à toutes les tables du casino.
 *
 * Extrait de `blackjack-ui.ts` le jour où la roulette est arrivée : un jeton
 * n'appartient à aucun jeu en particulier, et deux jeux de couleurs pour la
 * même valeur seraient un contresens — le code couleur est justement ce qu'un
 * joueur apprend une fois pour toutes.
 */

/** Valeurs de jeton, de la plus forte à la plus faible. */
export const CHIP_VALUES = [2_500, 1_000, 500, 250, 100, 50, 10] as const;

export type ChipValue = (typeof CHIP_VALUES)[number];

/** Couleur de chaque valeur, prise dans le bloc `@theme`. */
export const CHIP_COLORS: Record<ChipValue, string> = {
  10: "var(--color-jeton-10)",
  50: "var(--color-jeton-50)",
  100: "var(--color-jeton-100)",
  250: "var(--color-jeton-250)",
  500: "var(--color-jeton-500)",
  1_000: "var(--color-jeton-1000)",
  2_500: "var(--color-jeton-2500)",
};

/** Le jeton de 10 est presque blanc : son chiffre doit être sombre. */
export const CHIP_INK: Record<ChipValue, string> = {
  10: "var(--color-carte-noir)",
  50: "var(--color-cream)",
  100: "var(--color-cream)",
  250: "var(--color-cream)",
  500: "var(--color-cream)",
  1_000: "var(--color-felt-deep)",
  2_500: "var(--color-cream)",
};

/**
 * Décompose une mise en jetons, du plus fort au plus faible.
 *
 * La décomposition gloutonne est celle d'un vrai croupier : on paie avec le
 * moins de jetons possible. Le nombre est plafonné parce qu'une pile de vingt
 * jetons de 10 sort de la case de mise et ne se compte de toute façon pas à
 * l'œil ; le montant exact est toujours écrit à côté, la pile n'a qu'à donner
 * l'ordre de grandeur.
 */
export function chipStack(amount: number, max = 5): ChipValue[] {
  if (!Number.isFinite(amount) || amount <= 0) return [];
  const stack: ChipValue[] = [];
  let reste = Math.floor(amount);
  for (const value of CHIP_VALUES) {
    while (reste >= value && stack.length < max) {
      stack.push(value);
      reste -= value;
    }
  }
  return stack;
}

/**
 * Le plus gros jeton qui tienne dans un montant.
 *
 * Sert à représenter une mise par **un seul** disque, là où la place manque —
 * une case de tapis de roulette fait quelques dizaines de pixels et ne peut pas
 * accueillir une pile.
 */
export function chipFor(amount: number): ChipValue | null {
  return chipStack(amount, 1)[0] ?? null;
}
