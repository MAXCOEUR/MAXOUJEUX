import { z } from "zod";
import { passwordSchema, registerSchema } from "./auth.js";

export const createPlayerSchema = registerSchema;
export const resetPlayerPasswordSchema = z.object({ password: passwordSchema });
export const setPlayerBalanceSchema = z.object({
  balance: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type ResetPlayerPasswordInput = z.infer<typeof resetPlayerPasswordSchema>;
export type SetPlayerBalanceInput = z.infer<typeof setPlayerBalanceSchema>;

export interface AdminAccount {
  id: string;
  email: string;
  pseudo: string;
  avatarSeed: string;
  isAdmin: boolean;
  balance: number;
  createdAt: string;
  lastSeenAt: string;
}
