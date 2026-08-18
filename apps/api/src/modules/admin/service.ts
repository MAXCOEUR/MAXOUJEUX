import type {
  AdminAccount,
  CreatePlayerInput,
  ResetPlayerPasswordInput,
  SetPlayerBalanceInput,
  SetUserRoleInput,
} from "@maxoujeux/shared";
import { asc, eq, sql } from "drizzle-orm";
import { db, type Database } from "../../db/index.js";
import { staffAuditLog, users, wallets } from "../../db/schema.js";
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
  role: "player" | "moderator" | "admin";
  isBanned: boolean;
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
async function playerTarget(
  exec: SelectExecutor,
  id: string,
  actorUserId?: string,
): Promise<{ id: string; role: "player" | "moderator" }> {
  const [target] = await exec
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!target) {
    throw new AppError(404, "ACCOUNT_NOT_FOUND", "Compte introuvable");
  }
  if (target.role === "admin") {
    throw new AppError(
      409,
      "ADMIN_ACCOUNT_PROTECTED",
      "Un compte administrateur ne peut pas être modifié ici",
    );
  }
  if (actorUserId === id) {
    throw new AppError(403, "TARGET_FORBIDDEN", "Tu ne peux pas agir sur ton propre compte");
  }
  return { id: target.id, role: target.role };
}

async function audit(
  action: string,
  actorUserId: string | undefined,
  targetUserId: string,
  details: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  if (!actorUserId) return;
  await db.insert(staffAuditLog).values({ action, actorUserId, targetUserId, details });
}

export async function listAccounts(): Promise<AdminAccount[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      pseudo: users.pseudo,
      avatarSeed: users.avatarSeed,
      role: users.role,
      isBanned: users.isBanned,
      isAdmin: users.isAdmin,
      balance: wallets.balance,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .innerJoin(wallets, eq(wallets.userId, users.id))
    .orderBy(
      sql`case ${users.role} when 'admin' then 0 when 'moderator' then 1 else 2 end`,
      asc(sql`lower(${users.pseudo})`),
    );

  return rows.map(toAdminAccount);
}

export async function createPlayer(
  input: CreatePlayerInput,
  actorUserId?: string,
): Promise<AdminAccount> {
  const created = await createAccount(input, { role: "player" });
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      pseudo: users.pseudo,
      avatarSeed: users.avatarSeed,
      role: users.role,
      isBanned: users.isBanned,
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
  await audit("account.create", actorUserId, created.id);
  return toAdminAccount(row);
}

export async function setAccountRole(
  id: string,
  input: SetUserRoleInput,
  actorUserId: string,
): Promise<void> {
  await playerTarget(db, id, actorUserId);
  await db
    .update(users)
    .set({ role: input.role, isAdmin: false })
    .where(eq(users.id, id));
  await audit("account.role", actorUserId, id, { role: input.role });
}

export async function resetPlayerPassword(
  id: string,
  input: ResetPlayerPasswordInput,
  actorUserId?: string,
): Promise<void> {
  // Le calcul Argon2 est volontairement hors transaction pour la garder courte.
  const passwordHash = await hashPassword(input.password);

  await db.transaction(async (tx) => {
    await playerTarget(tx, id, actorUserId);
    await tx.update(users).set({ passwordHash }).where(eq(users.id, id));
    await revokeAllSessionsIn(tx, id);
  });

  // La transaction est validée : aucun client ne conserve l'ancienne session.
  disconnectUser(id);
  await audit("account.password_reset", actorUserId, id);
}

export async function setPlayerBalance(
  id: string,
  input: SetPlayerBalanceInput,
  actorUserId?: string,
): Promise<number> {
  await playerTarget(db, id, actorUserId);
  const balance = await setBalance(id, input.balance);
  await audit("account.balance", actorUserId, id, { balance });
  return balance;
}

export async function deletePlayer(id: string, actorUserId?: string): Promise<void> {
  // Réservation synchrone avant le premier await : une partie ne peut plus
  // démarrer pendant que la suppression attend la base.
  if (!blockActivity(id)) {
    throw new AppError(409, "PLAYER_ACTIVE", "Ce joueur participe à une partie");
  }

  try {
    await db.transaction(async (tx) => {
      await playerTarget(tx, id, actorUserId);
      await tx.delete(users).where(eq(users.id, id));
    });
  } finally {
    unblockActivity(id);
  }

  // La cascade et la suppression du compte sont validées avant la coupure.
  disconnectUser(id);
  await audit("account.delete", actorUserId, id);
}
