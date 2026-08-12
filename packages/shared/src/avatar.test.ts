import { describe, expect, it } from "vitest";
import { avatarImageUrl, markAvatarImage, parseAvatarSeed } from "./avatar.js";

describe("jeton d'avatar", () => {
  it("lit une graine héritée comme un avatar procédural", () => {
    // Aucune migration de données : les comptes créés avant les images gardent
    // leur graine, et donc leur couleur.
    const jeton = parseAvatarSeed("d4f8a1b2c3d4e5f6");

    expect(jeton.hasImage).toBe(false);
    expect(jeton.tint).toBe("d4f8a1b2c3d4e5f6");
  });

  it("reconnaît une graine porteuse d'image et en extrait la version", () => {
    const jeton = parseAvatarSeed(markAvatarImage("d4f8a1b2c3d4e5f6"));

    expect(jeton.hasImage).toBe(true);
    expect(jeton.version).toBe("d4f8a1b2c3d4e5f6");
    // La teinte reste dérivable : le dessin procédural sert de repli permanent.
    expect(jeton.tint).toBe("d4f8a1b2c3d4e5f6");
  });

  it("construit une URL versionnée, seule façon d'invalider le cache", () => {
    const url = avatarImageUrl("11111111-1111-4111-8111-111111111111", markAvatarImage("abcd"));

    expect(url).toBe("/api/users/11111111-1111-4111-8111-111111111111/avatar?v=abcd");
  });

  it("échappe les valeurs placées dans l'URL", () => {
    expect(avatarImageUrl("a/b", "c&d")).toBe("/api/users/a%2Fb/avatar?v=c%26d");
  });
});
