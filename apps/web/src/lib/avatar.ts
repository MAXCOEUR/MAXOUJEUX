import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME,
  AVATAR_SIZE,
  AVATAR_SOURCE_MAX_BYTES,
} from "@maxoujeux/shared";

/** Qualités essayées de la meilleure à la pire. On s'arrête au premier budget tenu. */
const QUALITES = [0.85, 0.7, 0.55, 0.4] as const;

/** Refus attendu, à afficher tel quel au joueur. Tout le reste est un bug. */
export class AvatarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarError";
  }
}

/** Recadrage centré : un portrait garde son visage au milieu au lieu d'être écrasé. */
export function cadrageCarre(largeur: number, hauteur: number) {
  const cote = Math.min(largeur, hauteur);
  return { x: (largeur - cote) / 2, y: (hauteur - cote) / 2, cote };
}

/**
 * Réduit une image en WebP 128×128, **dans le navigateur**.
 *
 * C'est le poste du joueur qui paie le décodage et la compression. Le NAS ne
 * décode aucune image, l'API ne reçoit qu'une dizaine de kilo-octets, et le
 * projet n'ajoute aucune dépendance native — `sharp` ne se construit pas
 * facilement pour la cible ARM64.
 */
export async function reduireAvatar(fichier: File): Promise<Blob> {
  if (fichier.size > AVATAR_SOURCE_MAX_BYTES) {
    throw new AvatarError("Image trop lourde. 12 Mo maximum.");
  }

  /**
   * `createImageBitmap` décode hors du DOM : aucun script embarqué dans le
   * fichier n'a de contexte où s'exécuter, contrairement à un `<img src=blob:>`.
   * `imageOrientation` est indispensable, sans quoi les photos de téléphone
   * arrivent couchées, l'orientation étant portée par l'EXIF.
   */
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(fichier, { imageOrientation: "from-image" });
  } catch {
    throw new AvatarError("Fichier illisible. Choisis un PNG, un JPEG ou un WebP.");
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    /**
     * `alpha: false` retire le canal de transparence du canevas.
     *
     * Sans lui, l'encodeur produit un WebP en conteneur étendu **même sur une
     * image entièrement opaque** : c'est la capacité du canevas qui décide, pas
     * le contenu des pixels. Le serveur accepte les deux, mais le format simple
     * est plus compact et se vérifie plus étroitement.
     */
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new AvatarError("Ton navigateur ne sait pas préparer l'image.");

    // Un canevas sans alpha démarre en noir : on pose le fond du tapis, visible
    // seulement si l'image source n'est pas parfaitement carrée.
    ctx.fillStyle = "#0d1b14";
    ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);

    const { x, y, cote } = cadrageCarre(bitmap.width, bitmap.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, x, y, cote, cote, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

    for (const qualite of QUALITES) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, AVATAR_MIME, qualite),
      );

      if (!blob) throw new AvatarError("Compression de l'image impossible.");
      // Un navigateur sans encodeur WebP retombe silencieusement sur du PNG.
      // Mieux vaut le dire ici qu'attendre un refus incompréhensible de l'API.
      if (blob.type !== AVATAR_MIME) {
        throw new AvatarError("Ton navigateur ne sait pas produire de WebP. Mets-le à jour.");
      }
      if (blob.size <= AVATAR_MAX_BYTES) return blob;
    }

    throw new AvatarError("Image trop détaillée pour un avatar. Essaie-en une autre.");
  } finally {
    bitmap.close();
  }
}
