import type { CurrentUser } from "@maxoujeux/shared";
import type { AuthenticatedUser } from "./session.js";

/**
 * Seul constructeur du profil renvoyé au client.
 *
 * Sorti des routes d'auth le jour où le module « compte » a eu besoin d'en
 * renvoyer un : deux sérialisations du même profil finiraient par diverger, et
 * c'est exactement le genre d'écart par lequel un hash de mot de passe part un
 * jour sur le réseau.
 */
export function toPublicUser(user: AuthenticatedUser): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    pseudo: user.pseudo,
    avatarSeed: user.avatarSeed,
    role: user.role,
    isAdmin: user.isAdmin,
    balance: user.balance,
    createdAt: user.createdAt.toISOString(),
  };
}
