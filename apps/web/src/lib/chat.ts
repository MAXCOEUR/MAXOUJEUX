import {
  CHAT_CLIENT_LIMIT,
  CHAT_MAX_LENGTH,
  chatSendSchema,
  type ActionReply,
  type ChatMessage,
} from "@maxoujeux/shared";
import { create } from "zustand";
import { emitWithAck } from "./socket.js";

interface ChatState {
  messages: ChatMessage[];
  isOpen: boolean;
  unread: number;
  receive: (message: ChatMessage) => void;
  open: () => void;
  close: () => void;
  clear: () => void;
}

/** Chat volontairement éphémère : ni historique local, ni donnée d'un autre compte. */
export const useChat = create<ChatState>((set) => ({
  messages: [],
  isOpen: false,
  unread: 0,

  receive: (message) =>
    set((state) => ({
      messages: [...state.messages, message].slice(-CHAT_CLIENT_LIMIT),
      unread: state.isOpen ? 0 : Math.min(state.unread + 1, CHAT_CLIENT_LIMIT),
    })),
  open: () => set({ isOpen: true, unread: 0 }),
  close: () => set({ isOpen: false }),
  clear: () => set({ messages: [], isOpen: false, unread: 0 }),
}));

/** Valide immédiatement le brouillon puis laisse le serveur décider de l'envoi. */
export function sendChat(body: string): Promise<ActionReply> {
  const parsed = chatSendSchema.safeParse({ body });
  if (!parsed.success) {
    return Promise.resolve({
      ok: false,
      code: "VALIDATION_ERROR",
      message: `Le message doit contenir entre 1 et ${CHAT_MAX_LENGTH} caractères.`,
    });
  }

  return emitWithAck((socket, ack) => socket.emit("chat:send", parsed.data, ack));
}
