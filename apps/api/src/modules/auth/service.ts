import { randomBytes } from "node:crypto";
import type { LoginInput, RegisterInput } from "@maxoujeux/shared";
import { eq, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users, walletTx, wallets } from "../../db/schema.js";
import { env } from "../../env.js";
import { AppError } from "../../lib/errors.js";
import { isUniqueViolation } from "../../lib/pg-errors.js";
import { burnTimingBudget, hashPassword, verifyPassword } from "./password.js";
import type { AuthenticatedUser } from "./session.js";

export async function createAccount(
  input: RegisterInput,
  options: { isAdmin?: boolean } = {},
): Promise<AuthenticatedUser> {
  // Pré-contrôle pour pouvoir désigner le champ fautif à l'utilisateur.
  // L'index unique reste la vraie garantie en cas d'inscriptions simultanées.
  const taken = await db
    .select({ email: users.email, pseudo: users.pseudo })
    .from(users)
    .where(
      or(
        sql`lower(${users.email}) = ${input.email.toLowerCase()}`,
        sql`lower(${users.pseudo}) = ${input.pseudo.toLowerCase()}`,
      ),
    );

  const fields: Record<string, string> = {};
  for (const row of taken) {
    if (row.email.toLowerCase() === input.email.toLowerCase()) {
      fields.email = "Un compte existe déjà avec cet email";
    }
    if (row.pseudo.toLowerCase() === input.pseudo.toLowerCase()) {
      fields.pseudo = "Ce pseudo est déjà pris";
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new AppError(409, "ACCOUNT_EXISTS", "Ce compte existe déjà", fields);
  }

  const passwordHash = await hashPassword(input.password);
  const avatarSeed = randomBytes(8).toString("hex");

  try {
    // Compte, porte-monnaie et écriture comptable dans la même transaction :
    // aucun utilisateur ne peut exister sans solde initial cohérent.
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          email: input.email,
          pseudo: input.pseudo,
          passwordHash,
          avatarSeed,
          isAdmin: options.isAdmin ?? false,
        })
        .returning({
          id: users.id,
          email: users.email,
          pseudo: users.pseudo,
          avatarSeed: users.avatarSeed,
          isAdmin: users.isAdmin,
          createdAt: users.createdAt,
        });

      if (!created) throw new Error("Insertion du compte sans retour de ligne");

      await tx.insert(wallets).values({
        userId: created.id,
        balance: env.STARTING_BALANCE,
      });

      await tx.insert(walletTx).values({
        userId: created.id,
        delta: env.STARTING_BALANCE,
        balanceAfter: env.STARTING_BALANCE,
        reason: "signup_bonus",
      });

      return { ...created, balance: env.STARTING_BALANCE };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, "ACCOUNT_EXISTS", "Cet email ou ce pseudo vient d'être pris");
    }
    throw error;
  }
}

/** L'inscription publique ne peut jamais attribuer de privilège administrateur. */
export function register(input: RegisterInput): Promise<AuthenticatedUser> {
  return createAccount(input, { isAdmin: false });
}

export async function login(input: LoginInput): Promise<AuthenticatedUser> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      pseudo: users.pseudo,
      avatarSeed: users.avatarSeed,
      createdAt: users.createdAt,
      passwordHash: users.passwordHash,
      isBanned: users.isBanned,
      isAdmin: users.isAdmin,
      balance: wallets.balance,
    })
    .from(users)
    .innerJoin(wallets, eq(wallets.userId, users.id))
    .where(sql`lower(${users.email}) = ${input.email.toLowerCase()}`)
    .limit(1);

  if (!row) {
    // Même coût de calcul que sur un compte existant : sans ça, le temps de
    // réponse révélerait quels emails sont inscrits.
    await burnTimingBudget();
    throw invalidCredentials();
  }

  const ok = await verifyPassword(row.passwordHash, input.password);
  if (!ok) throw invalidCredentials();

  if (row.isBanned) {
    throw new AppError(403, "ACCOUNT_BANNED", "Ce compte a été suspendu");
  }

  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, row.id));

  return {
    id: row.id,
    email: row.email,
    pseudo: row.pseudo,
    avatarSeed: row.avatarSeed,
    isAdmin: row.isAdmin,
    balance: row.balance ?? 0,
    createdAt: row.createdAt,
  };
}

/** Message volontairement identique pour un email inconnu et un mot de passe faux. */
function invalidCredentials(): AppError {
  return new AppError(401, "INVALID_CREDENTIALS", "Email ou mot de passe incorrect");
}
