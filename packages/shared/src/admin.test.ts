import { describe, expect, it } from "vitest";
import { createPlayerSchema, resetPlayerPasswordSchema, setPlayerBalanceSchema } from "./admin.js";

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
});
