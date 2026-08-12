import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import { db } from "../../db/index.js";
import { sessions, users, wallets } from "../../db/schema.js";
import { env, isProduction } from "../../env.js";

export const SESSION_COOKIE = "mxj_session";

const TOKEN_BYTES = 32;

/** Le jeton en clair ne quitte jamais la réponse HTTP ; la base n'en voit que le SHA-256. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  pseudo: string;
  avatarSeed: string;
  isAdmin: boolean;
  balance: number;
  createdAt: Date;
}

export interface RequestOrigin {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/** Crée une session en base et renvoie le jeton en clair à poser en cookie. */
export async function createSession(userId: string, origin: RequestOrigin): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 86_400_000);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ip: origin.ip ?? null,
    userAgent: origin.userAgent?.slice(0, 255) ?? null,
  });

  return token;
}

/**
 * Résout un jeton en utilisateur, ou `null` s'il est invalide, expiré,
 * ou si le compte est banni.
 *
 * Cette fonction est appelée à chaque requête authentifiée *et* au handshake
 * Socket.IO : c'est le point d'entrée unique de l'identité.
 */
export async function resolveSession(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null;

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      pseudo: users.pseudo,
      avatarSeed: users.avatarSeed,
      createdAt: users.createdAt,
      isBanned: users.isBanned,
      isAdmin: users.isAdmin,
      balance: wallets.balance,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(wallets, eq(wallets.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row || row.isBanned) return null;

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

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Déconnecte le compte de partout. Utilisé au changement de mot de passe et au bannissement. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
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
