import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { sessions, userAvatars, users, walletTx } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { login } from "../auth/service.js";
import { createSession } from "../auth/session.js";
import { balanceOf, ledgerSum, trackCreated } from "../../test/fixtures.js";
import { writeAvatar } from "./avatar-service.js";
import { anonymiseAccount, changeEmail, changePassword, changePseudo } from "./service.js";

const suivi = trackCreated();

beforeAll(async () => {
  await runMigrations();
});

afterEach(async () => {
  await suivi.cleanup();
});

async function compte(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new Error("Compte introuvable");
  return row;
}

async function echec(action: Promise<unknown>): Promise<AppError> {
  try {
    await action;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("Cette action aurait dû échouer");
}

describe("changeEmail", () => {
  it("refuse une adresse déjà prise, quelle que soit la casse", async () => {
    const premier = await suivi.user(0);
    const second = await suivi.user(0);
    const { email } = await compte(premier);

    const erreur = await echec(changeEmail(second, { email: email.toUpperCase() }));

    expect(erreur.statusCode).toBe(409);
    expect(erreur.code).toBe("EMAIL_TAKEN");
    // Le champ fautif est désigné : c'est ce qui permet d'afficher le message
    // sous l'input plutôt qu'en bandeau générique.
    expect(erreur.fields).toHaveProperty("email");
  });

  it("laisse un joueur corriger la casse de sa propre adresse", async () => {
    const userId = await suivi.user(0);
    const { email } = await compte(userId);

    const profil = await changeEmail(userId, { email: email.toUpperCase().toLowerCase() });

    expect(profil.email).toBe(email);
  });
});

describe("changePseudo", () => {
  it("refuse un pseudo déjà pris, quelle que soit la casse", async () => {
    const premier = await suivi.user(0);
    const second = await suivi.user(0);
    const { pseudo } = await compte(premier);

    const erreur = await echec(changePseudo(second, { pseudo: pseudo.toUpperCase() }));

    expect(erreur.code).toBe("PSEUDO_TAKEN");
    expect(erreur.fields).toHaveProperty("pseudo");
  });

  it("renvoie le profil à jour", async () => {
    const userId = await suivi.user(250);

    const profil = await changePseudo(userId, { pseudo: "Renomme_1" });

    expect(profil.pseudo).toBe("Renomme_1");
    // Le solde vient de la jointure : un profil sans lui casserait l'en-tête.
    expect(profil.balance).toBe(250);
  });
});

describe("changePassword", () => {
  it("révoque toutes les sessions du compte", async () => {
    const userId = await suivi.user(0);
    await createSession(userId, { ip: "127.0.0.1", userAgent: "test" });
    await createSession(userId, { ip: "127.0.0.2", userAgent: "test" });

    await changePassword(userId, { password: "motdepasse-neuf" });

    const restantes = await db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(restantes).toHaveLength(0);
  });

  it("rend le nouveau mot de passe utilisable", async () => {
    const userId = await suivi.user(0);
    const { email } = await compte(userId);

    await changePassword(userId, { password: "motdepasse-neuf" });

    const profil = await login({ email, password: "motdepasse-neuf" });
    expect(profil.id).toBe(userId);
  });
});

describe("anonymiseAccount", () => {
  it("efface l'identité sans toucher au porte-monnaie", async () => {
    const userId = await suivi.user(1_500);
    const avant = await compte(userId);
    await db.insert(walletTx).values({
      userId,
      delta: 1_500,
      balanceAfter: 1_500,
      reason: "signup_bonus",
    });

    await anonymiseAccount(userId);

    const apres = await compte(userId);
    expect(apres.email).not.toBe(avant.email);
    expect(apres.pseudo).not.toBe(avant.pseudo);
    expect(apres.passwordHash).not.toBe(avant.passwordHash);
    expect(apres.avatarSeed).not.toBe(avant.avatarSeed);
    expect(apres.deletedAt).not.toBeNull();

    // Le cœur de la décision : des manches partagées avec d'autres joueurs
    // s'appuient sur ces lignes, elles doivent survivre intactes.
    expect(await balanceOf(userId)).toBe(1_500);
    expect(await ledgerSum(userId)).toBe(1_500);
  });

  it("interdit toute reconnexion avec l'ancienne adresse", async () => {
    const userId = await suivi.user(0);
    const { email } = await compte(userId);
    await changePassword(userId, { password: "motdepasse-neuf" });

    await anonymiseAccount(userId);

    const erreur = await echec(login({ email, password: "motdepasse-neuf" }));
    expect(erreur.statusCode).toBe(401);
  });

  it("supprime l'image d'avatar", async () => {
    const userId = await suivi.user(0);
    await writeAvatar(userId, Buffer.from("des octets"));

    await anonymiseAccount(userId);

    const restantes = await db
      .select()
      .from(userAvatars)
      .where(eq(userAvatars.userId, userId));
    expect(restantes).toHaveLength(0);
  });

  it("est idempotente : un double clic ne casse rien", async () => {
    const userId = await suivi.user(0);

    await anonymiseAccount(userId);
    const premier = await compte(userId);
    await anonymiseAccount(userId);
    const second = await compte(userId);

    // Deuxième passage sans effet : l'email n'est pas réécrit une seconde fois.
    expect(second.email).toBe(premier.email);
    expect(second.deletedAt).toEqual(premier.deletedAt);
  });

  it("ferme deux comptes sans collision d'unicité", async () => {
    const premier = await suivi.user(0);
    const second = await suivi.user(0);

    await anonymiseAccount(premier);
    await anonymiseAccount(second);

    expect((await compte(premier)).email).not.toBe((await compte(second)).email);
    expect((await compte(premier)).pseudo).not.toBe((await compte(second)).pseudo);
  });

  it("refuse de fermer un compte administrateur", async () => {
    const userId = await suivi.user(0);
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, userId));

    const erreur = await echec(anonymiseAccount(userId));

    // Sans ce refus, l'email d'administration redeviendrait libre et le
    // démarrage suivant recréerait un second compte administrateur.
    expect(erreur.code).toBe("ADMIN_SELF_DELETE_FORBIDDEN");
    expect((await compte(userId)).deletedAt).toBeNull();
  });
});
