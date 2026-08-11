import { z } from "zod";

export const MOTUS_WORD_LENGTHS = [5, 6, 7, 8] as const;

export type MotusMark = "correct" | "present" | "absent";
export type MotusStatus = "available" | "playing" | "won" | "lost";
export type MotusEndReason = "solved" | "attempts" | "abandoned" | null;

export interface MotusGuessView {
  guess: string;
  marks: MotusMark[];
}

/** État Motus filtré pour le joueur. Le mot secret n'appartient jamais à ce contrat. */
export interface MotusView {
  slotStart: string;
  slotEnd: string;
  nextSlotAt: string;
  isCurrentSlot: boolean;
  canStartCurrent: boolean;
  length: number;
  guesses: MotusGuessView[];
  attemptsLeft: number;
  status: MotusStatus;
  endReason: MotusEndReason;
  stake: number;
  payout: number;
  net: number;
  version: number;
  now: string;
}

export const motusGuessSchema = z.object({
  guess: z.string().trim().min(1).max(16),
  version: z.number().int().nonnegative(),
});

export type MotusGuessInput = z.infer<typeof motusGuessSchema>;

export const MOTUS_ERROR_CODES = [
  "MOTUS_CAPACITY_REACHED",
  "MOTUS_NOT_STARTED",
  "MOTUS_GAME_OVER",
  "MOTUS_INVALID_LENGTH",
  "MOTUS_UNKNOWN_WORD",
  "MOTUS_UNAVAILABLE",
] as const;

export type MotusErrorCode = (typeof MOTUS_ERROR_CODES)[number];

export const MOTUS_ERROR_LABELS: Record<MotusErrorCode, string> = {
  MOTUS_CAPACITY_REACHED: "Les 10 sessions Motus sont occupées. Reviens dans un instant.",
  MOTUS_NOT_STARTED: "Commence le mot avant de proposer une réponse.",
  MOTUS_GAME_OVER: "Cette tentative est déjà terminée.",
  MOTUS_INVALID_LENGTH: "Le mot proposé n'a pas la bonne longueur.",
  MOTUS_UNKNOWN_WORD: "Ce mot n'est pas dans le dictionnaire.",
  MOTUS_UNAVAILABLE: "Aucun mot Motus n'est disponible pour le moment.",
};
