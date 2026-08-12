import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { msUntilServer } from "@/lib/clock";
import { formatClock } from "@/lib/countdown";
import { useCountdown } from "@/lib/countdown";
import { useReducedMotion } from "@/lib/motion";

interface ProgressRingProps {
  /** Échéance du tour, en ISO. */
  deadlineAt: string;
  /** Durée nominale d'un tour, pour dimensionner l'anneau. */
  turnMs: number;
  /** Diamètre en pixels. */
  size?: number;
  /** Affiche le nombre de secondes restantes au centre de l’anneau. */
  showSeconds?: boolean;
  className?: string;
  /** Contenu au centre — en général l'avatar du joueur au trait. */
  children?: ReactNode;
}

const STROKE = 3;

/**
 * Anneau de temps du tour.
 *
 * **Animé entièrement en CSS, sans un seul rendu React.** Un compteur à 30
 * images par seconde piloté par l'état ferait trente rendus par tour et
 * saccaderait à chaque coup ; ici le GPU compose le tracé et React ne touche
 * plus à rien.
 *
 * Le `animation-delay` **négatif** est ce qui fait qu'un joueur qui recharge sa
 * page à sept secondes d'un tour de trente voit l'anneau déjà au quart. Sans
 * lui, l'anneau repartirait de zéro et mentirait sur le temps restant.
 *
 * La `key` sur le cercle est indispensable : changer une propriété ne relance
 * pas une animation CSS, il faut que l'élément soit remonté.
 */
export function ProgressRing({
  deadlineAt,
  turnMs,
  size = 46,
  showSeconds = false,
  className,
  children,
}: ProgressRingProps) {
  const reduced = useReducedMotion();
  const remaining = useCountdown(deadlineAt);

  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  /**
   * Décalage figé pour toute la durée du tour.
   *
   * Il est calculé **une seule fois par échéance**, et c'est essentiel : le
   * compte à rebours des secondes provoque un rendu par seconde. Recalculer
   * `elapsed` à chaque rendu réécrivait `animation-delay` sur une animation
   * déjà lancée, qui repartait donc une seconde plus loin à chaque seconde —
   * l'anneau se vidait deux fois plus vite que les chiffres au centre.
   */
  const elapsed = useMemo(
    () => Math.round(Math.max(0, Math.min(turnMs, turnMs - msUntilServer(deadlineAt)))),
    [deadlineAt, turnMs],
  );
  const urgent = remaining <= 6_000;
  const seconds = Math.ceil(remaining / 1_000);
  const secondsCounter = showSeconds ? (
    <span
      aria-label={`${seconds} ${seconds === 1 ? "seconde restante" : "secondes restantes"}`}
      className={cn(
        "tabular pointer-events-none absolute inset-0 z-10 grid place-items-center text-[0.78rem] font-bold leading-none",
        urgent ? "text-danger" : "text-cream",
      )}
    >
      {seconds}
    </span>
  ) : null;

  /**
   * En mode « animations réduites », la règle globale de `index.css` impose
   * `animation-duration: 0.01ms !important` — un `!important` de feuille de
   * style bat un style en ligne. L'anneau se viderait donc instantanément et
   * annoncerait un tour expiré alors qu'il reste vingt-cinq secondes. On affiche
   * les secondes en chiffres plutôt que de mentir.
   */
  if (reduced) {
    return (
      <div className={cn("relative grid place-items-center", className)} style={{ width: size, height: size }}>
        {children}
        {secondsCounter}
        {!showSeconds && (
          <span
            className={cn(
              "tabular absolute -bottom-1 rounded bg-felt-deep px-1 text-[10px] font-semibold",
              urgent ? "text-danger" : "text-cream-dim",
            )}
          >
            {formatClock(remaining)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn("relative grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        aria-hidden
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
        style={{ width: size, height: size }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={STROKE}
        />
        <circle
          key={deadlineAt}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={urgent ? "var(--color-danger)" : "var(--color-win)"}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{
            // La circonférence passe par une variable : la même image-clé sert
            // à toutes les tailles d'anneau.
            ["--circonference" as string]: circumference,
            animation: `tour-ring ${turnMs}ms linear forwards`,
            animationDelay: `-${elapsed}ms`,
          }}
        />
      </svg>
      {children}
      {secondsCounter}
    </div>
  );
}
