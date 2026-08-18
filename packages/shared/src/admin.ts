import { z } from "zod";
import { passwordSchema, registerSchema, type UserRole } from "./auth.js";

export const createPlayerSchema = registerSchema;
export const resetPlayerPasswordSchema = z.object({ password: passwordSchema });
export const setPlayerBalanceSchema = z.object({
  balance: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export const setUserRoleSchema = z.object({ role: z.enum(["player", "moderator"]) });

export const BAN_KINDS = ["account", "ip", "device"] as const;
export const BAN_DURATIONS = ["1h", "1d", "7d", "30d", "permanent"] as const;
export const banKindSchema = z.enum(BAN_KINDS);
export const banDurationSchema = z.enum(BAN_DURATIONS);
export const banAccountSchema = z
  .object({
    kinds: z.array(banKindSchema).min(1).max(BAN_KINDS.length),
    accessId: z.string().uuid().optional(),
    reason: z.string().trim().min(3).max(500),
    duration: banDurationSchema,
  })
  .superRefine((value, ctx) => {
    if (value.kinds.some((kind) => kind !== "account") && !value.accessId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accessId"],
        message: "Choisis une connexion récente pour bannir l’IP ou la machine",
      });
    }
    if (new Set(value.kinds).size !== value.kinds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kinds"],
        message: "Chaque type de bannissement ne peut être choisi qu’une fois",
      });
    }
  });

export type BanKind = z.infer<typeof banKindSchema>;
export type BanDuration = z.infer<typeof banDurationSchema>;

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type ResetPlayerPasswordInput = z.infer<typeof resetPlayerPasswordSchema>;
export type SetPlayerBalanceInput = z.infer<typeof setPlayerBalanceSchema>;
export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;
export type BanAccountInput = z.infer<typeof banAccountSchema>;

export interface AccountAccess {
  id: string;
  ip: string;
  hasDevice: boolean;
  userAgent: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ModerationBan {
  id: string;
  kind: BanKind;
  accountId: string | null;
  targetLabel: string;
  reason: string;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

export interface AdminAccount {
  id: string;
  email: string;
  pseudo: string;
  avatarSeed: string;
  role: UserRole;
  isBanned: boolean;
  /** @deprecated Utiliser `role === "admin"`. */
  isAdmin: boolean;
  balance: number;
  createdAt: string;
  lastSeenAt: string;
}
