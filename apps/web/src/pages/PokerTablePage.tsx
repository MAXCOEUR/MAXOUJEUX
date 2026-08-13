import {
  POKER_RANKING,
  POKER_CATEGORY_LABELS,
  formatCoins,
  type CurrentUser,
  type PokerActionKind,
  type PokerView,
} from "@maxoujeux/shared";
import { ArrowLeft, Eye, Loader2, LogOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Lien } from "@/components/Lien";
import { Modal } from "@/components/Modal";
import { Plaque } from "@/components/Plaque";
import { PokerTable } from "@/components/games/PokerTable";
import { cn } from "@/lib/cn";
import { actionButtonLabel, freeSeats, pokerAnnounce } from "@/lib/poker-ui";
import { usePoker } from "@/lib/poker";
import { navigate } from "@/lib/route";
import { request, useRealtime } from "@/lib/socket";
import { pushToast } from "@/lib/toast";

/**
 * La table de poker.
 *
 * L'écran ne calcule **aucune règle** : les coups permis, les montants minimum
 * et maximum viennent tous du serveur, dans `view.allowed`. Un bouton absent
 * est un coup interdit, décidé côté serveur.
 */
export function PokerTablePage({ tableId }: { user: CurrentUser; tableId: string }) {
  const view = usePoker((state) => state.view);
  const status = useRealtime((state) => state.status);

  if (!view || view.id !== tableId) {
    return (
      <div className="grid place-items-center py-24">
        {status === "connected" ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-cream-dim">Cette table n'est plus ouverte.</p>
            <Lien to={{ name: "salon", game: "poker" }} className="text-sm text-brass underline">
              Retour au salon
            </Lien>
          </div>
        ) : (
          <Loader2 className="size-6 animate-spin text-game-poker" aria-label="Chargement" />
        )}
      </div>
    );
  }

  return <PokerTableScreen view={view} />;
}

function PokerTableScreen({ view }: { view: PokerView }) {
  const pending = usePoker((state) => state.pending);
  const markPending = usePoker((state) => state.markPending);
  const clearPending = usePoker((state) => state.clearPending);
  const [sitting, setSitting] = useState<number | null>(null);
  const [sortie, setSortie] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [relance, setRelance] = useState<number | null>(null);

  const assis = view.you !== null;
  const moi = view.seats.find((seat) => seat.seat === view.you) ?? null;
  const annonce = useMemo(() => pokerAnnounce(view), [view]);

  // La relance proposée repart du minimum à chaque fois que c'est à nous.
  useEffect(() => {
    setRelance(view.allowed ? view.allowed.minRaiseTo : null);
  }, [view.allowed?.minRaiseTo, view.turn, view.version]);

  /** Envoie une intention et laisse l'état serveur débloquer l'écran. */
  async function intention(nom: string, envoi: () => Promise<{ ok: boolean; message?: string }>) {
    markPending(nom);
    const reponse = await envoi();
    if (!reponse.ok) {
      clearPending();
      // Le message vient du serveur : il dit précisément ce qui a été refusé.
      if (reponse.message) pushToast("erreur", reponse.message);
    }
  }

  async function sAsseoir(seat: number) {
    setSitting(seat);
    const cave = view.config.minBuyIn;
    const reponse = await request<null>((socket, ack) =>
      socket.emit("poker:sit", { tableId: view.id, seat, buyIn: cave }, ack),
    );
    setSitting(null);
    if (!reponse.ok) pushToast("erreur", reponse.message);
  }

  async function parler(kind: PokerActionKind) {
    const montant = kind === "bet" || kind === "raise" ? (relance ?? undefined) : undefined;
    await intention(kind, () =>
      request<null>((socket, ack) =>
        socket.emit(
          "poker:act",
          { tableId: view.id, version: view.version, action: kind, ...(montant === undefined ? {} : { amount: montant }) },
          ack,
        ),
      ),
    );
  }

  async function quitter() {
    setLeaving(true);
    await request<null>((socket, ack) => socket.emit("match:leave", { tableId: view.id }, ack));
    setLeaving(false);
    setSortie(false);
    navigate({ name: "salon", game: "poker" });
  }

  const libres = freeSeats(view);

  return (
    <div className="space-y-4 pb-52 sm:pb-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setSortie(true)}
          className="-my-2 inline-flex min-h-11 items-center gap-1.5 py-2 text-sm text-cream-dim transition-colors hover:text-cream"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Le salon
        </button>
        <div className="flex items-center gap-2">
          {!assis && (
            <Plaque tone="neutre" icon={Eye}>
              Spectateur
            </Plaque>
          )}
          <Plaque tone="neutre">
            {formatCoins(view.config.smallBlind)} / {formatCoins(view.config.bigBlind)}
          </Plaque>
          <Button variant="ghost" onClick={() => setSortie(true)} className="text-xs">
            Quitter
          </Button>
        </div>
      </div>

      {view.pendingConfig && (
        <p className="rounded-xl border border-brass/40 bg-brass/10 px-4 py-2 text-center text-sm text-cream">
          Blindes à {formatCoins(view.pendingConfig.smallBlind)} /{" "}
          {formatCoins(view.pendingConfig.bigBlind)} à la main suivante.
        </p>
      )}

      <PokerTable
        view={view}
        sitting={sitting}
        onSit={!assis && libres.length > 0 ? (seat) => void sAsseoir(seat) : undefined}
      />

      <p className="text-center text-sm text-cream-dim">{annonce}</p>

      {/* Barre d'actions, ancrée en bas sur téléphone : c'est là que se joue la
          partie, elle ne doit jamais demander de faire défiler la page. */}
      <section
        aria-label={assis ? "Tes actions" : "Rejoindre la table"}
        className={cn(
          "panel fixed inset-x-0 bottom-0 z-20 rounded-b-none p-3",
          "pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
          "sm:static sm:rounded-panel sm:p-4 sm:pb-4",
        )}
      >
        {!assis ? (
          <p className="text-center text-sm text-cream-dim">
            {libres.length > 0
              ? "Choisis une place libre pour entrer dans la partie."
              : "La table est complète. Tu peux rester regarder."}
          </p>
        ) : view.allowed ? (
          <Actions
            allowed={view.allowed}
            step={view.config.smallBlind}
            pending={pending}
            relance={relance ?? view.allowed.minRaiseTo}
            onRelance={setRelance}
            onParler={(kind) => void parler(kind)}
          />
        ) : (
          <p className="text-center text-sm text-cream-dim">
            {moi?.status === "folded"
              ? "Tu es couché sur ce coup."
              : view.phase === "waiting"
                ? "En attente d'un deuxième joueur."
                : "Au tour d'un autre joueur."}
          </p>
        )}
      </section>

      <Combinaisons />

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {annonce}
      </p>

      <LeaveDialog
        open={sortie}
        onClose={() => setSortie(false)}
        assis={assis}
        stack={moi?.stack ?? 0}
        leaving={leaving}
        onGarder={() => {
          setSortie(false);
          navigate({ name: "salon", game: "poker" });
        }}
        onQuitter={() => void quitter()}
      />
    </div>
  );
}

/**
 * Les coups possibles.
 *
 * La liste vient **entièrement du serveur** : un bouton absent est un coup
 * interdit. Le curseur est borné par `minRaiseTo` et `maxRaiseTo`, eux aussi
 * calculés côté serveur — le front ne connaît pas la règle de relance minimale.
 */
function Actions({
  allowed,
  step,
  pending,
  relance,
  onRelance,
  onParler,
}: {
  allowed: NonNullable<PokerView["allowed"]>;
  step: number;
  pending: string | null;
  relance: number;
  onRelance: (montant: number) => void;
  onParler: (kind: PokerActionKind) => void;
}) {
  const peutRelancer = allowed.actions.includes("bet") || allowed.actions.includes("raise");

  return (
    <div className="space-y-3">
      {peutRelancer && (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={allowed.minRaiseTo}
            max={allowed.maxRaiseTo}
            step={step}
            value={relance}
            onChange={(event) => onRelance(Number(event.target.value))}
            aria-label="Montant de la relance"
            className="h-11 flex-1 accent-[var(--color-brass)]"
          />
          <span className="tabular w-24 text-right font-display text-sm font-bold text-brass">
            {formatCoins(relance)}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {allowed.actions.map((kind) => (
          <Button
            key={kind}
            variant={
              kind === "fold" ? "ghost" : kind === "check" || kind === "call" ? "outline" : "primary"
            }
            onClick={() => onParler(kind)}
            loading={pending === kind}
            className="min-w-24"
          >
            {actionButtonLabel(kind, allowed)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Les combinaisons, du plus fort au plus faible.
 *
 * L'ordre vient du contrat partagé, celui-là même qui sert au classement : une
 * aide écrite à la main finirait par mentir le jour où le barème bouge.
 */
function Combinaisons() {
  return (
    <section className="panel p-5" aria-labelledby="poker-ranking">
      <h2 id="poker-ranking" className="font-display text-sm font-bold text-cream">
        Les mains, de la plus forte à la plus faible
      </h2>
      <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {POKER_RANKING.map((categorie, index) => (
          <li key={categorie} className="flex items-baseline gap-2 text-xs">
            <span className="tabular w-4 text-right text-cream-faint">{index + 1}</span>
            <span className="text-cream-dim">{POKER_CATEGORY_LABELS[categorie]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LeaveDialog({
  open,
  onClose,
  assis,
  stack,
  leaving,
  onGarder,
  onQuitter,
}: {
  open: boolean;
  onClose: () => void;
  assis: boolean;
  stack: number;
  leaving: boolean;
  onGarder: () => void;
  onQuitter: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quitter cette page ?"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onGarder} disabled={leaving} className="flex-1">
            {assis ? "Garder ma place" : "Rester à la table"}
          </Button>
          <Button variant="outline" onClick={onQuitter} loading={leaving} className="flex-1">
            <LogOut className="size-4" aria-hidden />
            Quitter la table
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-cream">
          Tu peux aller au salon sans rendre ta place : un bandeau te ramènera ici en un clic.
        </p>
        {assis && stack > 0 && (
          <p className="rounded-xl border border-brass/40 bg-brass/10 px-4 py-3 text-cream">
            Tes {formatCoins(stack)} de jetons repartiront sur ton solde MaxouCoin en quittant la
            table.
          </p>
        )}
        <p className="text-cream-dim">
          Un départ en pleine main attend la fin du coup : tes jetons restent en jeu jusque-là.
        </p>
      </div>
    </Modal>
  );
}
