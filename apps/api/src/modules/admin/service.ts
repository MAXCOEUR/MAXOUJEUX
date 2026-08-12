import type {
  AdminAccount,
  CreatePlayerInput,
  ResetPlayerPasswordInput,
  SetPlayerBalanceInput,
} from "@maxoujeux/shared";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, type Database } from "../../db/index.js";
import { users, wallets } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { disconnectUser } from "../../realtime/notify.js";
import { hashPassword } from "../auth/password.js";
import { createAccount } from "../auth/service.js";
import { revokeAllSessionsIn } from "../auth/session.js";
import { blockActivity, unblockActivity } from "../games/activity.js";
import { setBalance } from "../wallet/service.js";

type SelectExecutor = Pick<Database, "select">;

function toAdminAccount(row: {
  id: string;
  email: string;
  pseudo: string;
  avatarSeed: string;
  isAdmin: boolean;
  balance: number;
  createdAt: Date;
  lastSeenAt: Date;
}): AdminAccount {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/** Relit la cible au plus près de l'écriture et protège les administrateurs. */
async function playerTarget(exec: SelectExecutor, id: string): Promise<{ id: string }> {
  const [target] = await exec
    .select({ id: users.id, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!target) {
    throw new AppError(404, "ACCOUNT_NOT_FOUND", "Compte introuvable");
  }
  if (target.isAdmin) {
    throw new AppError(
      409,
      "ADMIN_ACCOUNT_PROTECTED",
      "Un compte administrateur ne peut pas être modifié ici",
    );
  }
  return { id: target.id };
}

export async function listAccounts(): Promise<AdminAccount[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      pseudo: users.pseudo,
      avatarSeed: users.avatarSeed,
      isAdmin: users.isAdmin,
      balance: wallets.balance,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .innerJoin(wallets, eq(wallets.userId, users.id))
    .orderBy(desc(users.isAdmin), asc(sql`lower(${users.pseudo})`));

  return rows.map(toAdminAccount);
}

export async function createPlayer(input: CreatePlayerInput): Promise<AdminAccount> {
  const created = await createAccount(input, { isAdmin: false });
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      pseudo: users.pseudo,
      avatarSeed: users.avatarSeed,
      isAdmin: users.isAdmin,
      balance: wallets.balance,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .innerJoin(wallets, eq(wallets.userId, users.id))
    .where(eq(users.id, created.id))
    .limit(1);

  if (!row) throw new Error(`Compte créé puis introuvable : ${created.id}`);
  return toAdminAccount(row);
}

export async function resetPlayerPassword(
  id: string,
  input: ResetPlayerPasswordInput,
): Promise<void> {
  // Le calcul Argon2 est volontairement hors transaction pour la garder courte.
  const passwordHash = await hashPassword(input.password);

  await db.transaction(async (tx) => {
    await playerTarget(tx, id);
    await tx.update(users).set({ passwordHash }).where(eq(users.id, id));
    await revokeAllSessionsIn(tx, id);
  });

  // La transaction est validée : aucun client ne conserve l'ancienne session.
  disconnectUser(id);
}

export async function setPlayerBalance(
  id: string,
  input: SetPlayerBalanceInput,
): Promise<number> {
  await playerTarget(db, id);
  return setBalance(id, input.balance);
}

export async function deletePlayer(id: string): Promise<void> {
  // Réservation synchrone avant le premier await : une partie ne peut plus
  // démarrer pendant que la suppression attend la base.
  if (!blockActivity(id)) {
    throw new AppError(409, "PLAYER_ACTIVE", "Ce joueur participe à une partie");
  }

  try {
    await db.transaction(async (tx) => {
      await playerTarget(tx, id);
      await tx.delete(users).where(eq(users.id, id));
    });
  } finally {
    unblockActivity(id);
  }

  // La cascade et la suppression du compte sont validées avant la coupure.
  disconnectUser(id);
}
