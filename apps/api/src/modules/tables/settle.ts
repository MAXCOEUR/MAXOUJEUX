/**
 * Règlement d'une partie : versements, résultat et statistiques.
 *
 * Tout se passe dans **une seule transaction**. Un gain versé sans que
 * `match_players` soit renseigné laisserait un joueur payé pour une partie dont
 * le résultat n'existe pas ; l'inverse laisserait un vainqueur non payé. Les
 * deux sont des incohérences qu'aucun écran ne rattraperait.
 *
 * Ce module n'écrit jamais dans `wallets` lui-même : il passe par
 * `creditInTx` / `debitInTx` du service de porte-monnaie, qui reste le seul
 * endroit autorisé à toucher la table. Ici on n'orchestre que l'ordre des
 * écritures et les règles du jeu — qui gagne, combien.
 */

import { winPayout, type DuelGame, type EndReason, type Seat } from "@maxoujeux/shared";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { matchPlayers, matches, stats } from "../../db/schema.js";
import { notifyWallet } from "../../realtime/notify.js";
import { creditInTx } from "../wallet/service.js";

/** Résultat inscrit dans `match_players`. */
export type PlayerResult = "win" | "loss" | "draw" | "abandon";

export interface SettlePlayer {
  userId: string;
  seat: Seat;
  result: PlayerResult;
}

export interface SettleInput {
  tableId: string;
  game: DuelGame;
  stake: number;
  reason: EndReason;
  players: SettlePlayer[];
}

export interface SettleResult {
  /** Nouveau solde par joueur, à diffuser après le commit. */
  balances: Map<string, number>;
  /** Gain net par siège, tel qu'il est affiché au joueur. */
  deltas: { seat: Seat; delta: number }[];
}

/**
 * Un abandon compte comme une défaite dans les statistiques, tout en restant
 * distingué dans `match_players` : le journal doit rester lisible pour savoir
 * si un joueur perd ses parties ou s'il les quitte.
 */
function statsColumn(result: PlayerResult): "won" | "lost" | "drawn" {
  if (result === "win") return "won";
  if (result === "draw") return "drawn";
  return "lost";
}

/**
 * Versement dû à un joueur, mise comprise.
 *
 * - Victoire : `winMultiplier` × sa mise. Sur 10 MC de chaque côté, le
 *   vainqueur touche 15 MC et les 5 MC restants quittent l'économie. C'est
 *   voulu : sans ce prélèvement, la masse de MaxouCoin ne ferait que croître.
 * - Égalité : les deux mises sont rendues.
 * - Défaite ou abandon : rien.
 */
function payoutFor(game: DuelGame, stake: number, result: PlayerResult): number {
  if (result === "win") return winPayout(game, stake);
  if (result === "draw") return stake;
  return 0;
}

export async function settleMatch(input: SettleInput): Promise<SettleResult> {
  const { tableId, game, stake, players } = input;
  const endedAt = new Date();

  const settled = await db.transaction(async (tx) => {
    const balances = new Map<string, number>();
    const deltas: { seat: Seat; delta: number }[] = [];

    await tx
      .update(matches)
      .set({ status: "finished", endedAt })
      .where(eq(matches.id, tableId));

    for (const player of players) {
      const payout = payoutFor(game, stake, player.result);
      // Le delta est net de la mise, déjà débitée à l'entrée sur la table :
      // c'est ce chiffre-là que le joueur reconnaît sur son solde.
      const delta = payout - stake;

      if (payout > 0) {
        const balance = await creditInTx(
          tx,
          player.userId,
          payout,
          player.result === "draw" ? "match_refund" : "match_payout",
          tableId,
        );
        balances.set(player.userId, balance);
      }

      await tx
        .update(matchPlayers)
        .set({ result: player.result, chipsDelta: delta })
        .where(and(eq(matchPlayers.matchId, tableId), eq(matchPlayers.userId, player.userId)));

      // Upsert : la ligne de statistiques n'existe pas avant la première partie
      // du joueur sur ce jeu. Les incréments sont faits en SQL et non lus puis
      // réécrits — deux parties qui se terminent en même temps ne doivent pas
      // s'écraser l'une l'autre.
      const column = statsColumn(player.result);
      await tx
        .insert(stats)
        .values({
          userId: player.userId,
          game,
          played: 1,
          won: column === "won" ? 1 : 0,
          lost: column === "lost" ? 1 : 0,
          drawn: column === "drawn" ? 1 : 0,
        })
        .onConflictDoUpdate({
          target: [stats.userId, stats.game],
          set: {
            played: sql`${stats.played} + 1`,
            won: sql`${stats.won} + ${column === "won" ? 1 : 0}`,
            lost: sql`${stats.lost} + ${column === "lost" ? 1 : 0}`,
            drawn: sql`${stats.drawn} + ${column === "drawn" ? 1 : 0}`,
            updatedAt: endedAt,
          },
        });

      deltas.push({ seat: player.seat, delta });
    }

    return { balances, deltas };
  });

  // Diffusion après validation de la transaction, jamais avant.
  for (const [userId, balance] of settled.balances) notifyWallet(userId, balance);

  return settled;
}

/**
 * Annule une table qui n'a jamais démarré et rend les mises engagées.
 *
 * Utilisé quand l'hôte quitte avant l'arrivée d'un adversaire, ou quand la
 * table expire. La ligne `matches` est conservée en `cancelled` plutôt que
 * supprimée : `wallet_tx.match_id` n'a pas de clé étrangère, une suppression
 * laisserait le journal pointer vers un identifiant disparu.
 */
export async function cancelMatch(
  tableId: string,
  stake: number,
  userIds: string[],
): Promise<Map<string, number>> {
  const endedAt = new Date();

  const balances = await db.transaction(async (tx) => {
    const result = new Map<string, number>();

    await tx
      .update(matches)
      .set({ status: "cancelled", endedAt })
      .where(eq(matches.id, tableId));

    for (const userId of userIds) {
      const balance = await creditInTx(tx, userId, stake, "match_refund", tableId);
      result.set(userId, balance);
    }

    return result;
  });

  for (const [userId, balance] of balances) notifyWallet(userId, balance);
  return balances;
}
