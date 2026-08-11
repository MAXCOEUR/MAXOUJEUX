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
 * Avatar procédural, dessiné comme un jeton de casino : anneau extérieur plus
 * clair, disque intérieur, initiale gravée. Évite d'héberger des images et le
 * lot de contraintes qui va avec (envoi, stockage, modération).
 *
 * Les teintes sont contraintes en chroma et en clarté pour rester dans la
 * gamme du tapis : un avatar fluo casserait l'ensemble.
 */
export function Avatar({ seed, pseudo, className }: AvatarProps) {
  const { ring, face } = useMemo(() => {
    const hue = hash(seed) % 360;
    return {
      ring: `oklch(0.68 0.11 ${hue})`,
      face: `oklch(0.52 0.09 ${hue})`,
    };
  }, [seed]);

  const initial = pseudo.charAt(0).toUpperCase();

  return (
    <span
      className={cn(
        "relative grid size-9 shrink-0 place-items-center rounded-full",
        "font-display text-sm font-bold",
        className,
      )}
      style={{ backgroundColor: ring }}
      title={pseudo}
    >
      {/* Disque intérieur : c'est ce qui fait lire un jeton plutôt qu'une bille. */}
      <span
        aria-hidden
        className="absolute inset-[3px] rounded-full"
        style={{ backgroundColor: face }}
      />
      <span aria-hidden className="relative text-cream">
        {initial}
      </span>
      <span className="sr-only">{pseudo}</span>
    </span>
  );
}
