import { z } from "zod";

export const CHAT_MAX_LENGTH = 500;
export const CHAT_CLIENT_LIMIT = 1000;

const normalizeChatBody = (value: string) =>
  value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim();

export const chatSendSchema = z.object({
  body: z.string().transform(normalizeChatBody).pipe(z.string().min(1).max(CHAT_MAX_LENGTH)),
});

export type ChatSendInput = z.infer<typeof chatSendSchema>;

export interface ChatMessage {
  id: string;
  userId: string;
  pseudo: string;
  avatarSeed: string;
  body: string;
  createdAt: string;
}
