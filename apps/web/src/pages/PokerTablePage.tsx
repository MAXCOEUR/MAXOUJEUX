import {
  POKER_RANKING,
  POKER_CATEGORY_LABELS,
  formatCoins,
  type ActiveMatchView,
  type CurrentUser,
  type PokerActionKind,
  type PokerSeatView,
  type PokerView,
} from "@maxoujeux/shared";
import { ArrowLeft, Eye, Loader2, LogOut, Pause, Play, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Lien } from "@/components/Lien";
import { Modal } from "@/components/Modal";
import { Plaque } from "@/components/Plaque";
import { PokerTable } from "@/components/games/PokerTable";
import { cn } from "@/lib/cn";
import { actionButtonLabel, freeSeats, pokerAnchorSeat, pokerAnnounce } from "@/lib/poker-ui";
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

export function PokerTableScreen({ view }: { view: PokerView }) {
  const pending = usePoker((state) => state.pending);
  const markPending = usePoker((state) => state.markPending);
  const clearPending = usePoker((state) => state.clearPending);
  const [sitting, setSitting] = useState<number | null>(null);
  const [sortie, setSortie] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [relance, setRelance] = useState<number | null>(null);
  /**
   * Joueur suivi par un spectateur.
   *
   * Le serveur le mémorise pour ne révéler que sa main au récapitulatif. En
   * direct, toutes les cartes adverses restent filtrées côté serveur.
   */
  const suivi = view.followedUserId;

  const assis = view.you !== null;
  const moi = view.seats.find((seat) => seat.seat === view.you) ?? null;
  const annonce = useMemo(() => pokerAnnounce(view), [view]);

  // La relance proposée repart du minimum à chaque fois que c'est à nous.
  useEffect(() => {
    setRelance(view.allowed ? view.allowed.minRaiseTo : null);
  }, [view.allowed?.minRaiseTo, view.turn, view.version]);

  /** Envoie une intention et laisse l'état serveur débloquer l'écran. */
  async function intention(nom: string, envoi: () => Promise<{ ok: boolean; message?: string }>) {
    if (usePoker.getState().pending) return;
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

  /** Montrer son jeu après s'être couché. Sans retour en arrière. */
  async function montrer() {
    await intention("reveal", () =>
      request<null>((socket, ack) => socket.emit("poker:reveal", { tableId: view.id }, ack)),
    );
  }

  async function recaver(montant: number) {
    await intention("rebuy", () =>
      request<null>((socket, ack) =>
        socket.emit("poker:rebuy", { tableId: view.id, amount: montant }, ack),
      ),
    );
  }

  async function basculerPause(pause: boolean) {
    await intention("sitout", () =>
      request<null>((socket, ack) =>
        socket.emit("poker:sitout", { tableId: view.id, out: pause }, ack),
      ),
    );
  }

  /** Le serveur mémorise le suivi sans jamais ouvrir une main pendant le coup. */
  async function suivre(userId: string | null) {
    await intention("follow", () =>
      request<null>((socket, ack) =>
        socket.emit("poker:follow", { tableId: view.id, userId }, ack),
      ),
    );
  }

  /** Les blindes se règlent par la petite : la grosse en vaut toujours le double. */
  async function reglerBlindes(petite: number) {
    await intention("blinds", () =>
      request<null>((socket, ack) =>
        socket.emit(
          "poker:blinds",
          { tableId: view.id, smallBlind: petite, bigBlind: petite * 2 },
          ack,
        ),
      ),
    );
  }

  /**
   * Quitter la table.
   *
   * Un départ en pleine main **ne libère pas la place tout de suite** : le
   * serveur le diffère à la fin du coup, jetons toujours engagés. Partir en
   * annonçant « c'est fait » serait un mensonge — le joueur découvrirait plus
   * tard que les autres jeux lui sont refusés. On redemande donc l'état après
   * coup : encore assis, on le dit et on reste ; parti, on efface et on sort.
   */
  async function quitter() {
    setLeaving(true);
    await request<null>((socket, ack) => socket.emit("match:leave", { tableId: view.id }, ack));
    const apres = await request<ActiveMatchView | null>((socket, ack) =>
      socket.emit("match:sync", ack),
    );
    setLeaving(false);
    setSortie(false);

    const encore =
      apres.ok && apres.data?.game === "poker" && apres.data.id === view.id ? apres.data : null;
    if (encore && encore.you !== null) {
      usePoker.getState().apply(encore);
      pushToast("info", "Ta place est rendue à la fin du coup : tes jetons sont encore en jeu.");
      return;
    }

    // Plus dans l'assistance : aucun état ne viendra plus, il faut effacer
    // celui-ci sinon la table resterait affichable après le départ.
    usePoker.getState().clear();
    navigate({ name: "salon", game: "poker" });
  }

  const libres = freeSeats(view);
  const ancre = pokerAnchorSeat(view, suivi);

  return (
    <div className="space-y-4 pb-56 sm:pb-4">
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
          {formatCoins(view.pendingConfig.bigBlind)} dès la main suivante.
        </p>
      )}

      <PokerTable
        view={view}
        sitting={sitting}
        anchor={ancre}
        followed={suivi}
        onSit={!assis && libres.length > 0 ? (seat) => void sAsseoir(seat) : undefined}
        onFollow={assis ? undefined : (userId) => void suivre(userId)}
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
          <EnAttente view={view} moi={moi} onMontrer={() => void montrer()} />
        )}
      </section>

      {assis && moi ? (
        <MaPlace
          view={view}
          moi={moi}
          pending={pending}
          onRecave={(montant) => void recaver(montant)}
          onPause={(pause) => void basculerPause(pause)}
        />
      ) : (
        <Suivi
          view={view}
          suivi={suivi}
          pending={pending}
          onSuivre={(userId) => void suivre(userId)}
        />
      )}

      {view.isHost && <Blindes view={view} onRegler={(petite) => void reglerBlindes(petite)} />}

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

function EnAttente({
  view,
  moi,
  onMontrer,
}: {
  view: PokerView;
  moi: PokerSeatView | null;
  onMontrer: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-center">
      <p className="w-full text-sm text-cream-dim">
        {view.timerKind === "start"
          ? "La main va commencer."
          : view.timerKind === "street"
            ? "Lecture du tableau avant la reprise des mises."
          : moi?.status === "folded"
          ? "Tu es couché sur ce coup."
          : view.phase === "waiting"
            ? "En attente d'un deuxième joueur."
            : view.phase === "payout"
              ? "Le coup est terminé. La prochaine main arrive."
              : "Au tour d'un autre joueur."}
      </p>
      {view.canReveal && !moi?.revealed && (
        <Button variant="outline" onClick={onMontrer} className="min-h-11">
          <Eye className="size-4" aria-hidden />
          Montrer mes cartes
        </Button>
      )}
    </div>
  );
}

function MaPlace({
  view,
  moi,
  pending,
  onRecave,
  onPause,
}: {
  view: PokerView;
  moi: PokerSeatView;
  pending: string | null;
  onRecave: (montant: number) => void;
  onPause: (pause: boolean) => void;
}) {
  const min = view.buyInRange?.min ?? 0;
  const max = view.buyInRange?.max;
  const [montant, setMontant] = useState(min);

  useEffect(() => setMontant(min), [min, max]);

  return (
    <section className="panel grid gap-4 p-4 sm:grid-cols-2" aria-labelledby="ma-place-poker">
      <div className="min-w-0">
        <h2 id="ma-place-poker" className="font-display text-sm font-bold text-cream">
          Ma place
        </h2>
        <p className="mt-1 text-sm text-cream-dim">
          Tapis : <span className="tabular text-brass">{formatCoins(moi.stack)}</span>
        </p>
        <Button
          variant="outline"
          loading={pending === "sitout"}
          disabled={pending !== null}
          onClick={() => onPause(!moi.sittingOut)}
          className="mt-3 min-h-11 w-full sm:w-auto"
        >
          {moi.sittingOut ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
          {moi.sittingOut ? "Reprendre à la prochaine main" : "Mettre en pause"}
        </Button>
      </div>

      <div className="min-w-0">
        <label htmlFor="poker-rebuy" className="text-sm font-medium text-cream">
          Montant de la recave
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="poker-rebuy"
            aria-label="Montant de la recave"
            type="number"
            inputMode="numeric"
            min={min || 1}
            max={max ?? undefined}
            step={view.config.smallBlind}
            value={montant}
            disabled={pending !== null || !view.buyInRange}
            onChange={(event) => setMontant(Number(event.target.value))}
            className="tabular h-11 min-w-0 flex-1 rounded-xl border border-line bg-felt-deep px-3 text-sm text-cream outline-none focus:border-brass/70 disabled:opacity-50"
          />
          <Button
            variant="outline"
            loading={pending === "rebuy"}
            disabled={
              pending !== null ||
              !view.buyInRange ||
              montant < min ||
              (max !== null && max !== undefined && montant > max)
            }
            onClick={() => onRecave(montant)}
            className="min-h-11"
          >
            <Plus className="size-4" aria-hidden />
            Recaver
          </Button>
        </div>
        <p className="mt-2 text-xs text-cream-faint">
          {view.buyInRange
            ? `Disponible entre les mains, jusqu'à ${max == null ? "la limite de ton solde" : formatCoins(max)}.`
            : "La recave s'ouvre pendant le récapitulatif entre deux mains."}
        </p>
      </div>
    </section>
  );
}

function Suivi({
  view,
  suivi,
  pending,
  onSuivre,
}: {
  view: PokerView;
  suivi: string | null;
  pending: string | null;
  onSuivre: (userId: string | null) => void;
}) {
  return (
    <section className="panel p-4" aria-labelledby="suivi-poker">
      <h2 id="suivi-poker" className="font-display text-sm font-bold text-cream">
        Suivre un joueur
      </h2>
      <p className="mt-1 text-sm text-cream-dim">
        La table pivote depuis sa place. Ses cartes restent cachées jusqu'au récapitulatif.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {view.seats.map((seat) => (
          <Button
            key={seat.userId}
            variant="outline"
            disabled={pending !== null}
            aria-pressed={suivi === seat.userId}
            aria-label={suivi === seat.userId ? `Ne plus suivre ${seat.pseudo}` : `Suivre ${seat.pseudo}`}
            onClick={() => onSuivre(suivi === seat.userId ? null : seat.userId)}
            className="min-h-11"
          >
            <Eye className="size-4" aria-hidden />
            {seat.pseudo}
          </Button>
        ))}
      </div>
    </section>
  );
}

function Blindes({ view, onRegler }: { view: PokerView; onRegler: (petite: number) => void }) {
  const [petite, setPetite] = useState(view.pendingConfig?.smallBlind ?? view.config.smallBlind);

  useEffect(() => {
    setPetite(view.pendingConfig?.smallBlind ?? view.config.smallBlind);
  }, [view.config.smallBlind, view.pendingConfig?.smallBlind]);

  return (
    <section className="panel p-4" aria-labelledby="blindes-poker">
      <h2 id="blindes-poker" className="font-display text-sm font-bold text-cream">
        Régler les blindes
      </h2>
      <p className="mt-1 text-sm text-cream-dim">
        La grosse blinde vaut toujours le double. Un changement en cours de coup attend la main suivante.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1 sm:max-w-xs">
          <label htmlFor="poker-small-blind" className="text-xs text-cream-faint">
            Petite blinde
          </label>
          <input
            id="poker-small-blind"
            type="number"
            inputMode="numeric"
            min={5}
            step={5}
            value={petite}
            onChange={(event) => setPetite(Number(event.target.value))}
            className="tabular mt-1 h-11 w-full rounded-xl border border-line bg-felt-deep px-3 text-sm text-cream outline-none focus:border-brass/70"
          />
        </div>
        <Plaque tone="neutre">GB {formatCoins(petite * 2)}</Plaque>
        <Button variant="outline" onClick={() => onRegler(petite)} className="min-h-11">
          Appliquer
        </Button>
      </div>
    </section>
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
