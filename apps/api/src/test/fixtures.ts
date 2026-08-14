/**
 * Aides communes aux tests d'intégration.
 *
 * Ils tournent sur le pilote configuré par `DATABASE_URL` — PGlite par défaut,
 * PostgreSQL si la variable est présente. **PGlite ne prouve rien sur la
 * concurrence** : c'est une base à connexion unique, qui sérialise les requêtes.
 * Tout scénario concurrent doit être rejoué contre un vrai PostgreSQL :
 *
 *   docker compose -f docker-compose.dev.yml up -d
 *   DATABASE_URL=postgres://maxoujeux:maxoujeux@localhost:5433/maxoujeux \
 *     pnpm --filter @maxoujeux/api test
 */

import { randomBytes } from "node:crypto";
import { achievementReward } from "@maxoujeux/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { matches, users, walletTx, wallets } from "../db/schema.js";

/**
 * Somme des primes des succès nommés.
 *
 * Un compte neuf débloque forcément des succès dès sa première manche gagnée, et
 * la prime tombe sur le même solde que le gain de la partie. Plutôt que d'ajuster
 * les montants attendus à la main — ce qui les rendrait faux au premier
 * réglage du barème — les tests écrivent explicitement quels succès ils
 * s'attendent à voir tomber.
 */
export function primes(...codes: string[]): number {
  return codes.reduce((total, code) => total + achievementReward(code), 0);
}

/** Crée un compte de test avec un solde initial, sans passer par l'inscription. */
export async function makeUser(balance: number): Promise<string> {
  const suffix = randomBytes(6).toString("hex");
  const [user] = await db
    .insert(users)
    .values({
      email: `test-${suffix}@maxoujeux.test`,
      pseudo: `test_${suffix}`,
      passwordHash: "non-utilise-dans-ces-tests",
      avatarSeed: suffix,
    })
    .returning({ id: users.id });

  if (!user) throw new Error("Création du compte de test impossible");

  await db.insert(wallets).values({ userId: user.id, balance });
  return user.id;
}

export async function balanceOf(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  return row?.balance ?? -1;
}

/**
 * Somme des mouvements du journal — doit toujours égaler le solde.
 * C'est l'invariant qui rend l'historique auditable.
 */
export async function ledgerSum(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${walletTx.delta}), 0)::int` })
    .from(walletTx)
    .where(eq(walletTx.userId, userId));
  return row?.total ?? 0;
}

/**
 * Suit les objets créés par un fichier de test pour les effacer à la fin.
 *
 * **Piège** : `matches` n'a aucune clé étrangère vers `users`, la cascade
 * depuis le compte ne l'efface donc pas. Les parties doivent être supprimées
 * explicitement, sinon elles s'accumulent dans la base de développement.
 */
export function trackCreated() {
  const userIds: string[] = [];
  const matchIds: string[] = [];

  return {
    async user(balance: number): Promise<string> {
      const id = await makeUser(balance);
      userIds.push(id);
      return id;
    },
    match(id: string): void {
      matchIds.push(id);
    },
    async cleanup(): Promise<void> {
      if (matchIds.length > 0) {
        await db.delete(matches).where(inArray(matches.id, matchIds));
      }
      for (const id of userIds) {
        await db.delete(users).where(eq(users.id, id));
      }
      userIds.length = 0;
      matchIds.length = 0;
    },
  };
}
