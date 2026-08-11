import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatClock, formatDuration, useCountdown } from "@/lib/countdown";

interface CountdownProps {
  to: string | undefined | null;
  /** `duree` : « 3 h 12 min 40 s ». `horloge` : « 0:12 », pour un espace étroit. */
  format?: "duree" | "horloge";
  /** En dessous de ce seuil, la valeur passe en rouge. */
  urgentBelowMs?: number;
  className?: string;
  /** Affiché quand l'échéance est absente ou dépassée. */
  fallback?: ReactNode;
}

/**
 * Compte à rebours affiché.
 *
 * **Jamais de `aria-live` ici.** Un lecteur d'écran annoncerait chaque seconde
 * et couvrirait tout le reste de la page, y compris l'annonce du tour. Les
 * seuils utiles sont annoncés ailleurs, une seule fois, par la région dédiée de
 * la table.
 */
export function Countdown({
  to,
  format = "duree",
  urgentBelowMs,
  className,
  fallback,
}: CountdownProps) {
  const remaining = useCountdown(to);

  if (!to || (remaining <= 0 && fallback !== undefined)) {
    return <>{fallback ?? null}</>;
  }

  const urgent = urgentBelowMs !== undefined && remaining <= urgentBelowMs;

  return (
    <span className={cn("tabular", urgent && "text-danger", className)}>
      {format === "horloge" ? formatClock(remaining) : formatDuration(remaining)}
    </span>
  );
}
