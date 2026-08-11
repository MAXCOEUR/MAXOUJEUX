import type { GameCode } from "@maxoujeux/shared";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { GameArtefact } from "./GameArtefact";

interface EmptyStateProps {
  /** Artefact du jeu, en filigrane. */
  artefact?: GameCode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Ligne d'appoint sous l'action : contexte utile, jamais une consigne. */
  hint?: ReactNode;
  className?: string;
}

/**
 * État vide.
 *
 * Au lancement du site, « aucune table ouverte » est le cas **le plus
 * fréquent** : il mérite un vrai message et une action, pas une liste vide qui
 * laisse croire que quelque chose est cassé.
 */
export function EmptyState({
  artefact,
  title,
  description,
  action,
  hint,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("panel px-6 py-12 text-center", className)}>
      {artefact && (
        <div aria-hidden className="mx-auto mb-5 w-24 opacity-50 sm:w-28">
          <GameArtefact code={artefact} />
        </div>
      )}

      <p className="font-display text-lg font-bold text-cream">{title}</p>
      {description && (
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-cream-dim">
          {description}
        </p>
      )}

      {action && <div className="mt-6 flex justify-center">{action}</div>}
      {hint && <p className="mt-4 text-xs text-cream-faint">{hint}</p>}
    </div>
  );
}
