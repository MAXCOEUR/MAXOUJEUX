import type { MotusGuessView, MotusMark } from "@maxoujeux/shared";
import { CornerDownLeft, Delete } from "lucide-react";
import { cn } from "@/lib/cn";
import { motusLetterStates } from "@/lib/motus-input";

const KEY_ROWS = ["AZERTYUIOP", "QSDFGHJKLM"] as const;
const LAST_ROW = "WXCVBN";

const MARK_STYLE: Record<MotusMark, string> = {
  correct: "border-win bg-win text-felt-deep",
  present: "border-game-motus bg-game-motus text-felt-deep",
  absent: "border-line-strong bg-felt-high text-cream-faint",
};

const MARK_LABEL: Record<MotusMark, string> = {
  correct: "bien placée",
  present: "présente ailleurs",
  absent: "absente",
};

interface MotusKeyboardProps {
  guesses: MotusGuessView[];
  disabled: boolean;
  canSubmit: boolean;
  onLetter: (letter: string) => void;
  onErase: () => void;
  onSubmit: () => void;
}

export function MotusKeyboard({
  guesses,
  disabled,
  canSubmit,
  onLetter,
  onErase,
  onSubmit,
}: MotusKeyboardProps) {
  const states = motusLetterStates(guesses);

  function letterKey(letter: string) {
    const mark = states[letter];
    return (
      <button
        key={letter}
        type="button"
        disabled={disabled}
        onClick={() => onLetter(letter)}
        aria-label={`Lettre ${letter}${mark ? `, ${MARK_LABEL[mark]}` : ""}`}
        className={cn(
          "min-w-0 rounded-md border py-2.5 font-display text-sm font-black",
          "transition-[transform,background-color] active:scale-95 disabled:cursor-not-allowed",
          mark ? MARK_STYLE[mark] : "border-line-strong bg-felt-raised text-cream",
          disabled && "opacity-65",
        )}
      >
        {letter}
      </button>
    );
  }

  return (
    <div className="mx-auto grid max-w-xl gap-1.5" role="group" aria-label="Clavier Motus">
      {KEY_ROWS.map((row) => (
        <div key={row} className="grid grid-cols-10 gap-1 sm:gap-1.5">
          {row.split("").map(letterKey)}
        </div>
      ))}
      <div className="grid grid-cols-[1.35fr_repeat(6,minmax(0,1fr))_1.35fr] gap-1 sm:gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={onErase}
          aria-label="Effacer la dernière lettre"
          className="grid place-items-center rounded-md border border-line-strong bg-felt-raised text-cream disabled:opacity-65"
        >
          <Delete className="size-4" aria-hidden />
        </button>
        {LAST_ROW.split("").map(letterKey)}
        <button
          type="button"
          disabled={disabled || !canSubmit}
          onClick={onSubmit}
          aria-label="Valider le mot"
          className="grid place-items-center rounded-md border border-brass bg-brass text-felt-deep disabled:border-line-strong disabled:bg-felt-raised disabled:text-cream-faint"
        >
          <CornerDownLeft className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
