import type { RegisterInput } from "@maxoujeux/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { moderationBans, users } from "../../db/schema.js";
import { env, type AdminBootstrapConfig } from "../../env.js";
import { AppError } from "../../lib/errors.js";
import { createAccount } from "./service.js";

async function accountByEmail(email: string): Promise<{ id: string } | undefined> {
  const [account] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return account;
}

async function promote(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ role: "player", isAdmin: false })
      .where(eq(users.role, "admin"));
    await tx
      .update(users)
      .set({ role: "admin", isAdmin: true, isBanned: false })
      .where(eq(users.id, userId));
    await tx
      .update(moderationBans)
      .set({ revokedAt: new Date(), revokedBy: userId })
      .where(
        and(
          eq(moderationBans.kind, "account"),
          eq(moderationBans.targetValue, userId),
          isNull(moderationBans.revokedAt),
        ),
      );
  });
}

/**
 * Crée ou promeut le compte administrateur configuré au démarrage.
 *
 * La relecture après une collision d'unicité tolère deux démarrages simultanés,
 * sans masquer une collision de pseudo appartenant à un autre compte.
 */
export async function bootstrapAdmin(config: AdminBootstrapConfig = env): Promise<void> {
  const { ADMIN_EMAIL: email, ADMIN_PSEUDO: pseudo, ADMIN_PASSWORD: password } = config;
  if (!email && !pseudo && !password) return;
  if (!email || !pseudo || !password) {
    throw new Error("Configuration administrateur incomplète");
  }

  const existing = await accountByEmail(email);
  if (existing) {
    await promote(existing.id);
    return;
  }

  const input: RegisterInput = { email, pseudo, password };
  try {
    // Crée d'abord sans privilège : l'index unique autorise ainsi le remplacement
    // atomique d'un ancien administrateur par le compte configuré.
    const created = await createAccount(input, { role: "player" });
    await promote(created.id);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "ACCOUNT_EXISTS") throw error;

    const concurrentAccount = await accountByEmail(email);
    if (!concurrentAccount) throw error;
    await promote(concurrentAccount.id);
  }
}
