import { createHash, randomBytes } from "node:crypto";
import type { UserRole } from "@maxoujeux/shared";
import { and, eq, gt, lt, type SQL } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import { db, type Database } from "../../db/index.js";
import { accountAccesses, sessions, users, wallets } from "../../db/schema.js";
import { env, isProduction } from "../../env.js";
import { hashDeviceFingerprint, normalizeIp } from "../../lib/access-context.js";
import {
  assertAccessAllowed,
  assertLegacyAccountAllowed,
} from "../moderation/service.js";

export const SESSION_COOKIE = "mxj_session";

const TOKEN_BYTES = 32;

/** Le jeton en clair ne quitte jamais la réponse HTTP ; la base n'en voit que le SHA-256. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AuthenticatedUser {
  sessionId: string;
  id: string;
  email: string;
  pseudo: string;
  avatarSeed: string;
  role: UserRole;
  isAdmin: boolean;
  ip: string | null;
  deviceHash: string | null;
  balance: number;
  createdAt: Date;
}

export interface RequestOrigin {
  ip?: string | undefined;
  userAgent?: string | undefined;
  deviceFingerprint?: string | undefined;
}

/** Crée une session en base et renvoie le jeton en clair à poser en cookie. */
export async function createSession(userId: string, origin: RequestOrigin): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 86_400_000);
  const ip = origin.ip ? normalizeIp(origin.ip) : null;
  const deviceHash = hashDeviceFingerprint(origin.deviceFingerprint);

  await db.transaction(async (tx) => {
    await tx.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip,
      deviceHash,
      userAgent: origin.userAgent?.slice(0, 255) ?? null,
    });

    if (ip) {
      await tx.insert(accountAccesses).values({
        userId,
        ip,
        deviceHash,
        userAgent: origin.userAgent?.slice(0, 255) ?? null,
      });
    }
  });

  return token;
}

/**
 * Résout un jeton en utilisateur, ou `null` s'il est invalide, expiré,
 * ou si le compte est banni ou fermé.
 *
 * Cette fonction est appelée à chaque requête authentifiée *et* au handshake
 * Socket.IO : c'est le point d'entrée unique de l'identité. Ne jamais y
 * sélectionner l'image d'avatar : à ce rythme, la colonne binaire se paierait
 * en mégaoctets par minute.
 */
async function resolveSessionWhere(predicate: SQL<unknown>): Promise<AuthenticatedUser | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      sessionIp: sessions.ip,
      deviceHash: sessions.deviceHash,
      id: users.id,
      email: users.email,
      pseudo: users.pseudo,
      avatarSeed: users.avatarSeed,
      createdAt: users.createdAt,
      isBanned: users.isBanned,
      role: users.role,
      isAdmin: users.isAdmin,
      deletedAt: users.deletedAt,
      balance: wallets.balance,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(wallets, eq(wallets.userId, users.id))
    .where(and(predicate, gt(sessions.expiresAt, new Date())))
    .limit(1);

  // `deletedAt` double la révocation des sessions faite à la fermeture : il
  // couvre la session créée dans la seconde qui précède l'anonymisation.
  if (!row || row.deletedAt) return null;

  await assertAccessAllowed({
    userId: row.id,
    role: row.role,
    ip: row.sessionIp,
    deviceHash: row.deviceHash,
  });
  await assertLegacyAccountAllowed(row.id, row.isBanned, row.role);

  return {
    sessionId: row.sessionId,
    id: row.id,
    email: row.email,
    pseudo: row.pseudo,
    avatarSeed: row.avatarSeed,
    role: row.role,
    isAdmin: row.isAdmin,
    ip: row.sessionIp,
    deviceHash: row.deviceHash,
    balance: row.balance ?? 0,
    createdAt: row.createdAt,
  };
}

export async function resolveSession(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  return resolveSessionWhere(eq(sessions.tokenHash, hashToken(token)));
}

/** Revalidation périodique des sockets sans conserver le jeton HTTP en mémoire. */
export function resolveSessionById(sessionId: string): Promise<AuthenticatedUser | null> {
  return resolveSessionWhere(eq(sessions.id, sessionId));
}

export async function revokeSession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const [revoked] = await db
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .returning({ id: sessions.id });
  return revoked?.id ?? null;
}

/** Déconnecte le compte de partout. Utilisé au changement de mot de passe et au bannissement. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await revokeAllSessionsIn(db, userId);
}

/** Révoque les sessions dans la transaction fournie par l'appelant. */
export async function revokeAllSessionsIn(
  exec: Pick<Database, "delete">,
  userId: string,
): Promise<void> {
  await exec.delete(sessions).where(eq(sessions.userId, userId));
}

/** Purge des sessions expirées, planifiée au démarrage puis quotidiennement. */
export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    // `Secure` casserait la connexion en http://localhost pendant le développement.
    secure: isProduction,
    sameSite: "lax",
    signed: true,
    maxAge: env.SESSION_TTL_DAYS * 86_400,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}
