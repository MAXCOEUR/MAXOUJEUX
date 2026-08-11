import {
  dailyBonusAmount,
  nextMotusSlot,
  nextParisMidnight,
  nextStreak,
  parisDay,
  type WalletEntry,
  type WalletReason,
  type WalletSummary,
} from "@maxoujeux/shared";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, type Database } from "../../db/index.js";
import { dailyClaims, walletTx, wallets } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { isCheckViolation, isUniqueViolation } from "../../lib/pg-errors.js";
import { notifyWallet } from "../../realtime/notify.js";

/**
 * Point de passage **unique** de tout mouvement de MaxouCoin.
 *
 * Aucun module de jeu ne doit écrire dans `wallets` directement : c'est ici que
 * sont garantis l'atomicité du débit, la tenue du journal et l'impossibilité
 * d'un solde négatif.
 */

/**
 * Accepte indifféremment la base ou une transaction en cours.
 * Les deux exposent la même surface de requête ; ce type évite de dupliquer
 * chaque fonction en version « dans une transaction » et « hors transaction ».
 */
type Executor = Pick<Database, "select" | "insert" | "update">;

function assertValidAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    // Un montant fractionnaire ou négatif traduit un bug d'appelant, pas une
    // action de joueur : on refuse avant de toucher à la base.
    throw new Error(`Montant invalide : ${amount}`);
  }
}

/**
 * Crédite un compte et inscrit l'écriture au journal.
 * @returns le nouveau solde
 */
async function creditInto(
  exec: Executor,
  userId: string,
  amount: number,
  reason: WalletReason,
  matchId?: string,
): Promise<number> {
  assertValidAmount(amount);

  const [row] = await exec
    .update(wallets)
    .set({ balance: sql`${wallets.balance} + ${amount}`, updatedAt: new Date() })
    .where(eq(wallets.userId, userId))
    .returning({ balance: wallets.balance });

  if (!row) {
    throw new AppError(404, "WALLET_NOT_FOUND", "Porte-monnaie introuvable");
  }

  await exec.insert(walletTx).values({
    userId,
    delta: amount,
    // Le solde inscrit au journal est celui renvoyé par la base, jamais un
    // calcul applicatif : c'est ce qui rend l'historique auditable.
    balanceAfter: row.balance,
    reason,
    matchId: matchId ?? null,
  });

  return row.balance;
}

/**
 * Débite un compte si — et seulement si — le solde le permet.
 * @returns le nouveau solde
 * @throws AppError 409 si les fonds sont insuffisants
 */
async function debitFrom(
  exec: Executor,
  userId: string,
  amount: number,
  reason: WalletReason,
  matchId?: string,
): Promise<number> {
  assertValidAmount(amount);

  let row: { balance: number } | undefined;
  try {
    // La condition de solde est **dans** l'UPDATE. Lire le solde puis l'écrire
    // dans un second temps autoriserait un double débit : un joueur assis à
    // deux tables, ou avec deux onglets ouverts, peut déclencher deux mises en
    // parallèle et dépenser deux fois le même MaxouCoin.
    [row] = await exec
      .update(wallets)
      .set({ balance: sql`${wallets.balance} - ${amount}`, updatedAt: new Date() })
      .where(and(eq(wallets.userId, userId), gte(wallets.balance, amount)))
      .returning({ balance: wallets.balance });
  } catch (error) {
    if (isCheckViolation(error)) {
      // La contrainte CHECK a rattrapé ce que la clause WHERE aurait dû empêcher :
      // c'est un bug, pas un manque de fonds.
      throw new Error(`Contrainte de solde violée sur ${userId}`, { cause: error });
    }
    throw error;
  }

  // Zéro ligne modifiée : le compte existe mais le solde était insuffisant.
  if (!row) {
    throw new AppError(409, "INSUFFICIENT_FUNDS", "Solde MaxouCoin insuffisant");
  }

  await exec.insert(walletTx).values({
    userId,
    delta: -amount,
    balanceAfter: row.balance,
    reason,
    matchId: matchId ?? null,
  });

  return row.balance;
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

export async function credit(
  userId: string,
  amount: number,
  reason: WalletReason,
  matchId?: string,
): Promise<number> {
  const balance = await db.transaction((tx) => creditInto(tx, userId, amount, reason, matchId));
  notifyWallet(userId, balance);
  return balance;
}

export async function debit(
  userId: string,
  amount: number,
  reason: WalletReason,
  matchId?: string,
): Promise<number> {
  const balance = await db.transaction((tx) => debitFrom(tx, userId, amount, reason, matchId));
  notifyWallet(userId, balance);
  return balance;
}

/** Dernier encaissement de bonus, pour calculer la série en cours. */
async function lastClaim(
  exec: Executor,
  userId: string,
): Promise<{ day: string; streak: number } | null> {
  const [row] = await exec
    .select({ day: dailyClaims.day, streak: dailyClaims.streak })
    .from(dailyClaims)
    .where(eq(dailyClaims.userId, userId))
    .orderBy(desc(dailyClaims.day))
    .limit(1);

  return row ?? null;
}

export async function getSummary(userId: string, now = new Date()): Promise<WalletSummary> {
  const [balanceRow, claim] = await Promise.all([
    db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1)
      .then((rows) => rows[0]),
    lastClaim(db, userId),
  ]);

  if (!balanceRow) {
    throw new AppError(404, "WALLET_NOT_FOUND", "Porte-monnaie introuvable");
  }

  // C'est le serveur qui décide du jour courant. L'horloge du navigateur ne
  // doit jamais pouvoir avancer l'échéance d'un bonus.
  const today = parisDay(now);
  const canClaim = claim?.day !== today;

  const streakIfClaimed = nextStreak(claim?.day ?? null, claim?.streak ?? 0, today);

  // Série réellement en cours. Si elle a été interrompue, on affiche 0 et non
  // l'ancienne valeur : annoncer « série 7 » alors que l'encaissement repartira
  // à 1 serait mensonger.
  const currentStreak = canClaim ? streakIfClaimed - 1 : (claim?.streak ?? 0);

  return {
    balance: balanceRow.balance,
    streak: currentStreak,
    canClaim,
    claimableAmount: dailyBonusAmount(streakIfClaimed),
    nextDayAmount: dailyBonusAmount(streakIfClaimed + 1),
    nextClaimAt: nextParisMidnight(now).toISOString(),
    nextMotusSlotAt: nextMotusSlot(now).toISOString(),
  };
}

export interface ClaimResult {
  amount: number;
  streak: number;
  balance: number;
}

/**
 * Encaisse le bonus quotidien.
 *
 * L'écriture dans `daily_claims` et le crédit sont dans la **même transaction** :
 * la clé primaire `(user_id, day)` rend un double encaissement impossible, même
 * sur deux requêtes simultanées — la seconde viole la contrainte et est refusée
 * sans qu'aucun MaxouCoin n'ait été versé.
 */
export async function claimDailyBonus(userId: string, now = new Date()): Promise<ClaimResult> {
  const today = parisDay(now);

  try {
    const result = await db.transaction(async (tx) => {
      const previous = await lastClaim(tx, userId);
      const streak = nextStreak(previous?.day ?? null, previous?.streak ?? 0, today);
      const amount = dailyBonusAmount(streak);

      // Insertion d'abord : si le bonus du jour est déjà pris, on échoue ici,
      // avant tout mouvement de solde.
      await tx.insert(dailyClaims).values({ userId, day: today, amount, streak });

      const balance = await creditInto(tx, userId, amount, "daily_bonus");
      return { amount, streak, balance };
    });

    // Notification après validation de la transaction : prévenir plus tôt
    // pourrait diffuser un solde qui n'a finalement pas été écrit.
    notifyWallet(userId, result.balance);
    return result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        409,
        "ALREADY_CLAIMED",
        "Bonus déjà encaissé aujourd'hui. Reviens après minuit.",
      );
    }
    throw error;
  }
}

export async function history(userId: string, limit = 20): Promise<WalletEntry[]> {
  const rows = await db
    .select({
      id: walletTx.id,
      delta: walletTx.delta,
      balanceAfter: walletTx.balanceAfter,
      reason: walletTx.reason,
      createdAt: walletTx.createdAt,
    })
    .from(walletTx)
    .where(eq(walletTx.userId, userId))
    .orderBy(desc(walletTx.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));

  return rows.map((row) => ({
    id: row.id,
    delta: row.delta,
    balanceAfter: row.balanceAfter,
    reason: row.reason as WalletReason,
    createdAt: row.createdAt.toISOString(),
  }));
}
