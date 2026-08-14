import {
  formatCoins,
  formatMotusShare,
  getGame,
  isValidStake,
  MOTUS_MAX_ATTEMPTS,
  MOTUS_MULTIPLIERS,
  motusReward,
  stakeSuggestions,
  type CurrentUser,
  type MotusView,
} from "@maxoujeux/shared";
import { ArrowLeft, CircleCheck, CircleHelp, Loader2, Share2, Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Countdown } from "@/components/Countdown";
import { GameArtefact } from "@/components/GameArtefact";
import { Lien } from "@/components/Lien";
import { Modal } from "@/components/Modal";
import { Plaque } from "@/components/Plaque";
import { StakePicker } from "@/components/StakePicker";
import { ChronoMotus } from "@/components/games/ChronoMotus";
import { MotusBoard } from "@/components/games/MotusBoard";
import { MotusKeyboard } from "@/components/games/MotusKeyboard";
import { ExploitsMotusDuJour } from "@/components/stats/ClassementDuJour";
import { marquerResultat } from "@/lib/ambiance";
import { cn } from "@/lib/cn";
import { useMotus } from "@/lib/motus";
import { playSound } from "@/lib/sounds";
import {
  appendMotusLetter,
  eraseMotusLetter,
  motusCommandForKey,
} from "@/lib/motus-input";
import { request, useRealtime, watchMotus } from "@/lib/socket";
import { shareText } from "@/lib/share";
import { pushToast } from "@/lib/toast";

export function MotusPage({ user }: { user: CurrentUser }) {
  const view = useMotus((state) => state.view);
  const status = useRealtime((state) => state.status);

  useEffect(() => watchMotus(), []);

  if (!view) {
    return (
      <div className="grid place-items-center py-24">
        {status === "connected" ? (
          <p className="text-sm text-cream-dim">Le mot du créneau est indisponible.</p>
        ) : (
          <Loader2 className="size-6 animate-spin text-game-motus" aria-label="Chargement" />
        )}
      </div>
    );
  }

  return <MotusContent user={user} view={view} />;
}

/**
 * Le son de la grille : une carte à chaque ligne validée, le verdict à la fin.
 *
 * Le nombre de propositions sert de repère plutôt qu'un drapeau : c'est la seule
 * grandeur qui ne bouge qu'aux moments qui comptent. La version de la tentative
 * change aussi à l'abandon, où il n'y a pas de nouvelle ligne à annoncer.
 */
function useSonDeLaGrille(view: MotusView): void {
  const lignes = useRef(view.guesses.length);
  const termine = useRef(view.status === "won" || view.status === "lost");

  useEffect(() => {
    if (view.guesses.length > lignes.current) playSound("carte");
    lignes.current = view.guesses.length;

    const fini = view.status === "won" || view.status === "lost";
    if (fini && !termine.current) {
      // Le net et non le versement : trouver au sixième essai rend exactement la
      // mise, ce qui n'est ni un gain ni une perte et ne mérite aucun des deux
      // sons.
      marquerResultat(view.net);
    }
    termine.current = fini;
  }, [view.guesses.length, view.status, view.net]);
}

function MotusContent({ user, view }: { user: CurrentUser; view: MotusView }) {
  const pending = useMotus((state) => state.pending);
  const markPending = useMotus((state) => state.markPending);
  const clearPending = useMotus((state) => state.clearPending);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  useEffect(() => {
    setDraft("");
    setError(undefined);
  }, [view.slotStart, view.version]);

  async function commencer(stake: number) {
    markPending("start");
    setError(undefined);
    const reply = await request<null>((socket, ack) => socket.emit("motus:start", { stake }, ack));
    if (!reply.ok) {
      clearPending();
      setError(reply.message);
    }
  }

  async function proposer() {
    if (draft.length !== view.length || pending) return;
    markPending("guess");
    setError(undefined);
    const reply = await request<null>((socket, ack) =>
      socket.emit("motus:guess", { guess: draft, version: view.version }, ack),
    );
    if (!reply.ok) {
      clearPending();
      setError(reply.message);
    }
  }

  function saisirLettre(letter: string) {
    setDraft((current) => appendMotusLetter(current, letter, view.length));
    setError(undefined);
  }

  function effacerLettre() {
    setDraft((current) => eraseMotusLetter(current));
    setError(undefined);
  }

  async function abandonner() {
    markPending("abandon");
    setError(undefined);
    const reply = await request<null>((socket, ack) => socket.emit("motus:abandon", ack));
    if (!reply.ok) {
      clearPending();
      setError(reply.message);
      return;
    }
    setConfirmAbandon(false);
  }

  const playing = view.status === "playing";
  const finished = view.status === "won" || view.status === "lost";
  /**
   * Mise choisie pour la prochaine partie.
   *
   * Initialisée sur celle annoncée par le serveur : le minimum tant qu'aucune
   * partie n'est engagée, celle de la tentative en cours sinon — ce qui la
   * reconduit naturellement après un résultat.
   */
  const [mise, setMise] = useState(view.stake);
  const miseValide = isValidStake("motus", mise);
  const canAfford = miseValide && user.balance >= mise;

  useSonDeLaGrille(view);

  useEffect(() => {
    if (!playing || pending || confirmAbandon) return;

    function onKeyDown(event: KeyboardEvent) {
      // Entrée sur une touche ciblée doit conserver le clic natif de cette touche.
      if (event.key === "Enter" && event.target instanceof HTMLButtonElement) return;

      const command = motusCommandForKey(
        event.key,
        event.ctrlKey || event.altKey || event.metaKey,
      );
      if (!command) return;
      event.preventDefault();

      if (command.type === "letter") saisirLettre(command.letter);
      else if (command.type === "erase") effacerLettre();
      else void proposer();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmAbandon, draft, pending, playing, view.length, view.version]);

  return (
    <div className="space-y-5 pb-8">
      <div className="flex items-center justify-between gap-3">
        <Lien
          to={{ name: "lobby" }}
          className="-my-2 inline-flex min-h-11 items-center gap-1.5 py-2 text-sm text-cream-dim transition-colors hover:text-cream"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Le lobby
        </Lien>
        {playing && (
          <Button variant="ghost" onClick={() => setConfirmAbandon(true)} className="text-xs">
            Abandonner
          </Button>
        )}
      </div>

      <header className="panel relative overflow-hidden p-5 sm:p-7">
        <span className="absolute inset-x-0 top-0 h-0.5 bg-game-motus" aria-hidden />
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="w-16 shrink-0 sm:w-24" aria-hidden>
            <GameArtefact code="motus" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-black text-cream sm:text-3xl">Motus</h1>
              <Plaque tone={playing ? "actif" : finished ? "gain" : "attente"}>
                {playing ? `${view.attemptsLeft} essais` : finished ? "Terminé" : "Disponible"}
              </Plaque>
            </div>
            <p className="mt-1 text-sm text-cream-dim">
              {view.length} lettres, aucun indice. Chaque couleur rapproche du mot.
            </p>
          </div>
        </div>
      </header>

      {view.status === "available" ? (
        <BeforeGame
          view={view}
          balance={user.balance}
          stake={mise}
          onStakeChange={setMise}
          canAfford={canAfford}
          pending={pending !== null}
          error={error}
          onStart={() => void commencer(mise)}
        />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <section className="panel min-w-0 p-4 sm:p-6" aria-labelledby="motus-grid-title">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 id="motus-grid-title" className="font-display text-lg font-bold text-cream">
                Le mot du créneau
              </h2>
              <span className="tabular text-xs text-cream-faint">
                {view.guesses.length} / {MOTUS_MAX_ATTEMPTS}
              </span>
            </div>

            <MotusBoard view={view} draft={draft} pending={pending === "guess"} />

            {playing && (
              <div className="mx-auto mt-5 max-w-xl">
                <MotusKeyboard
                  guesses={view.guesses}
                  disabled={pending !== null}
                  canSubmit={draft.length === view.length}
                  onLetter={saisirLettre}
                  onErase={effacerLettre}
                  onSubmit={() => void proposer()}
                />
                {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
              </div>
            )}

            {finished && (
              <Result
                view={view}
                pending={pending !== null}
                error={error}
                canAfford={canAfford}
                onStart={() => void commencer(mise)}
              />
            )}
          </section>

          <aside className="space-y-4">
            <ChronoMotus view={view} />
            <Legend />
            <RewardScale stake={view.stake} compact used={view.guesses.length} />
          </aside>
        </div>
      )}

      {/* Après la grille et dans les deux états : celui qui n'a pas encore
          commencé doit voir ce qu'il y a à battre aujourd'hui. */}
      <ExploitsMotusDuJour meId={user.id} />

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {view.status === "won"
          ? `Mot trouvé en ${view.guesses.length} essais. Gain ${view.payout} MaxouCoin.`
          : view.status === "lost"
            ? "Tentative terminée sans gain."
            : playing
              ? `${view.attemptsLeft} essais restants.`
              : "Motus prêt à commencer."}
      </p>

      <Modal
        open={confirmAbandon}
        onClose={() => setConfirmAbandon(false)}
        title="Abandonner ce mot ?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmAbandon(false)}>Continuer</Button>
            <Button variant="outline" onClick={abandonner} loading={pending === "abandon"} className="text-danger">
              Abandonner définitivement
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-cream-dim">
          La mise ne sera pas remboursée et ce créneau ne pourra plus être rejoué. Fermer simplement la page suspend la tentative.
        </p>
      </Modal>
    </div>
  );
}

function BeforeGame({
  balance,
  stake,
  onStakeChange,
  canAfford,
  pending,
  error,
  onStart,
}: {
  view: MotusView;
  balance: number;
  stake: number;
  onStakeChange: (value: number) => void;
  canAfford: boolean;
  pending: boolean;
  error?: string;
  onStart: () => void;
}) {
  const wager = getGame("motus")?.wager;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="panel p-5 sm:p-7">
        <p className="max-w-2xl text-base leading-relaxed text-cream-dim">
          Trouve un mot français en six propositions. Vert : bonne lettre, bonne place. Jaune : bonne lettre, autre place. Gris : lettre absente.
        </p>
        <Legend className="mt-6" />

        {/* Le prix fixe a disparu : le barème verse un multiple de ce que le
            joueur engage, il faut donc le lui faire choisir avant de commencer. */}
        <div className="mt-7 border-t border-line pt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-cream-faint">Ta mise</p>
          <StakePicker
            options={stakeSuggestions("motus")}
            value={stake}
            onChange={onStakeChange}
            min={wager?.min ?? 10}
            step={wager?.step ?? 10}
            balance={balance}
            disabled={pending}
            className="mt-3 max-w-md"
          />
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <Button onClick={onStart} loading={pending} disabled={!canAfford} className="w-full sm:w-auto sm:text-base">
            Commencer pour {formatCoins(stake)}
          </Button>
          {!canAfford && <p className="mt-2 text-sm text-danger">Cette mise dépasse ton solde.</p>}
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
          <p className="mt-3 text-xs text-cream-faint">Une partie commencée reste disponible après la fin du créneau.</p>
        </div>
      </section>
      <RewardScale stake={stake} />
    </div>
  );
}

function Legend({ className }: { className?: string }) {
  return (
    <div className={cn("panel-plat p-4", className)}>
      <h2 className="font-display text-sm font-bold text-cream">Lire les couleurs</h2>
      <ul className="mt-3 grid gap-2 text-xs text-cream-dim sm:grid-cols-3 lg:grid-cols-1">
        <li className="flex items-center gap-2"><span className="size-4 rounded bg-win" aria-hidden /> Bien placée</li>
        <li className="flex items-center gap-2"><span className="size-4 rounded bg-game-motus" aria-hidden /> Présente ailleurs</li>
        <li className="flex items-center gap-2"><span className="size-4 rounded bg-felt-high ring-1 ring-line-strong" aria-hidden /> Absente</li>
      </ul>
    </div>
  );
}

/**
 * Le barème, exprimé dans la mise réellement engagée.
 *
 * Afficher les multiplicateurs nus — « × 4,5 » — obligerait le joueur à faire le
 * calcul lui-même à chaque changement de mise. On montre donc les montants, avec
 * le multiplicateur en second plan pour que la dégressivité reste lisible.
 */
function RewardScale({
  stake,
  compact = false,
  used = 0,
}: {
  stake: number;
  compact?: boolean;
  used?: number;
}) {
  const lisible = isValidStake("motus", stake);

  return (
    <section className="panel p-4 sm:p-5" aria-labelledby={compact ? "reward-title-side" : "reward-title"}>
      <h2 id={compact ? "reward-title-side" : "reward-title"} className="flex items-center gap-2 font-display text-sm font-bold text-cream">
        <Trophy className="size-4 text-brass" aria-hidden /> Barème
      </h2>
      <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-2">
        {MOTUS_MULTIPLIERS.map((multiplier, index) => (
          <li key={multiplier} className={cn("flex justify-between gap-3", used > index && "opacity-45")}>
            <span className="text-cream-faint">Essai {index + 1}</span>
            <span className="tabular text-brass-bright">
              {lisible
                ? formatCoins(motusReward(index + 1, true, stake))
                : `× ${multiplier.toLocaleString("fr-FR")}`}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[0.65rem] leading-snug text-cream-faint">
        Trouver au sixième essai rend exactement la mise.
      </p>
    </section>
  );
}

function Result({
  view,
  pending,
  error,
  canAfford,
  onStart,
}: {
  view: MotusView;
  pending: boolean;
  error?: string;
  canAfford: boolean;
  onStart: () => void;
}) {
  const won = view.status === "won";
  const [sharing, setSharing] = useState(false);

  async function partager() {
    setSharing(true);
    try {
      const text = formatMotusShare(view, window.location.origin);
      const outcome = await shareText("MaxouJeux Motus", text);
      if (outcome === "copied") pushToast("info", "Résultat copié");
    } catch {
      pushToast("erreur", "Impossible de partager le résultat. Réessaie.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-xl border-t border-line pt-5 text-center">
      {won ? <CircleCheck className="mx-auto size-8 text-win" aria-hidden /> : <CircleHelp className="mx-auto size-8 text-cream-faint" aria-hidden />}
      <h2 className="mt-2 font-display text-xl font-bold text-cream">
        {won ? "Mot trouvé" : view.endReason === "abandoned" ? "Tentative abandonnée" : "Six essais utilisés"}
      </h2>
      <div className="mt-4 flex justify-center gap-8">
        <div><p className="text-xs text-cream-faint">Gain brut</p><p className="tabular mt-1 text-xl font-bold text-brass-bright">{formatCoins(view.payout)}</p></div>
        <div><p className="text-xs text-cream-faint">Bilan net</p><p className={cn("tabular mt-1 text-xl font-bold", view.net > 0 ? "text-win" : "text-danger")}>{view.net > 0 ? "+" : ""}{formatCoins(view.net)}</p></div>
      </div>
      {!view.canStartCurrent && (
        <p className="mt-5 text-sm text-cream-dim">Prochain mot dans <Countdown to={view.nextSlotAt} className="text-game-motus" fallback="quelques instants" />.</p>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {view.canStartCurrent && (
          // La mise du mot précédent est reconduite : c'est ce que le joueur
          // attend en enchaînant, et il peut la changer depuis l'écran d'accueil.
          <Button onClick={onStart} loading={pending} disabled={!canAfford}>
            Jouer le mot actuel pour {formatCoins(view.stake)}
          </Button>
        )}
        <Button variant="outline" onClick={partager} loading={sharing}>
          <Share2 className="size-4" aria-hidden />
          Partager le résultat
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-3 text-xs text-cream-faint">Le mot secret reste caché, même après une défaite.</p>
    </div>
  );
}
