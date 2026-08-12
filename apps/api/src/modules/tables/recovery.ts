/**
 * Reprise des tours restés ouverts après un arrêt brutal.
 *
 * Les tables de casino vivent en mémoire : un redémarrage les efface, mais pas
 * les débits déjà écrits en base. Sans cette reprise, un joueur dont la mise a
 * été débitée une seconde avant la coupure ne reverrait jamais ses jetons.
 *
 * Le remboursement se calcule sur le **journal**, pas sur un état applicatif
 * disparu : la somme des mouvements rattachés à la manche donne exactement ce
 * qui a été engagé et jamais rendu. C'est la même propriété qui rend
 * l'historique auditable — `SUM(delta)` doit toujours égaler `wallets.balance`.
 *
 * La fonction est **idempotente** : une manche déjà annulée n'est plus
 * sélectionnée, et la relancer deux fois de suite ne crédite rien la seconde
 * fois. Les tests s'appuient sur cette propriété.
 */

import type { WalletReason } from "@maxoujeux/shared";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { matches, walletTx } from "../../db/schema.js";
import { notifyWallet } from "../../realtime/notify.js";
import { creditInTx } from "../wallet/service.js";

export async function recoverOpenRounds(game: string, refundReason: WalletReason): Promise<void> {
  const open = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.game, game), sql`${matches.status} not in ('finished', 'cancelled')`));

  for (const match of open) {
    const balances = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          userId: walletTx.userId,
          total: sql<number>`coalesce(sum(${walletTx.delta}), 0)::int`,
        })
        .from(walletTx)
        .where(eq(walletTx.matchId, match.id))
        .groupBy(walletTx.userId);

      const result = new Map<string, number>();
      for (const row of rows) {
        // Un solde négatif sur la manche : le joueur a misé sans jamais être
        // payé. Un solde positif ou nul ne doit rien déclencher, sous peine de
        // créditer deux fois un gain déjà versé.
        if (row.total < 0) {
          result.set(row.userId, await creditInTx(tx, row.userId, -row.total, refundReason, match.id));
        }
      }
      await tx.update(matches).set({ status: "cancelled", endedAt: new Date() }).where(eq(matches.id, match.id));
      return result;
    });

    // Après le commit, jamais avant : notifier plus tôt diffuserait un solde
    // qui pourrait ne jamais être écrit.
    for (const [userId, balance] of balances) notifyWallet(userId, balance);
  }
}
