import { z } from "zod";

/**
 * Règles de validation partagées entre le front et l'API.
 * Le front les utilise pour l'affichage immédiat des erreurs,
 * l'API les rejoue systématiquement : la validation client n'est jamais une garantie.
 */

export const PSEUDO_MIN = 3;
export const PSEUDO_MAX = 20;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** Lettres, chiffres, tiret et underscore. Pas d'espace ni d'accent pour éviter les homoglyphes. */
const PSEUDO_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Email requis")
  .max(254, "Email trop long")
  .email("Format d'email invalide");

export const pseudoSchema = z
  .string()
  .trim()
  .min(PSEUDO_MIN, `Le pseudo doit faire au moins ${PSEUDO_MIN} caractères`)
  .max(PSEUDO_MAX, `Le pseudo ne doit pas dépasser ${PSEUDO_MAX} caractères`)
  .regex(PSEUDO_PATTERN, "Lettres, chiffres, tiret et underscore uniquement");

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères`)
  .max(PASSWORD_MAX, "Mot de passe trop long");

export const registerSchema = z.object({
  email: emailSchema,
  pseudo: pseudoSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Mot de passe requis"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const USER_ROLES = ["player", "moderator", "admin"] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Profil renvoyé au client. Ne contient jamais le hash ni l'email d'un autre joueur. */
export interface CurrentUser {
  id: string;
  email: string;
  pseudo: string;
  avatarSeed: string;
  role: UserRole;
  /** @deprecated Utiliser `role === "admin"`. */
  isAdmin: boolean;
  balance: number;
  createdAt: string;
}
