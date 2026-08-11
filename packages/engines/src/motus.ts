import type { MotusMark } from "@maxoujeux/shared";

export interface MotusEvaluation {
  guess: string;
  marks: MotusMark[];
  solved: boolean;
}

/**
 * Nettoie une saisie encore incomplète pour l'affichage de la ligne courante.
 * Contrairement à `normalizeMotusWord`, cette fonction ne valide pas un mot :
 * elle ignore simplement les caractères parasites des claviers mobiles.
 */
export function normalizeMotusDraft(value: string, maxLength = 8): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, Math.max(0, maxLength));
}

/** Forme de comparaison : majuscules A-Z, sans accents ni séparateurs. */
export function normalizeMotusWord(value: string): string {
  const normalized = value.trim().normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) {
    throw new Error("Un mot Motus ne peut contenir que des lettres");
  }
  return normalized;
}

/**
 * Évalue une proposition en deux passes pour ne pas surconsommer les doublons :
 * les positions exactes retirent d'abord leurs lettres, puis les jaunes puisent
 * uniquement dans les occurrences restantes.
 */
export function evaluateMotusGuess(secretInput: string, guessInput: string): MotusEvaluation {
  const secret = normalizeMotusWord(secretInput);
  const guess = normalizeMotusWord(guessInput);
  if (secret.length !== guess.length) {
    throw new Error("Le mot secret et la proposition n'ont pas la même longueur");
  }

  const marks: MotusMark[] = Array.from({ length: secret.length }, () => "absent");
  const remaining = new Map<string, number>();

  for (let index = 0; index < secret.length; index += 1) {
    const expected = secret[index];
    if (expected === guess[index]) {
      marks[index] = "correct";
    } else if (expected) {
      remaining.set(expected, (remaining.get(expected) ?? 0) + 1);
    }
  }

  for (let index = 0; index < guess.length; index += 1) {
    if (marks[index] === "correct") continue;
    const letter = guess[index];
    if (!letter) continue;
    const available = remaining.get(letter) ?? 0;
    if (available <= 0) continue;
    marks[index] = "present";
    remaining.set(letter, available - 1);
  }

  return { guess, marks, solved: marks.every((mark) => mark === "correct") };
}
