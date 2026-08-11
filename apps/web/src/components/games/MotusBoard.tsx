import { MOTUS_MAX_ATTEMPTS, type MotusMark, type MotusView } from "@maxoujeux/shared";
import { cn } from "@/lib/cn";

const MARK_STYLE: Record<MotusMark, string> = {
  correct: "border-win bg-win text-felt-deep",
  present: "border-game-motus bg-game-motus text-felt-deep",
  absent: "border-line-strong bg-felt-high text-cream-dim",
};

const MARK_LABEL: Record<MotusMark, string> = {
  correct: "bien placée",
  present: "présente ailleurs",
  absent: "absente",
};

interface MotusBoardProps {
  view: MotusView;
  draft: string;
  pending: boolean;
}

/** Grille purement visuelle : elle ne déduit aucune règle ni aucun résultat. */
export function MotusBoard({ view, draft, pending }: MotusBoardProps) {
  const rows = Array.from({ length: MOTUS_MAX_ATTEMPTS }, (_, index) => index);
  const activeRow = view.status === "playing" ? view.guesses.length : -1;

  return (
    <div
      className="plateau mx-auto grid w-full gap-1.5 sm:gap-2"
      style={{ maxWidth: `${view.length * 3.75}rem` }}
      role="grid"
      aria-label={`Grille Motus de ${MOTUS_MAX_ATTEMPTS} essais et ${view.length} lettres`}
    >
      {rows.map((row) => {
        const confirmed = view.guesses[row];
        const letters = confirmed?.guess ?? (row === activeRow ? draft : "");
        const rowLabel = confirmed
          ? confirmed.guess
              .split("")
              .map((letter, index) => `${letter}, ${MARK_LABEL[confirmed.marks[index] ?? "absent"]}`)
              .join(" ; ")
          : row === activeRow
            ? `Essai ${row + 1} en cours`
            : `Essai ${row + 1} vide`;

        return (
          <div
            key={row}
            role="row"
            aria-label={rowLabel}
            className="grid gap-1.5 sm:gap-2"
            style={{ gridTemplateColumns: `repeat(${view.length}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: view.length }, (_, column) => {
              const letter = letters[column] ?? "";
              const mark = confirmed?.marks[column];
              return (
                <span
                  key={column}
                  role="gridcell"
                  aria-hidden="true"
                  style={confirmed ? { animationDelay: `${column * 55}ms` } : undefined}
                  className={cn(
                    "grid aspect-square min-w-0 place-items-center rounded-lg border",
                    "font-display text-lg font-black sm:text-2xl",
                    confirmed && "animate-flip-up",
                    mark
                      ? MARK_STYLE[mark]
                      : row === activeRow
                        ? cn(
                            "border-game-motus/55 bg-felt-raised text-cream",
                            pending && "opacity-65",
                          )
                        : "border-line bg-felt-deep/45 text-cream-faint",
                  )}
                >
                  {letter}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
