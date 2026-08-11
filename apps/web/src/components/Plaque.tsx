import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutre" | "actif" | "gain" | "danger" | "attente";

/**
 * Étiquette d'état gravée.
 *
 * La classe CSS `.plaque` existait déjà mais était recopiée à la main à chaque
 * usage, avec ses six classes de mise en forme. Les tonalités sont la seule
 * chose que le composant ajoute.
 *
 * Le laiton n'apparaît que sur `gain` : il reste le signal de l'argent, pas une
 * couleur d'accent parmi d'autres.
 */
const TONES: Record<Tone, string> = {
  neutre: "plaque",
  attente: "border border-line-strong bg-felt-high/50 text-cream-dim",
  actif: "border border-win/45 bg-win/12 text-win",
  gain: "border border-brass/45 bg-brass/12 text-brass-bright",
  danger: "border border-danger/45 bg-danger/12 text-danger",
};

interface PlaqueProps {
  tone?: Tone;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}

export function Plaque({ tone = "neutre", icon: Icon, className, children }: PlaqueProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1",
        "text-[10px] font-semibold uppercase tracking-wide",
        TONES[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  );
}
