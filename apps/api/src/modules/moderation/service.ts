import type {
  AccountAccess,
  BanAccountInput,
  BanDuration,
  BanKind,
  ModerationBan,
  UserRole,
} from "@maxoujeux/shared";
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  accountAccesses,
  moderationBans,
  sessions,
  staffAuditLog,
  users,
} from "../../db/schema.js";
import { normalizeIp } from "../../lib/access-context.js";
import { AppError } from "../../lib/errors.js";
import { disconnectAccess, disconnectUser } from "../../realtime/notify.js";

const DURATION_MS: Record<Exclude<BanDuration, "permanent">, number> = {
  "1h": 3_600_000,
  "1d": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

function expiry(duration: BanDuration, now = new Date()): Date | null {
  return duration === "permanent" ? null : new Date(now.getTime() + DURATION_MS[duration]);
}

function activeBan(kind: BanKind, target: string, now = new Date()) {
  return and(
    eq(moderationBans.kind, kind),
    eq(moderationBans.targetValue, target),
    isNull(moderationBans.revokedAt),
    or(isNull(moderationBans.expiresAt), gt(moderationBans.expiresAt, now)),
  );
}

export interface AccessIdentity {
  userId: string | null;
  role: UserRole | null;
  ip: string | null;
  deviceHash: string | null;
}

/** Contrôle central utilisé par HTTP, les sessions et Socket.IO. */
export async function assertAccessAllowed(identity: AccessIdentity): Promise<void> {
  if (identity.role === "admin") return;

  const candidates: Array<{ kind: BanKind; target: string | null; code: string; message: string }> = [
    {
      kind: "account",
      target: identity.userId,
      code: "ACCOUNT_BANNED",
      message: "Ce compte a été suspendu",
    },
    {
      kind: "ip",
      target: identity.ip ? normalizeIp(identity.ip) : null,
      code: "IP_BANNED",
      message: "Cette adresse IP a été suspendue",
    },
    {
      kind: "device",
      target: identity.deviceHash,
      code: "DEVICE_BANNED",
      message: "Cet appareil a été suspendu",
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.target) continue;
    const [ban] = await db
      .select({ id: moderationBans.id })
      .from(moderationBans)
      .where(activeBan(candidate.kind, candidate.target))
      .limit(1);
    if (ban) throw new AppError(403, candidate.code, candidate.message);
  }
}

/** Maintient le booléen historique sans prolonger un ban temporaire expiré. */
export async function assertLegacyAccountAllowed(
  userId: string,
  isBanned: boolean,
  role: UserRole = "player",
): Promise<void> {
  if (!isBanned || role === "admin") return;
  const [history] = await db
    .select({ id: moderationBans.id })
    .from(moderationBans)
    .where(and(eq(moderationBans.kind, "account"), eq(moderationBans.targetValue, userId)))
    .limit(1);
  if (history) {
    await db.update(users).set({ isBanned: false }).where(eq(users.id, userId));
    return;
  }
  throw new AppError(403, "ACCOUNT_BANNED", "Ce compte a été suspendu");
}

export async function listAccountAccesses(userId: string): Promise<AccountAccess[]> {
  const rows = await db
    .select({
      id: accountAccesses.id,
      ip: accountAccesses.ip,
      deviceHash: accountAccesses.deviceHash,
      userAgent: accountAccesses.userAgent,
      firstSeenAt: accountAccesses.firstSeenAt,
      lastSeenAt: accountAccesses.lastSeenAt,
    })
    .from(accountAccesses)
    .where(eq(accountAccesses.userId, userId))
    .orderBy(desc(accountAccesses.lastSeenAt))
    .limit(50);

  return rows.map(({ deviceHash, firstSeenAt, lastSeenAt, ...row }) => ({
    ...row,
    hasDevice: deviceHash !== null,
    firstSeenAt: firstSeenAt.toISOString(),
    lastSeenAt: lastSeenAt.toISOString(),
  }));
}

function publicBan(row: typeof moderationBans.$inferSelect): ModerationBan {
  const label =
    row.kind === "device" ? `Appareil …${row.targetValue.slice(-8)}` : row.targetValue;
  return {
    id: row.id,
    kind: row.kind,
    accountId: row.targetUserId,
    targetLabel: label,
    reason: row.reason,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedBy: row.revokedBy,
  };
}

export async function listAccountBans(userId: string): Promise<ModerationBan[]> {
  const rows = await db
    .select()
    .from(moderationBans)
    .where(eq(moderationBans.targetUserId, userId))
    .orderBy(desc(moderationBans.createdAt));
  return rows.map(publicBan);
}

export async function banAccount(
  actorUserId: string,
  targetUserId: string,
  input: BanAccountInput,
): Promise<ModerationBan[]> {
  let disconnectTargets: Array<{ kind: BanKind; value: string }> = [];
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select ${users.id} from ${users} where ${users.id} = ${targetUserId} for update`);
    const [target] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!target) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Compte introuvable");
    if (target.role === "admin") {
      throw new AppError(
        409,
        "ADMIN_ACCOUNT_PROTECTED",
        "L’administrateur ne peut pas être banni",
      );
    }
    if (actorUserId === targetUserId) {
      throw new AppError(403, "TARGET_FORBIDDEN", "Tu ne peux pas te sanctionner toi-même");
    }

    const [access] = input.accessId
      ? await tx
          .select()
          .from(accountAccesses)
          .where(and(eq(accountAccesses.id, input.accessId), eq(accountAccesses.userId, targetUserId)))
          .limit(1)
      : [];
    if (input.kinds.some((kind) => kind !== "account") && !access) {
      throw new AppError(404, "ACCESS_NOT_FOUND", "Connexion récente introuvable");
    }

    const targets: Array<{ kind: BanKind; value: string }> = input.kinds.map((kind) => {
      if (kind === "account") return { kind, value: targetUserId };
      if (kind === "ip") return { kind, value: access!.ip };
      if (!access!.deviceHash) {
        throw new AppError(
          409,
          "DEVICE_FINGERPRINT_REQUIRED",
          "Cette connexion ne possède pas d’empreinte appareil",
        );
      }
      return { kind, value: access!.deviceHash };
    });
    disconnectTargets = targets;

    // Le verrou est pris par cible et dans un ordre stable : deux modérateurs
    // bannissant la même IP/machine ne peuvent ni créer de doublon actif ni se
    // bloquer mutuellement avec deux cibles présentées dans un ordre différent.
    const orderedTargets = [...targets].sort((left, right) =>
      `${left.kind}:${left.value}`.localeCompare(`${right.kind}:${right.value}`),
    );
    for (const targetValue of orderedTargets) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${targetValue.kind}:${targetValue.value}`}, 0))`,
      );
      const [already] = await tx
        .select({ id: moderationBans.id })
        .from(moderationBans)
        .where(activeBan(targetValue.kind, targetValue.value))
        .limit(1);
      if (already) {
        throw new AppError(409, "BAN_ALREADY_ACTIVE", "Ce bannissement est déjà actif");
      }
    }

    const rows = await tx
      .insert(moderationBans)
      .values(
        targets.map(({ kind, value }) => ({
          kind,
          targetUserId,
          targetValue: value,
          reason: input.reason,
          expiresAt: expiry(input.duration),
          createdBy: actorUserId,
        })),
      )
      .returning();

    const socketConditions = targets.map(({ kind, value }) => {
      if (kind === "account") return eq(sessions.userId, value);
      if (kind === "ip") return eq(sessions.ip, value);
      return eq(sessions.deviceHash, value);
    });
    if (socketConditions.length > 0) {
      const nonAdminSessions = tx
        .select({ id: sessions.id })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(or(...socketConditions), ne(users.role, "admin")));
      await tx.delete(sessions).where(inArray(sessions.id, nonAdminSessions));
    }
    if (input.kinds.includes("account")) {
      await tx.update(users).set({ isBanned: true }).where(eq(users.id, targetUserId));
    }
    await tx.insert(staffAuditLog).values({
      action: "account.ban",
      actorUserId,
      targetUserId,
      details: { kinds: input.kinds.join(","), duration: input.duration },
    });
    return rows;
  });

  for (const target of disconnectTargets) {
    if (target.kind === "account") disconnectUser(target.value);
    else disconnectAccess(target.kind, target.value);
  }
  return created.map(publicBan);
}

export async function revokeBan(actorUserId: string, banId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [ban] = await tx
      .select()
      .from(moderationBans)
      .where(eq(moderationBans.id, banId))
      .limit(1);
    if (!ban) throw new AppError(404, "BAN_NOT_FOUND", "Bannissement introuvable");
    if (ban.revokedAt) return;

    await tx
      .update(moderationBans)
      .set({ revokedAt: new Date(), revokedBy: actorUserId })
      .where(eq(moderationBans.id, banId));

    if (ban.kind === "account" && ban.targetUserId) {
      const [other] = await tx
        .select({ id: moderationBans.id })
        .from(moderationBans)
        .where(activeBan("account", ban.targetValue))
        .limit(1);
      await tx
        .update(users)
        .set({ isBanned: Boolean(other) })
        .where(eq(users.id, ban.targetUserId));
    }
    await tx.insert(staffAuditLog).values({
      action: "ban.revoke",
      actorUserId,
      targetUserId: ban.targetUserId,
      details: { banId, kind: ban.kind },
    });
  });
}

/** Utilitaire de maintenance : les flags historiques suivent les bans de compte actifs. */
export async function refreshAccountBanFlags(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  for (const userId of userIds) {
    const [active] = await db
      .select({ id: moderationBans.id })
      .from(moderationBans)
      .where(activeBan("account", userId))
      .limit(1);
    await db.update(users).set({ isBanned: Boolean(active) }).where(inArray(users.id, [userId]));
  }
}
