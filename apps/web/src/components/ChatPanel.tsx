import { CHAT_MAX_LENGTH, type ChatMessage } from "@maxoujeux/shared";
import { Send } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { sendChat, useChat } from "@/lib/chat";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  /** Injection réservée au rendu statique des tests. */
  messages?: ChatMessage[];
}

const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatUnreadBadge(unread: number): string {
  return unread > 999 ? "999+" : String(unread);
}

function formatTime(createdAt: string): string {
  return timeFormatter.format(new Date(createdAt));
}

/** Discussion générale, conservée uniquement pendant la session courante. */
export function ChatPanel({ open, onClose, messages: providedMessages }: ChatPanelProps) {
  const chatMessages = useChat((state) => state.messages);
  const messages = providedMessages ?? chatMessages;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const nearBottomRef = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (open && list && nearBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [messages.length, open]);

  function handleScroll() {
    const list = listRef.current;
    if (!list) return;
    nearBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setError(null);
    setPending(true);
    const reply = await sendChat(draft);
    setPending(false);
    if (reply.ok) setDraft("");
    else setError(reply.message);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="lateral"
      label="Chat global"
      title="Chat global"
      className="overflow-hidden"
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        {messages.length === 0 ? (
          <p className="grid flex-1 place-items-center text-center text-sm text-cream-faint">
            Aucun message pour le moment
          </p>
        ) : (
          <ol
            ref={listRef}
            onScroll={handleScroll}
            className="-mr-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2"
          >
            {messages.map((message) => <ChatMessageRow key={message.id} message={message} />)}
          </ol>
        )}

        <form ref={formRef} onSubmit={handleSubmit} className="border-t border-line pt-4">
          <label htmlFor="chat-message" className="sr-only">Écrire un message</label>
          <textarea
            id="chat-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={CHAT_MAX_LENGTH}
            rows={3}
            disabled={pending}
            placeholder="Écrire un message…"
            className="w-full resize-none rounded-xl border border-line bg-felt-deep px-3 py-2.5 text-sm text-cream outline-none placeholder:text-cream-faint focus:border-brass/70"
          />
          {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-cream-faint">Entrée pour envoyer · Maj+Entrée pour une ligne</p>
            <Button type="submit" loading={pending} disabled={!draft.trim()} className="shrink-0 px-3">
              <Send className="size-4" aria-hidden />
              Envoyer
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

function ChatMessageRow({ message }: { message: ChatMessage }) {
  return (
    <li className="flex items-start gap-2.5">
      <Avatar seed={message.avatarSeed} pseudo={message.pseudo} className="size-8 text-xs" />
      <div className="min-w-0 flex-1 rounded-xl bg-felt-raised/70 px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-cream">{message.pseudo}</span>
          <time dateTime={message.createdAt} className="shrink-0 text-xs text-cream-faint">
            {formatTime(message.createdAt)}
          </time>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-cream-dim">{message.body}</p>
      </div>
    </li>
  );
}
