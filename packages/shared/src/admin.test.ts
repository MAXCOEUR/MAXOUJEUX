import { describe, expect, it } from "vitest";
import {
  banAccountSchema,
  createPlayerSchema,
  resetPlayerPasswordSchema,
  setPlayerBalanceSchema,
  setUserRoleSchema,
} from "./admin.js";

describe("contrats d'administration", () => {
  it("réutilise les règles de compte pour créer un joueur", () => {
    expect(createPlayerSchema.parse({
      email: "joueur@example.test",
      pseudo: "Joueur_1",
      password: "mot-de-passe-solide",
    })).toMatchObject({ pseudo: "Joueur_1" });
  });

  it("refuse un solde négatif, fractionnaire ou hors entier sûr", () => {
    for (const balance of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(setPlayerBalanceSchema.safeParse({ balance }).success).toBe(false);
    }
  });

  it("applique la règle complète de mot de passe à une réinitialisation", () => {
    expect(resetPlayerPasswordSchema.safeParse({ password: "court" }).success).toBe(false);
  });

  it("n'autorise que les rôles non administrateur dans la mutation publique", () => {
    expect(setUserRoleSchema.parse({ role: "moderator" })).toEqual({ role: "moderator" });
    expect(setUserRoleSchema.safeParse({ role: "admin" }).success).toBe(false);
  });

  it("valide un bannissement multi-cible avec motif et durée", () => {
    expect(
      banAccountSchema.parse({
        kinds: ["account", "ip", "device"],
        accessId: "d0d6a930-cc3d-44d3-b6dd-d31de3213269",
        reason: "Contournement répété des règles",
        duration: "7d",
      }),
    ).toMatchObject({ duration: "7d" });

    expect(
      banAccountSchema.safeParse({ kinds: ["ip"], reason: "", duration: "permanent" }).success,
    ).toBe(false);
  });
});
