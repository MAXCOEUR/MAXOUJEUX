import { AVATAR_MAX_BYTES, AVATAR_SIZE } from "@maxoujeux/shared";
import { AppError } from "../../lib/errors.js";

/**
 * Contrôle des octets d'un avatar.
 *
 * Le serveur ne redimensionne rien : le navigateur a déjà produit un 128×128.
 * Ce qui se joue ici, c'est qu'un client bricolé ne dépose pas autre chose. Ni
 * le type MIME annoncé ni l'extension ne sont consultés — **seuls les octets
 * décident**.
 *
 * Le format toléré est volontairement le plus étroit possible : un WebP simple,
 * avec ou sans perte, de la taille exacte attendue. Ce que cela écarte :
 *
 * - le SVG, qui est un document XML capable de porter du script ;
 * - le PNG, le JPEG, le GIF, et le HTML déguisé en image ;
 * - le conteneur étendu `VP8X`, donc les WebP animés et à canal alpha ;
 * - les bombes de décompression : un WebP sans perte de quelques kilo-octets
 *   peut déclarer 16383×16383 et faire allouer un gigaoctet au navigateur qui
 *   l'affiche. Exiger 128×128 ferme cette porte, quel que soit le poids.
 */

/** En-tête RIFF (12) + en-tête de chunk (8) + en-tête de bitstream (10). */
const TAILLE_MINIMALE = 30;

export function decoderAvatar(octets: Buffer): Buffer {
  if (octets.length === 0) throw invalide("Image vide");
  if (octets.length > AVATAR_MAX_BYTES) throw invalide("Image trop lourde");
  if (octets.length < TAILLE_MINIMALE) throw invalide("Image tronquée");

  if (octets.toString("ascii", 0, 4) !== "RIFF" || octets.toString("ascii", 8, 12) !== "WEBP") {
    throw invalide("Ce fichier n'est pas une image WebP");
  }

  // La taille annoncée par le conteneur doit correspondre aux octets reçus,
  // sinon une charge utile voyage cachée derrière l'image.
  if (octets.readUInt32LE(4) !== octets.length - 8) {
    throw invalide("Image incohérente");
  }

  const chunk = octets.toString("ascii", 12, 16);
  const { largeur, hauteur } =
    chunk === "VP8 "
      ? dimensionsLossy(octets)
      : chunk === "VP8L"
        ? dimensionsLossless(octets)
        : (() => {
            throw invalide("Format WebP non accepté");
          })();

  if (largeur !== AVATAR_SIZE || hauteur !== AVATAR_SIZE) {
    throw invalide(`L'avatar doit faire ${AVATAR_SIZE}×${AVATAR_SIZE} pixels`);
  }

  return octets;
}

/** Bitstream VP8 : code de synchronisation, puis 14 bits de largeur et de hauteur. */
function dimensionsLossy(octets: Buffer): { largeur: number; hauteur: number } {
  if (octets[23] !== 0x9d || octets[24] !== 0x01 || octets[25] !== 0x2a) {
    throw invalide("Image WebP corrompue");
  }
  return {
    largeur: octets.readUInt16LE(26) & 0x3fff,
    hauteur: octets.readUInt16LE(28) & 0x3fff,
  };
}

/**
 * Bitstream VP8L : octet de signature `0x2f`, puis 14 bits de largeur et 14 de
 * hauteur, empaquetés en petit-boutien et **diminués de un**.
 */
function dimensionsLossless(octets: Buffer): { largeur: number; hauteur: number } {
  if (octets[20] !== 0x2f) throw invalide("Image WebP corrompue");
  const bits = octets.readUInt32LE(21);
  return {
    largeur: (bits & 0x3fff) + 1,
    hauteur: ((bits >>> 14) & 0x3fff) + 1,
  };
}

function invalide(message: string): AppError {
  return new AppError(400, "AVATAR_INVALID", message, { avatar: message });
}
