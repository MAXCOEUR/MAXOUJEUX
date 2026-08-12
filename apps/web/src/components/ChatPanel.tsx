import { CHAT_MAX_LENGTH, type ChatMessage } from "@maxoujeux/shared";
import { Send } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { sendChat, useChat } from "@/lib/chat";
import { cn } from "@/lib/cn";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  /** Identifiant du joueur courant : ses messages passent à droite. */
  meId?: string | null;
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
export function ChatPanel({ open, onClose, meId, messages: providedMessages }: ChatPanelProps) {
  const chatMessages = useChat((state) => state.messages);
  const messages = providedMessages ?? chatMessages;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const nearBottomRef = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

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
    if (reply.ok) {
      setDraft("");
      // On force le retour en bas : après un envoi, on veut voir son propre
      // message, même si on lisait plus haut dans l'historique.
      nearBottomRef.current = true;
    } else {
      setError(reply.message);
    }
    // Le champ garde le focus : sans cela l'envoi au bouton oblige à recliquer
    // dans la zone de saisie pour enchaîner un second message.
    fieldRef.current?.focus();
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
      {/* Hauteur pleine et `min-h-0` : la liste est la seule à défiler, la barre
          de saisie reste collée en bas quoi qu'il arrive au fil des messages. */}
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
            {messages.map((message) => (
              <ChatMessageRow
                key={message.id}
                message={message}
                mine={meId !== undefined && meId !== null && message.userId === meId}
              />
            ))}
          </ol>
        )}

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-line pt-4"
        >
          <label htmlFor="chat-message" className="sr-only">Écrire un message</label>
          <textarea
            ref={fieldRef}
            id="chat-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={CHAT_MAX_LENGTH}
            rows={2}
            readOnly={pending}
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

/**
 * Une ligne de message.
 *
 * Ses propres messages sont renvoyés à droite, avatar compris : c'est la
 * convention de toutes les messageries, et elle se lit d'un coup d'œil sans
 * avoir à comparer les pseudos.
 */
function ChatMessageRow({ message, mine }: { message: ChatMessage; mine: boolean }) {
  return (
    <li className={cn("flex items-start gap-2.5", mine && "flex-row-reverse")}>
      <Avatar
        seed={message.avatarSeed}
        pseudo={message.pseudo}
        className="size-8 shrink-0 text-xs"
      />
      <div
        className={cn(
          "min-w-0 max-w-[80%] rounded-xl px-3 py-2",
          mine ? "border border-brass/30 bg-brass/10" : "bg-felt-raised/70",
        )}
      >
        <div className={cn("flex items-baseline gap-2", mine && "flex-row-reverse")}>
          <span className="truncate text-sm font-semibold text-cream">
            {mine ? "Moi" : message.pseudo}
          </span>
          <time dateTime={message.createdAt} className="shrink-0 text-xs text-cream-faint">
            {formatTime(message.createdAt)}
          </time>
        </div>
        <p
          className={cn(
            "mt-0.5 whitespace-pre-wrap break-words text-sm text-cream-dim",
            mine && "text-right",
          )}
        >
          {message.body}
        </p>
      </div>
    </li>
  );
}
