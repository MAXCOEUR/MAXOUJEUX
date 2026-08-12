import { CHAT_MAX_LENGTH, type ChatMessage } from "@maxoujeux/shared";
import { Send } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
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
  /** Repère initial des nouveaux messages — réservé aux tests. */
  newFrom?: string | null;
}

const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Durée d'affichage du trait « nouveaux messages » une fois le chat ouvert. */
const MARQUEUR_MS = 10_000;

/** Marge sous laquelle on considère le lecteur collé au bas de la liste. */
const BAS_DE_LISTE_PX = 64;

export function formatUnreadBadge(unread: number): string {
  return unread > 999 ? "999+" : String(unread);
}

function formatTime(createdAt: string): string {
  return timeFormatter.format(new Date(createdAt));
}

/** Discussion générale, conservée uniquement pendant la session courante. */
export function ChatPanel({
  open,
  onClose,
  meId,
  messages: providedMessages,
  newFrom,
}: ChatPanelProps) {
  const chatMessages = useChat((state) => state.messages);
  const messages = providedMessages ?? chatMessages;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Premier message non lu : c'est lui qui porte le trait rouge. */
  const [marqueur, setMarqueur] = useState<string | null>(newFrom ?? null);
  const listRef = useRef<HTMLOListElement>(null);
  const nearBottomRef = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const dernierIdRef = useRef<string | null>(messages.at(-1)?.id ?? null);
  const placeRef = useRef(false);

  function collerEnBas(list: HTMLOListElement) {
    list.scrollTop = list.scrollHeight;
    nearBottomRef.current = true;
  }

  /**
   * Arrivée d'un message.
   *
   * Deux cas et deux seulement : soit on lisait déjà le bas de la liste et on
   * suit le fil, soit on lisait plus haut — ou le chat était fermé — et on ne
   * bouge pas d'un pixel. Déplacer quelqu'un en pleine lecture est la faute
   * classique des chats.
   */
  useEffect(() => {
    const dernierId = messages.at(-1)?.id ?? null;
    if (dernierId === dernierIdRef.current) return;

    const precedent = dernierIdRef.current;
    dernierIdRef.current = dernierId;
    if (!dernierId) return;

    const list = listRef.current;
    if (open && nearBottomRef.current && list) {
      collerEnBas(list);
      setMarqueur(null);
      return;
    }

    // Le premier non lu, ou le dernier message quand l'historique a été
    // tronqué entre-temps et que le précédent n'y figure plus.
    const index = precedent ? messages.findIndex((entry) => entry.id === precedent) : -1;
    const premierNouveau = (index >= 0 ? messages[index + 1] : messages.at(-1))?.id ?? null;
    setMarqueur((actuel) => actuel ?? premierNouveau);
  }, [messages, open]);

  /**
   * Placement à l'ouverture.
   *
   * Sans nouveau message on arrive en bas, sur le dernier échange. Avec, on
   * cadre le trait rouge à mi-hauteur : le contexte qui précède reste visible
   * au-dessus, ce qu'un simple saut en haut du non-lu ne donne pas.
   */
  useEffect(() => {
    if (!open) {
      placeRef.current = false;
      return;
    }
    if (placeRef.current) return;

    const list = listRef.current;
    if (!list) return;
    placeRef.current = true;

    const repere = marqueur
      ? list.querySelector<HTMLElement>('[data-marqueur="nouveaux"]')
      : null;
    if (!repere) {
      collerEnBas(list);
      return;
    }

    const ecart = repere.getBoundingClientRect().top - list.getBoundingClientRect().top;
    const cible = list.scrollTop + ecart - list.clientHeight / 2;
    list.scrollTop = Math.max(0, Math.min(cible, list.scrollHeight - list.clientHeight));
    nearBottomRef.current =
      list.scrollHeight - list.scrollTop - list.clientHeight < BAS_DE_LISTE_PX;
  }, [open, marqueur]);

  /**
   * Effacement du trait, dix secondes après qu'il a été **vu**.
   *
   * Le décompte part à l'entrée dans le champ de vision, pas à l'ouverture du
   * panneau : un trait posé en bas de liste pendant qu'on lit plus haut
   * s'effacerait sinon sans avoir jamais été affiché. Une fois lancé, le
   * décompte n'est plus interrompu — repartir à zéro à chaque aller-retour de
   * défilement rendrait le trait quasi indélébile.
   */
  useEffect(() => {
    if (!open || !marqueur) return;

    const list = listRef.current;
    const repere = list?.querySelector<HTMLElement>('[data-marqueur="nouveaux"]');
    if (!list || !repere) return;

    let timer: number | undefined;
    const observateur = new IntersectionObserver(
      (entrees) => {
        if (timer !== undefined || !entrees.some((entree) => entree.isIntersecting)) return;
        timer = window.setTimeout(() => setMarqueur(null), MARQUEUR_MS);
        observateur.disconnect();
      },
      { root: list },
    );
    observateur.observe(repere);

    return () => {
      observateur.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [open, marqueur]);

  function handleScroll() {
    const list = listRef.current;
    if (!list) return;
    nearBottomRef.current =
      list.scrollHeight - list.scrollTop - list.clientHeight < BAS_DE_LISTE_PX;
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
              <Fragment key={message.id}>
                {message.id === marqueur && <SeparateurNouveaux />}
                <ChatMessageRow
                  message={message}
                  mine={meId !== undefined && meId !== null && message.userId === meId}
                />
              </Fragment>
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

/** Trait rouge posé devant le premier message non lu. */
function SeparateurNouveaux() {
  return (
    <li data-marqueur="nouveaux" className="flex items-center gap-2 py-0.5">
      <span aria-hidden className="h-px flex-1 bg-danger/60" />
      <span className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-danger">
        Nouveaux messages
      </span>
      <span aria-hidden className="h-px flex-1 bg-danger/60" />
    </li>
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
