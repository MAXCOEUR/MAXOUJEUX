/**
 * Format du jeton d'avatar.
 *
 * `avatarSeed` circule déjà dans huit contrats — session, admin, chat, présence,
 * sièges de duel, blackjack, roulette, poignée de main. Plutôt que d'ajouter un
 * neuvième champ dans chacun d'eux, le jeton porte deux informations :
 *
 *     d4f8a1b2c3d4e5f6        avatar procédural, la valeur donne la teinte
 *     img:d4f8a1b2c3d4e5f6    une image existe ; la valeur sert de teinte de
 *                             repli **et** de version d'URL pour le cache
 *
 * Lire un préfixe plutôt qu'un champ dédié ne se défend que sous quatre
 * conditions, et elles sont toutes tenues ici :
 *
 * - le jeton est fabriqué exclusivement par le serveur — un `avatarSeed` envoyé
 *   par un client est déjà ignoré au profit de `socket.data` ;
 * - le format est déclaré et testé ici, jamais deviné ailleurs ;
 * - un seul consommateur le décode, le composant `Avatar` ;
 * - l'absence de préfixe reste valide, donc les comptes existants gardent leur
 *   graine et leur couleur sans aucune migration de données.
 *
 * La graine est refabriquée à chaque ajout et à chaque retrait d'image. C'est ce
 * qui rend le cache trivial : l'URL change, donc rien n'a jamais besoin d'être
 * purgé — et la nouvelle version voyage gratuitement dans les charges utiles qui
 * transportaient déjà la graine.
 */

export const AVATAR_IMAGE_PREFIX = "img:";

/** Côté du carré produit par le navigateur. Le serveur refuse toute autre dimension. */
export const AVATAR_SIZE = 128;

export const AVATAR_MIME = "image/webp";

/**
 * Budget d'une image en base.
 *
 * Un 128×128 WebP pèse 6 à 12 ko. Le plafond à 32 ko laisse de la marge aux
 * photos très texturées sans transformer la route en dépôt de fichiers : c'est
 * la vraie ligne de défense du stockage, celle qui protège le NAS.
 */
export const AVATAR_MAX_BYTES = 32 * 1024;

/**
 * Formats proposés dans le sélecteur de fichier.
 *
 * Surtout pas `image/*` : un iPhone proposerait des HEIC en priorité, que
 * `createImageBitmap` ne décode pas hors Safari.
 */
export const AVATAR_SOURCE_ACCEPT = "image/png,image/jpeg,image/webp";

/** Garde-fou avant décodage, côté navigateur. */
export const AVATAR_SOURCE_MAX_BYTES = 12 * 1024 * 1024;

export interface AvatarToken {
  /** Une image est stockée pour ce compte. */
  hasImage: boolean;
  /** Valeur hachée pour dériver la teinte du dessin procédural. */
  tint: string;
  /** Version opaque, portée par l'URL pour la rendre immuable. */
  version: string;
}

export function parseAvatarSeed(seed: string): AvatarToken {
  const hasImage = seed.startsWith(AVATAR_IMAGE_PREFIX);
  const value = hasImage ? seed.slice(AVATAR_IMAGE_PREFIX.length) : seed;
  return { hasImage, tint: value, version: value };
}

/** Marque une graine comme portant une image. Appelée par le serveur uniquement. */
export function markAvatarImage(value: string): string {
  return `${AVATAR_IMAGE_PREFIX}${value}`;
}

/**
 * URL de l'image d'un compte.
 *
 * La version passe en paramètre de requête et non dans le chemin : le chemin
 * reste stable et lisible en journal, et la rotation de graine suffit à
 * invalider le cache.
 */
export function avatarImageUrl(userId: string, seed: string): string {
  const { version } = parseAvatarSeed(seed);
  return `/api/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(version)}`;
}
