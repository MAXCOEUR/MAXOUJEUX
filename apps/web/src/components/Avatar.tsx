import { avatarImageUrl, parseAvatarSeed } from "@maxoujeux/shared";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";

interface AvatarProps {
  /** Identifiant du compte : c'est lui qui adresse l'image, pas la graine. */
  userId: string;
  /** Jeton d'avatar, tel qu'il circule dans les charges utiles. */
  seed: string;
  pseudo: string;
  className?: string;
}

/** Hachage déterministe : le même compte a toujours la même teinte, partout. */
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Avatar en jeton de casino : anneau extérieur clair, disque intérieur, initiale
 * gravée.
 *
 * Le dessin procédural n'est plus le seul choix, mais il reste **toujours
 * peint** : la photo téléversée vient se poser par-dessus le disque intérieur.
 * D'où l'absence d'état de chargement — pas de disque vide, pas de saut visuel,
 * et l'anneau conserve l'identité graphique du jeton quelle que soit l'image.
 *
 * Le jeton dit lui-même s'il porte une image : un compte sans photo ne déclenche
 * donc aucune requête.
 *
 * Les teintes restent contraintes en chroma et en clarté pour rester dans la
 * gamme du tapis : un avatar fluo casserait l'ensemble.
 */
export function Avatar({ userId, seed, pseudo, className }: AvatarProps) {
  const { hasImage, tint } = useMemo(() => parseAvatarSeed(seed), [seed]);

  /**
   * L'échec est mémorisé **par URL** et non par un simple booléen : changer
   * d'avatar produit une nouvelle URL et doit lui redonner sa chance, sinon une
   * coupure réseau passagère la condamnerait jusqu'au rechargement de la page.
   */
  const [urlEnEchec, setUrlEnEchec] = useState<string | null>(null);
  const url = hasImage ? avatarImageUrl(userId, seed) : null;

  const { ring, face } = useMemo(() => {
    const hue = hash(tint) % 360;
    return {
      ring: `oklch(0.68 0.11 ${hue})`,
      face: `oklch(0.52 0.09 ${hue})`,
    };
  }, [tint]);

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
        {pseudo.charAt(0).toUpperCase()}
      </span>

      {url !== null && url !== urlEnEchec && (
        /**
         * Dimensions explicites plutôt que les seuls décalages : une image est un
         * élément remplacé, sa taille ne se déduit pas de `inset`.
         * `size-[calc(100%-6px)]` reproduit l'emprise du disque intérieur à
         * toutes les tailles du composant.
         *
         * `alt=""` : l'image est décorative, le nom du joueur reste porté par
         * `title` et par le `sr-only` ci-dessous. Le contrat d'accessibilité est
         * donc rigoureusement inchangé.
         */
        <img
          src={url}
          alt=""
          aria-hidden
          width={128}
          height={128}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setUrlEnEchec(url)}
          className="absolute left-[3px] top-[3px] size-[calc(100%-6px)] rounded-full object-cover"
        />
      )}

      <span className="sr-only">{pseudo}</span>
    </span>
  );
}
