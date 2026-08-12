import { AVATAR_MAX_BYTES } from "@maxoujeux/shared";
import { describe, expect, it } from "vitest";
import { AppError } from "../../lib/errors.js";
import { decoderAvatar } from "./avatar.js";

/**
 * Le contrôle des octets est la seule barrière entre un formulaire public et ce
 * que l'API renverra plus tard sous un type image. Ces cas valent donc plus que
 * tout le reste du module : chacun correspond à un fichier qu'un client bricolé
 * pourrait réellement déposer.
 */

/** Enveloppe RIFF/WEBP autour d'un chunk, avec la taille correctement annoncée. */
function riff(chunk: Buffer, marqueur = "WEBP"): Buffer {
  const corps = Buffer.concat([Buffer.from(marqueur, "ascii"), chunk]);
  const entete = Buffer.alloc(8);
  entete.write("RIFF", 0, "ascii");
  entete.writeUInt32LE(corps.length, 4);
  return Buffer.concat([entete, corps]);
}

/** Chunk VP8 lossy minimal, dimensions choisies. */
function chunkLossy(largeur: number, hauteur: number, remplissage = 40): Buffer {
  const donnees = Buffer.alloc(Math.max(remplissage, 20));
  // Code de synchronisation du bitstream, puis les dimensions sur 14 bits.
  donnees.writeUInt8(0x9d, 3);
  donnees.writeUInt8(0x01, 4);
  donnees.writeUInt8(0x2a, 5);
  donnees.writeUInt16LE(largeur, 6);
  donnees.writeUInt16LE(hauteur, 8);

  const entete = Buffer.alloc(8);
  entete.write("VP8 ", 0, "ascii");
  entete.writeUInt32LE(donnees.length, 4);
  return Buffer.concat([entete, donnees]);
}

/** Chunk VP8L : signature, puis largeur et hauteur diminuées de un, sur 14 bits. */
function chunkLossless(largeur: number, hauteur: number): Buffer {
  const donnees = Buffer.alloc(24);
  donnees.writeUInt8(0x2f, 0);
  donnees.writeUInt32LE((largeur - 1) | ((hauteur - 1) << 14), 1);

  const entete = Buffer.alloc(8);
  entete.write("VP8L", 0, "ascii");
  entete.writeUInt32LE(donnees.length, 4);
  return Buffer.concat([entete, donnees]);
}

/**
 * Chunk VP8X, le conteneur étendu que produit un canevas HTML.
 *
 * Dimensions sur 24 bits diminuées de un, précédées d'un octet de drapeaux dont
 * le bit 1 signale une animation.
 */
function chunkEtendu(largeur: number, hauteur: number, anime = false): Buffer {
  const donnees = Buffer.alloc(10);
  donnees.writeUInt8(anime ? 0x02 : 0x10, 0);
  donnees.writeUIntLE(largeur - 1, 4, 3);
  donnees.writeUIntLE(hauteur - 1, 7, 3);

  const entete = Buffer.alloc(8);
  entete.write("VP8X", 0, "ascii");
  entete.writeUInt32LE(donnees.length, 4);
  return Buffer.concat([entete, donnees, chunkLossy(largeur, hauteur)]);
}

function refus(octets: Buffer): AppError {
  try {
    decoderAvatar(octets);
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("Ces octets auraient dû être refusés");
}

describe("decoderAvatar", () => {
  it("accepte un WebP avec perte de la taille attendue", () => {
    const octets = riff(chunkLossy(128, 128));
    expect(decoderAvatar(octets)).toBe(octets);
  });

  it("accepte un WebP sans perte de la taille attendue", () => {
    const octets = riff(chunkLossless(128, 128));
    expect(decoderAvatar(octets)).toBe(octets);
  });

  it("refuse un SVG, qui est un document capable de porter du script", () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>`.padEnd(64));
    expect(refus(svg).code).toBe("AVATAR_INVALID");
  });

  it("refuse les autres formats d'image", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(60)]);
    const gif = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(60)]);
    expect(refus(png).code).toBe("AVATAR_INVALID");
    expect(refus(gif).code).toBe("AVATAR_INVALID");
  });

  it("refuse un conteneur RIFF qui n'annonce pas du WebP", () => {
    expect(refus(riff(chunkLossy(128, 128), "WAVE")).message).toMatch(/pas une image WebP/);
  });

  it("accepte le conteneur étendu, celui que produit un canevas HTML", () => {
    // Un canevas porte un canal alpha par défaut : refuser ce conteneur
    // rejetait en pratique toute image, même parfaitement opaque.
    const octets = riff(chunkEtendu(128, 128));
    expect(decoderAvatar(octets)).toBe(octets);
  });

  it("refuse un avatar animé", () => {
    expect(refus(riff(chunkEtendu(128, 128, true))).message).toMatch(/animé/);
  });

  it("contrôle les dimensions du conteneur étendu comme des autres", () => {
    expect(refus(riff(chunkEtendu(512, 512))).message).toMatch(/128×128/);
  });

  it("refuse un conteneur inconnu", () => {
    const inconnu = Buffer.alloc(8);
    inconnu.write("XXXX", 0, "ascii");
    inconnu.writeUInt32LE(20, 4);
    expect(refus(riff(Buffer.concat([inconnu, Buffer.alloc(20)]))).message).toMatch(/non accepté/);
  });

  it("refuse une charge utile cachée derrière l'image", () => {
    const octets = Buffer.concat([riff(chunkLossy(128, 128)), Buffer.from("charge cachée")]);
    expect(refus(octets).message).toMatch(/incohérente/);
  });

  it("refuse une image qui n'est pas exactement au format demandé", () => {
    expect(refus(riff(chunkLossy(64, 64))).message).toMatch(/128×128/);
    expect(refus(riff(chunkLossy(128, 96))).message).toMatch(/128×128/);
  });

  it("refuse une bombe de décompression, quel que soit son poids", () => {
    // Quelques dizaines d'octets qui déclarent 16383×16383 : un gigaoctet à
    // allouer pour le navigateur qui l'afficherait.
    expect(refus(riff(chunkLossless(16383, 16383))).message).toMatch(/128×128/);
  });

  it("refuse au-delà du budget de stockage", () => {
    const trop = riff(chunkLossy(128, 128, AVATAR_MAX_BYTES));
    expect(refus(trop).message).toMatch(/trop lourde/);
  });

  it("refuse une image vide ou tronquée", () => {
    expect(refus(Buffer.alloc(0)).message).toMatch(/vide/);
    expect(refus(Buffer.from("RIFF", "ascii")).message).toMatch(/tronquée/);
  });
});
