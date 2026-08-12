import { randomBytes } from "node:crypto";
import { markAvatarImage } from "@maxoujeux/shared";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { userAvatars, users } from "../../db/schema.js";

export interface StoredAvatar {
  image: Buffer;
  /** Jeton d'avatar courant du compte, dont se déduit la version de cache. */
  seed: string;
}

/**
 * Écrit l'image **et** fait tourner la graine, dans la même transaction.
 *
 * La rotation est le cœur de la stratégie de cache : elle change l'URL de
 * l'image dans les charges utiles qui transportaient déjà la graine, ce qui
 * permet de servir les octets en `immutable` un an sans jamais rien purger.
 * Écrire l'image sans faire tourner la graine laisserait l'ancienne photo
 * affichée chez tout le monde — c'est le point unique de défaillance du
 * dispositif, d'où la transaction.
 */
export async function writeAvatar(userId: string, image: Buffer): Promise<string> {
  const seed = markAvatarImage(randomBytes(8).toString("hex"));
  const updatedAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .insert(userAvatars)
      .values({ userId, image, updatedAt })
      .onConflictDoUpdate({ target: userAvatars.userId, set: { image, updatedAt } });
    await tx.update(users).set({ avatarSeed: seed }).where(eq(users.id, userId));
  });

  return seed;
}

/**
 * Retire l'image et rend une graine sans préfixe.
 *
 * Dès que la nouvelle graine est propagée, plus aucun client ne demande
 * l'image : elle disparaît de partout sans purge de cache, et une requête forgée
 * sur l'ancienne URL ne trouve plus rien en base.
 */
export async function deleteAvatar(userId: string): Promise<string> {
  const seed = randomBytes(8).toString("hex");

  await db.transaction(async (tx) => {
    await tx.delete(userAvatars).where(eq(userAvatars.userId, userId));
    await tx.update(users).set({ avatarSeed: seed }).where(eq(users.id, userId));
  });

  return seed;
}

/**
 * Seule lecture du projet autorisée à ramener la colonne binaire.
 *
 * Toute autre requête qui la sélectionnerait — résolution de session, liste
 * d'administration — paierait dix kilo-octets par ligne à chaque requête HTTP.
 */
export async function readAvatar(userId: string): Promise<StoredAvatar | null> {
  const [row] = await db
    .select({ image: userAvatars.image, seed: users.avatarSeed })
    .from(userAvatars)
    .innerJoin(users, eq(users.id, userAvatars.userId))
    .where(eq(userAvatars.userId, userId))
    .limit(1);

  return row ?? null;
}
