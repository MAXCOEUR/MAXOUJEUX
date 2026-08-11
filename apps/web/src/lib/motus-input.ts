import { normalizeMotusDraft } from "@maxoujeux/engines";
import type { MotusGuessView, MotusMark } from "@maxoujeux/shared";

export type MotusInputCommand =
  | { type: "letter"; letter: string }
  | { type: "erase" }
  | { type: "submit" };

const MARK_PRIORITY: Record<MotusMark, number> = {
  absent: 0,
  present: 1,
  correct: 2,
};

export function motusLetterStates(
  guesses: MotusGuessView[],
): Partial<Record<string, MotusMark>> {
  const states: Partial<Record<string, MotusMark>> = {};

  for (const guess of guesses) {
    guess.guess.split("").forEach((letter, index) => {
      const mark = guess.marks[index];
      const previous = states[letter];
      if (mark && (!previous || MARK_PRIORITY[mark] > MARK_PRIORITY[previous])) {
        states[letter] = mark;
      }
    });
  }

  return states;
}

export function appendMotusLetter(draft: string, letter: string, maxLength: number): string {
  const normalized = normalizeMotusDraft(letter, 1);
  if (!normalized) return draft;
  return normalizeMotusDraft(`${draft}${normalized}`, maxLength);
}

export function eraseMotusLetter(draft: string): string {
  return draft.slice(0, -1);
}

export function motusCommandForKey(key: string, modified: boolean): MotusInputCommand | null {
  if (modified) return null;
  if (key === "Backspace") return { type: "erase" };
  if (key === "Enter") return { type: "submit" };

  const letter = normalizeMotusDraft(key, 1);
  return letter && key.length === 1 ? { type: "letter", letter } : null;
}
