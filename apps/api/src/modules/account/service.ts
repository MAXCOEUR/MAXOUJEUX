import { randomBytes } from "node:crypto";
import type {
  UpdateEmailInput,
  UpdatePasswordInput,
  UpdatePseudoInput,
} from "@maxoujeux/shared";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { userAvatars, users, wallets } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { isUniqueViolation } from "../../lib/pg-errors.js";
import { disconnectUser, notifyIdentity } from "../../realtime/notify.js";
import { hashPassword } from "../auth/password.js";
import { revokeAllSessionsIn, type AuthenticatedUser } from "../auth/session.js";
import { blockActivity, unblockActivity } from "../games/activity.js";

/**
 * Ce qu'un joueur peut changer sur son propre compte.
 *
 * Les patrons viennent d'ailleurs et c'est voulu : le contrôle d'unicité est
 * celui de `createAccount`, le changement de mot de passe celui de
 * `resetPlayerPassword` côté admin, la fermeture celui de `deletePlayer`. Trois
 * variantes de la même écriture divergeraient à la première correction.
 */

/** Relit le profil complet, solde compris, pour le renvoyer au client. */
async function relireCompte(userId: string): Promise<AuthenticatedUser> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      pseudo: users.pseudo,
      avatarSeed: users.avatarSeed,
      role: users.role,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
      balance: wallets.balance,
    })
    .from(users)
    .innerJoin(wallets, eq(wallets.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Compte introuvable");
  return {
    ...row,
    sessionId: "",
    ip: null,
    deviceHash: null,
    balance: row.balance ?? 0,
  };
}

/**
 * Le champ est-il déjà porté par **quelqu'un d'autre** ?
 *
 * L'exclusion de l'appelant n'est pas un détail : sans elle, corriger la casse
 * de son propre email — « Max@… » en « max@… » — se ferait refuser au motif
 * qu'il est déjà pris, par soi-même.
 */
async function prisParUnAutre(
  userId: string,
  colonne: typeof users.email | typeof users.pseudo,
  valeur: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${colonne}) = ${valeur.toLowerCase()}`, ne(users.id, userId)))
    .limit(1);
  return row !== undefined;
}

export async function changeEmail(
  userId: string,
  input: UpdateEmailInput,
): Promise<AuthenticatedUser> {
  if (await prisParUnAutre(userId, users.email, input.email)) {
    throw new AppError(409, "EMAIL_TAKEN", "Cet email est déjà utilisé", {
      email: "Un compte existe déjà avec cet email",
    });
  }

  try {
    await db.update(users).set({ email: input.email }).where(eq(users.id, userId));
  } catch (error) {
    // Le pré-contrôle sert à désigner le champ fautif ; l'index unique reste la
    // vraie garantie si deux comptes visent la même adresse en même temps.
    if (isUniqueViolation(error)) {
      throw new AppError(409, "EMAIL_TAKEN", "Cet email vient d'être pris", {
        email: "Un compte existe déjà avec cet email",
      });
    }
    throw error;
  }

  return relireCompte(userId);
}

export async function changePseudo(
  userId: string,
  input: UpdatePseudoInput,
): Promise<AuthenticatedUser> {
  if (await prisParUnAutre(userId, users.pseudo, input.pseudo)) {
    throw new AppError(409, "PSEUDO_TAKEN", "Ce pseudo est déjà pris", {
      pseudo: "Ce pseudo est déjà pris",
    });
  }

  try {
    await db.update(users).set({ pseudo: input.pseudo }).where(eq(users.id, userId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, "PSEUDO_TAKEN", "Ce pseudo vient d'être pris", {
        pseudo: "Ce pseudo est déjà pris",
      });
    }
    throw error;
  }

  const compte = await relireCompte(userId);
  // Les tables et la présence gardent une copie du pseudo : sans cette annonce,
  // le joueur resterait affiché sous son ancien nom jusqu'à sa reconnexion.
  notifyIdentity(userId, { pseudo: compte.pseudo });
  return compte;
}

/**
 * Change le mot de passe et révoque **toutes** les sessions.
 *
 * L'appelant compris : c'est la route qui lui en rouvre une aussitôt, parce
 * qu'elle seule tient la réponse HTTP où poser le cookie. Garder ce service
 * ignorant de Fastify le rend testable sans monter un serveur.
 */
export async function changePassword(userId: string, input: UpdatePasswordInput): Promise<void> {
  // Argon2 dure une centaine de millisecondes : hors transaction, comme partout
  // ailleurs dans le projet, pour ne pas tenir un verrou pendant ce temps.
  const passwordHash = await hashPassword(input.password);

  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    await revokeAllSessionsIn(tx, userId);
  });
}

/**
 * Ferme un compte sans supprimer sa ligne.
 *
 * Huit tables référencent `users` en `on delete cascade` : un vrai `DELETE`
 * emporterait les manches, les statistiques et tout le journal du porte-monnaie
 * — dont dépendent les soldes des **autres** joueurs. On efface donc uniquement
 * ce qui désigne la personne, et le reste garde son sens.
 */
export async function anonymiseAccount(userId: string): Promise<void> {
  // Réservation synchrone avant le premier `await`, comme pour la suppression
  // administrateur : aucune partie ne peut démarrer pendant que la fermeture
  // attend la base.
  if (!blockActivity(userId)) {
    throw new AppError(409, "ACCOUNT_ACTIVE", "Termine ta partie avant de fermer ton compte");
  }

  try {
    // Un vrai hash d'un secret jamais conservé, et non une chaîne bidon :
    // `verifyPassword` lèverait sur un hash malformé et transformerait un refus
    // propre en erreur 500.
    const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
    // 32 hexadécimaux uniques par construction : c'est ce qui permet de fermer
    // un deuxième compte sans violer l'unicité de l'email et du pseudo.
    const marqueur = userId.replaceAll("-", "");

    await db.transaction(async (tx) => {
      const [cible] = await tx
        .select({ isAdmin: users.isAdmin, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!cible) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Compte introuvable");
      // Idempotent : un double clic ne doit pas produire une erreur.
      if (cible.deletedAt) return;
      if (cible.isAdmin) {
        // Sans ce refus, l'email d'administration redeviendrait libre et
        // `bootstrapAdmin` recréerait un second compte au prochain démarrage.
        throw new AppError(
          409,
          "ADMIN_SELF_DELETE_FORBIDDEN",
          "Un compte administrateur ne peut pas être fermé depuis cet écran",
        );
      }

      await tx
        .update(users)
        .set({
          // `.invalid` est un domaine réservé (RFC 2606) : aucune collision
          // possible avec une adresse réelle, et rien ne partira jamais dessus.
          email: `supprime.${marqueur}@compte.invalid`,
          // L'espace est interdit par le format des pseudos : personne ne
          // pourra jamais se réinscrire sous ce nom et se faire passer pour lui.
          pseudo: `Joueur supprimé ${marqueur.slice(0, 8)}`,
          passwordHash,
          avatarSeed: randomBytes(8).toString("hex"),
          emailVerified: false,
          deletedAt: new Date(),
        })
        .where(eq(users.id, userId));

      await tx.delete(userAvatars).where(eq(userAvatars.userId, userId));
      await revokeAllSessionsIn(tx, userId);
    });
  } finally {
    unblockActivity(userId);
  }

  // Après validation seulement : aucune socket ne doit survivre à la fermeture.
  disconnectUser(userId);
}
