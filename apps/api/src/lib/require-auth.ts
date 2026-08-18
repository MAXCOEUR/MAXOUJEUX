import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { SESSION_COOKIE, resolveSession, type AuthenticatedUser } from "../modules/auth/session.js";
import { AppError } from "./errors.js";
import { DEVICE_HEADER, hashDeviceFingerprint, normalizeIp } from "./access-context.js";
import { assertAccessAllowed } from "../modules/moderation/service.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Renseigné par `requireAuth`. Absent sur les routes publiques. */
    user?: AuthenticatedUser;
  }
}

/** Extrait et vérifie la signature du cookie de session. */
export function readSessionToken(request: FastifyRequest): string | undefined {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return undefined;

  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : undefined;
}

/**
 * Hook à poser sur toute route privée. Résout la session à chaque requête
 * plutôt que de faire confiance à un jeton auto-porteur : un compte banni ou
 * déconnecté perd l'accès immédiatement, sans attendre l'expiration.
 */
export const requireAuth: preHandlerHookHandler = async (request: FastifyRequest, _reply: FastifyReply) => {
  const user = await resolveSession(readSessionToken(request));
  if (!user) {
    throw new AppError(401, "UNAUTHENTICATED", "Connexion requise");
  }
  const rawDevice = request.headers[DEVICE_HEADER];
  await assertAccessAllowed({
    userId: user.id,
    role: user.role,
    ip: normalizeIp(request.ip),
    deviceHash: hashDeviceFingerprint(typeof rawDevice === "string" ? rawDevice : undefined),
  });
  request.user = user;
};

/**
 * Variante pour les ressources chargées par le navigateur lui-même (`img`).
 * Une balise image ne peut pas joindre `X-MaxouJeux-Device` : on contrôle donc
 * l'IP courante et l'empreinte déjà liée à la session, sans jamais affaiblir
 * les contrôles de ban compte, IP ou machine.
 */
export const requireResourceAuth: preHandlerHookHandler = async (
  request: FastifyRequest,
  _reply: FastifyReply,
) => {
  const user = await resolveSession(readSessionToken(request));
  if (!user) {
    throw new AppError(401, "UNAUTHENTICATED", "Connexion requise");
  }
  await assertAccessAllowed({
    userId: user.id,
    role: user.role,
    ip: normalizeIp(request.ip),
    deviceHash: user.deviceHash,
  });
  request.user = user;
};

/** Accès à l'utilisateur authentifié depuis un gestionnaire protégé par `requireAuth`. */
export function currentUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) {
    throw new AppError(401, "UNAUTHENTICATED", "Connexion requise");
  }
  return request.user;
}
