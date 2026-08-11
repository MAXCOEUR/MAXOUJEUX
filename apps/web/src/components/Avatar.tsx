import { useMemo } from "react";
import { cn } from "@/lib/cn";

interface AvatarProps {
  seed: string;
  pseudo: string;
  className?: string;
}

/** Hachage déterministe : le même compte a toujours le même avatar, partout. */
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Avatar procédural : deux teintes dérivées de la graine et l'initiale du pseudo.
 * Évite d'héberger des images et le lot de contraintes qui va avec (upload,
 * stockage, modération).
 */
export function Avatar({ seed, pseudo, className }: AvatarProps) {
  const { from, to } = useMemo(() => {
    const h = hash(seed);
    const hue = h % 360;
    return {
      from: `oklch(0.72 0.17 ${hue})`,
      to: `oklch(0.65 0.16 ${(hue + 55) % 360})`,
    };
  }, [seed]);

  const initial = pseudo.charAt(0).toUpperCase();

  return (
    <div
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full",
        "font-display text-sm font-semibold",
        className,
      )}
      style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
      title={pseudo}
    >
      {/* Texte sombre imposé : les deux teintes générées sont toujours claires. */}
      <span aria-hidden className="text-night">
        {initial}
      </span>
      <span className="sr-only">{pseudo}</span>
    </div>
  );
}
