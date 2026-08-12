import { randomBytes } from "node:crypto";
import { dailyBonusAmount, parisDay } from "@maxoujeux/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { dailyClaims, users, walletTx, wallets } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import {
  balanceOf as fixtureBalanceOf,
  ledgerSum as fixtureLedgerSum,
  trackCreated,
} from "../../test/fixtures.js";
import { claimDailyBonus, credit, debit, getSummary, history, setBalance } from "./service.js";

/**
 * Tests d'intégration du porte-monnaie.
 *
 * Ils tournent sur le pilote configuré par `DATABASE_URL` — PGlite par défaut,
 * PostgreSQL si la variable est présente. Le scénario de concurrence doit être
 * rejoué contre un vrai PostgreSQL avant toute mise en production :
 *
 *   docker compose -f docker-compose.dev.yml up -d
 *   DATABASE_URL=postgres://maxoujeux:maxoujeux@localhost:5433/maxoujeux pnpm --filter @maxoujeux/api test
 */

/** Crée un compte de test avec un solde initial, sans passer par l'inscription. */
async function makeUser(balance: number): Promise<string> {
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

async function balanceOf(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  return row?.balance ?? -1;
}

/** Somme des mouvements du journal — doit toujours égaler le solde. */
async function ledgerSum(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${walletTx.delta}), 0)::int` })
    .from(walletTx)
    .where(eq(walletTx.userId, userId));
  return row?.total ?? 0;
}

const createdUsers: string[] = [];
const created = trackCreated();

async function newUser(balance: number): Promise<string> {
  const id = await makeUser(balance);
  createdUsers.push(id);
  return id;
}

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterAll(async () => {
  // La cascade sur `users` nettoie porte-monnaie, journal et encaissements.
  for (const id of createdUsers) {
    await db.delete(users).where(eq(users.id, id));
  }
  await created.cleanup();
});

describe("ajustement administratif", () => {
  it("fixe un solde supérieur avec un mouvement auditable", async () => {
    const userId = await created.user(500);
    await db.insert(walletTx).values({
      userId,
      delta: 500,
      balanceAfter: 500,
      reason: "signup_bonus",
    });

    expect(await setBalance(userId, 900)).toBe(900);
    expect(await fixtureBalanceOf(userId)).toBe(900);
    expect(await fixtureLedgerSum(userId)).toBe(900);
  });

  it("fixe un solde inférieur sans permettre un solde négatif", async () => {
    const userId = await created.user(500);
    await db.insert(walletTx).values({
      userId,
      delta: 500,
      balanceAfter: 500,
      reason: "signup_bonus",
    });

    expect(await setBalance(userId, 125)).toBe(125);
    expect(await fixtureBalanceOf(userId)).toBe(125);
    expect(await fixtureLedgerSum(userId)).toBe(125);
    await expect(setBalance(userId, -1)).rejects.toThrow("Solde cible invalide");
    expect(await fixtureBalanceOf(userId)).toBe(125);
  });

  it("n'écrit aucun mouvement quand le solde cible est identique", async () => {
    const userId = await created.user(500);
    await db.insert(walletTx).values({
      userId,
      delta: 500,
      balanceAfter: 500,
      reason: "signup_bonus",
    });
    const countEntries = async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(walletTx)
        .where(eq(walletTx.userId, userId));
      return row?.count ?? 0;
    };
    const before = await countEntries();

    expect(await setBalance(userId, 500)).toBe(500);
    expect(await countEntries()).toBe(before);
  });

  it("sérialise deux ajustements concurrents en gardant le journal auditable", async () => {
    // PGlite sérialise les requêtes sur sa connexion unique. Ce scénario doit
    // donc être rejoué sur PostgreSQL pour prouver que FOR UPDATE protège deux
    // transactions réellement concurrentes.
    const userId = await created.user(500);
    await db.insert(walletTx).values({
      userId,
      delta: 500,
      balanceAfter: 500,
      reason: "signup_bonus",
    });

    await expect(Promise.all([setBalance(userId, 900), setBalance(userId, 125)])).resolves.toEqual([
      900,
      125,
    ]);

    expect(await fixtureLedgerSum(userId)).toBe(await fixtureBalanceOf(userId));
    const entries = await db
      .select({ delta: walletTx.delta })
      .from(walletTx)
      .where(and(eq(walletTx.userId, userId), eq(walletTx.reason, "admin_adjustment")));
    expect(entries.filter((entry) => entry.delta !== 0)).toHaveLength(2);
  });
});

describe("crédit et débit", () => {
  it("crédite et inscrit l'écriture au journal", async () => {
    const userId = await newUser(1000);

    const balance = await credit(userId, 250, "motus_reward");

    expect(balance).toBe(1250);
    expect(await balanceOf(userId)).toBe(1250);

    const entries = await history(userId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.delta).toBe(250);
    expect(entries[0]?.balanceAfter).toBe(1250);
    expect(entries[0]?.reason).toBe("motus_reward");
  });

  it("débite quand le solde le permet", async () => {
    const userId = await newUser(1000);

    expect(await debit(userId, 500, "poker_buyin")).toBe(500);

    const entries = await history(userId);
    expect(entries[0]?.delta).toBe(-500);
    expect(entries[0]?.balanceAfter).toBe(500);
  });

  it("autorise un débit qui ramène le solde exactement à zéro", async () => {
    const userId = await newUser(500);
    expect(await debit(userId, 500, "blackjack_bet")).toBe(0);
  });

  it("refuse un débit supérieur au solde et n'écrit rien", async () => {
    const userId = await newUser(400);

    await expect(debit(userId, 500, "poker_buyin")).rejects.toThrow(AppError);

    // Ni le solde ni le journal ne doivent avoir bougé.
    expect(await balanceOf(userId)).toBe(400);
    expect(await history(userId)).toHaveLength(0);
  });

  it("renvoie le code INSUFFICIENT_FUNDS", async () => {
    const userId = await newUser(10);
    await expect(debit(userId, 5000, "poker_buyin")).rejects.toMatchObject({
      statusCode: 409,
      code: "INSUFFICIENT_FUNDS",
    });
  });

  it("rejette un montant non entier ou négatif", async () => {
    const userId = await newUser(1000);
    await expect(credit(userId, 12.5, "motus_reward")).rejects.toThrow(/Montant invalide/);
    await expect(debit(userId, -100, "poker_buyin")).rejects.toThrow(/Montant invalide/);
    await expect(debit(userId, 0, "poker_buyin")).rejects.toThrow(/Montant invalide/);
  });
});

describe("concurrence des débits", () => {
  it("ne laisse pas dépenser deux fois le même MaxouCoin", async () => {
    // Le scénario réel : un joueur assis à deux tables, ou avec deux onglets,
    // déclenche plusieurs mises en parallèle. Sans condition de solde dans
    // l'UPDATE, plusieurs débits liraient le même solde et passeraient tous.
    const userId = await newUser(1000);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => debit(userId, 100, "blackjack_bet")),
    );

    const accepted = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");

    expect(accepted).toHaveLength(10);
    expect(refused).toHaveLength(10);
    expect(await balanceOf(userId)).toBe(0);

    // Le journal ne doit contenir que les dix débits réellement appliqués.
    expect(await history(userId, 100)).toHaveLength(10);
    expect(await ledgerSum(userId)).toBe(-1000);
  }, 30_000);

  it("garde le journal cohérent avec le solde sous charge mêlée", async () => {
    const userId = await newUser(1000);

    await Promise.allSettled([
      ...Array.from({ length: 10 }, () => debit(userId, 150, "poker_buyin")),
      ...Array.from({ length: 10 }, () => credit(userId, 200, "poker_cashout")),
    ]);

    // Quel que soit l'entrelacement, la somme du journal doit reconstituer
    // exactement le solde. Un écart signalerait une écriture hors service.
    const balance = await balanceOf(userId);
    expect(await ledgerSum(userId)).toBe(balance - 1000);
    expect(balance).toBeGreaterThanOrEqual(0);
  }, 30_000);
});

describe("bonus quotidien", () => {
  it("verse 1 000 MC au premier encaissement et démarre la série", async () => {
    const userId = await newUser(0);

    const result = await claimDailyBonus(userId);

    expect(result.amount).toBe(1000);
    expect(result.streak).toBe(1);
    expect(result.balance).toBe(1000);
  });

  it("refuse un second encaissement le même jour", async () => {
    const userId = await newUser(0);
    await claimDailyBonus(userId);

    await expect(claimDailyBonus(userId)).rejects.toMatchObject({
      statusCode: 409,
      code: "ALREADY_CLAIMED",
    });
    expect(await balanceOf(userId)).toBe(1000);
  });

  it("ne verse qu'une fois sur cinq appels simultanés", async () => {
    // C'est l'idempotence par clé primaire qui est testée ici : sans elle, cinq
    // requêtes lancées ensemble créditeraient cinq fois.
    const userId = await newUser(0);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => claimDailyBonus(userId)),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(1000);

    const entries = await history(userId, 100);
    expect(entries.filter((e) => e.reason === "daily_bonus")).toHaveLength(1);
  }, 30_000);

  it("poursuit la série si la veille a été encaissée", async () => {
    const userId = await newUser(0);
    const today = parisDay(new Date());
    const yesterday = parisDay(new Date(Date.now() - 86_400_000));

    // On simule l'encaissement de la veille sans manipuler l'horloge système.
    await db.insert(dailyClaims).values({
      userId,
      day: yesterday,
      amount: dailyBonusAmount(3),
      streak: 3,
    });

    const result = await claimDailyBonus(userId);

    expect(result.streak).toBe(4);
    expect(result.amount).toBe(1300);

    const [claim] = await db
      .select({ day: dailyClaims.day })
      .from(dailyClaims)
      .where(eq(dailyClaims.userId, userId))
      .orderBy(sql`${dailyClaims.day} desc`)
      .limit(1);
    expect(claim?.day).toBe(today);
  });

  it("repart à 1 quand un jour a été manqué", async () => {
    const userId = await newUser(0);
    const threeDaysAgo = parisDay(new Date(Date.now() - 3 * 86_400_000));

    await db.insert(dailyClaims).values({
      userId,
      day: threeDaysAgo,
      amount: dailyBonusAmount(9),
      streak: 9,
    });

    const result = await claimDailyBonus(userId);

    expect(result.streak).toBe(1);
    expect(result.amount).toBe(1000);
  });

  it("plafonne le versement à 2 000 MC sur une longue série", async () => {
    const userId = await newUser(0);
    const yesterday = parisDay(new Date(Date.now() - 86_400_000));

    await db.insert(dailyClaims).values({ userId, day: yesterday, amount: 2000, streak: 40 });

    const result = await claimDailyBonus(userId);
    expect(result.streak).toBe(41);
    expect(result.amount).toBe(2000);
  });
});

describe("résumé du porte-monnaie", () => {
  it("annonce un bonus encaissable et une série à zéro sur un compte neuf", async () => {
    const userId = await newUser(5000);

    const summary = await getSummary(userId);

    expect(summary.balance).toBe(5000);
    expect(summary.canClaim).toBe(true);
    expect(summary.streak).toBe(0);
    expect(summary.claimableAmount).toBe(1000);
    expect(summary.nextDayAmount).toBe(1100);
  });

  it("bascule sur le compte à rebours après encaissement", async () => {
    const userId = await newUser(0);
    await claimDailyBonus(userId);

    const summary = await getSummary(userId);

    expect(summary.canClaim).toBe(false);
    expect(summary.streak).toBe(1);
    expect(summary.nextDayAmount).toBe(1100);
    expect(new Date(summary.nextClaimAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("affiche une série à zéro lorsqu'elle a été interrompue", async () => {
    // Annoncer « série 9 » alors que l'encaissement repartirait à 1 serait
    // mensonger : le résumé doit refléter la série réellement en cours.
    const userId = await newUser(0);
    await db.insert(dailyClaims).values({
      userId,
      day: parisDay(new Date(Date.now() - 5 * 86_400_000)),
      amount: 1800,
      streak: 9,
    });

    const summary = await getSummary(userId);

    expect(summary.streak).toBe(0);
    expect(summary.claimableAmount).toBe(1000);
  });

  it("annonce la série en cours quand la veille a été encaissée", async () => {
    const userId = await newUser(0);
    await db.insert(dailyClaims).values({
      userId,
      day: parisDay(new Date(Date.now() - 86_400_000)),
      amount: 1200,
      streak: 3,
    });

    const summary = await getSummary(userId);

    expect(summary.streak).toBe(3);
    expect(summary.claimableAmount).toBe(1300);
  });
});
