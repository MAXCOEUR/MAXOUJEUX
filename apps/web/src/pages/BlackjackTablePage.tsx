import {
  BLACKJACK_BET_MIN,
  BLACKJACK_IDLE_ROUNDS_MAX,
  formatCoins,
  formatCoinsDelta,
  type BlackjackAction,
  type BlackjackSeatView,
  type BlackjackView,
  type CurrentUser,
} from "@maxoujeux/shared";
import {
  ArrowLeft,
  ChevronsUp,
  Eye,
  Hand,
  LogOut,
  Plus,
  RotateCcw,
  ShieldCheck,
  Split,
  Undo2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { BlackjackTable } from "@/components/games/BlackjackTable";
import { ChipRack, ChipStack } from "@/components/games/casino/Chips";
import { phaseLabel } from "@/lib/blackjack-ui";
import { chipStack, type ChipValue } from "@/lib/chips";
import { useBlackjack } from "@/lib/blackjack";
import { cn } from "@/lib/cn";
import { navigate } from "@/lib/route";
import { request } from "@/lib/socket";
import { pushToast } from "@/lib/toast";

/**
 * Il n'y a plus de mise maximale : le plafond est le solde du joueur, et rien
 * d'autre. Le minimum et le pas viennent du contrat partagé.
 */
const MISE_MIN = BLACKJACK_BET_MIN;

const ACTIONS: Record<BlackjackAction, { label: string; aide: string; icon: typeof Plus }> = {
  hit: { label: "Carte", aide: "Tirer une carte de plus", icon: Plus },
  stand: { label: "Rester", aide: "Garder ce total", icon: Hand },
  double: { label: "Doubler", aide: "Doubler la mise, une seule carte", icon: ChevronsUp },
  split: { label: "Séparer", aide: "Jouer deux mains", icon: Split },
};

export function BlackjackTablePage({ user, view }: { user: CurrentUser; view: BlackjackView }) {
  const pending = useBlackjack((state) => state.pending);
  const markPending = useBlackjack((state) => state.markPending);
  const clearPending = useBlackjack((state) => state.clearPending);

  /**
   * Les jetons posés, dans l'ordre où le joueur les a poussés — et non un
   * simple montant. Deux raisons : la case de mise montre alors les jetons
   * qu'il a réellement choisis, et le retrait du dernier jeton devient une
   * simple dépile, là où un montant obligerait à deviner ce qu'il faut retirer.
   */
  const [poses, setPoses] = useState<ChipValue[]>([]);
  const [derniereMise, setDerniereMise] = useState<number | null>(null);

  /** Place demandée, réponse du serveur en attente. */
  const [sitting, setSitting] = useState<number | null>(null);

  /** Dialogue de sortie ouvert par la flèche de retour. */
  const [sortie, setSortie] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const mise = poses.reduce((somme, jeton) => somme + jeton, 0);
  const mine = view.seats.find((seat) => seat.seat === view.you) ?? null;
  const spectateur = view.you === null;
  const peutMiser = (view.phase === "idle" || view.phase === "betting") && mine !== null && !mine.participating;
  const plafond = user.balance;
  const mainCourante = view.turn?.seat === view.you ? view.turn.handIndex : null;

  async function intention(nom: string, envoi: Parameters<typeof request<null>>[0]): Promise<boolean> {
    markPending(nom);
    const reponse = await request<null>(envoi);
    if (!reponse.ok) {
      clearPending();
      pushToast("erreur", reponse.message);
      return false;
    }
    return true;
  }

  async function miser() {
    const montant = mise;
    const ok = await intention("bet", (socket, ack) =>
      socket.emit("blackjack:bet", { tableId: view.id, amount: montant, version: view.version }, ack),
    );
    if (!ok) return;
    // La case se vide seulement une fois la mise acceptée : la vider avant
    // laisserait le joueur devant une case déserte si le serveur refuse.
    setPoses([]);
    setDerniereMise(montant);
  }

  function assurer(prendre: boolean) {
    void intention("insurance", (socket, ack) =>
      socket.emit("blackjack:insurance", { tableId: view.id, take: prendre, version: view.version }, ack),
    );
  }

  async function sasseoir(seat: number) {
    setSitting(seat);
    const reponse = await request<null>((socket, ack) =>
      socket.emit("blackjack:sit", { tableId: view.id, seat }, ack),
    );
    setSitting(null);
    // Une place prise à la seconde près est le cas normal, pas une anomalie :
    // le message dit laquelle a échoué, et le tapis montre déjà les autres.
    if (!reponse.ok) pushToast("erreur", reponse.message);
  }

  function seLever() {
    void intention("stand", (socket, ack) => socket.emit("blackjack:stand", { tableId: view.id }, ack));
  }

  function jouer(action: BlackjackAction) {
    if (mainCourante === null) return;
    void intention(action, (socket, ack) =>
      socket.emit(
        "blackjack:act",
        { tableId: view.id, handIndex: mainCourante, action, version: view.version },
        ack,
      ),
    );
  }

  const engage = (mine?.participating ?? false) && view.phase !== "idle" && view.phase !== "result";

  async function quitter() {
    setLeaving(true);
    const reponse = await request<null>((socket, ack) => socket.emit("match:leave", { tableId: view.id }, ack));
    setLeaving(false);
    if (!reponse.ok && reponse.code !== "TABLE_GONE") {
      pushToast("erreur", reponse.message);
      return;
    }
    setSortie(false);
    useBlackjack.getState().clear();
    navigate({ name: "salon", game: "blackjack" });
  }

  /** Départ demandé depuis l'en-tête, sans passer par le dialogue de sortie. */
  function quitterDepuisEntete() {
    if (engage && !window.confirm("Ta main restera automatiquement. Quitter la table ?")) return;
    void quitter();
  }

  /**
   * Aller voir ailleurs sans rendre sa place.
   *
   * L'état n'est **pas** vidé : c'est lui qui alimente le bandeau de reprise, et
   * le vider ferait disparaître le seul rappel que le joueur est encore engagé.
   */
  function garderMaPlace() {
    setSortie(false);
    navigate({ name: "salon", game: "blackjack" });
  }

  const annonce = useMemo(() => {
    if (view.you === null) {
      const libres = view.maxSeats - view.seats.length;
      return libres > 0
        ? `Tu regardes la table. ${libres} place${libres > 1 ? "s" : ""} libre${libres > 1 ? "s" : ""}.`
        : "Tu regardes la table. Toutes les places sont prises.";
    }
    if (view.phase === "result" && mine?.roundNet !== null && mine !== null) {
      return mine.roundNet > 0
        ? `Manche gagnée, ${formatCoinsDelta(mine.roundNet)}.`
        : mine.roundNet < 0
          ? `Manche perdue, ${formatCoinsDelta(mine.roundNet)}.`
          : "Égalité, ta mise est rendue.";
    }
    if (view.turn?.seat === view.you) {
      const total = mine?.hands.length ?? 1;
      return total > 1
        ? `À toi de jouer, main ${(view.turn.handIndex ?? 0) + 1} sur ${total}.`
        : "À toi de jouer.";
    }
    const actif = view.turn ? view.seats.find((seat) => seat.seat === view.turn?.seat) : null;
    return actif ? `Au tour de ${actif.pseudo}.` : phaseLabel(view.phase, false);
  }, [view, mine]);

  return (
    <div className="space-y-4 pb-40 sm:pb-4">
      <div className="flex items-center justify-between gap-3">
        {/* Pas un lien : partir de la page ne rend ni la place ni la mise, et
            découvrir la chose après coup était incompréhensible. La flèche pose
            donc la question au lieu d'y répondre à la place du joueur. */}
        <button
          type="button"
          onClick={() => setSortie(true)}
          className="inline-flex items-center gap-1.5 text-sm text-cream-dim transition-colors hover:text-cream"
        >
          <ArrowLeft className="size-4" aria-hidden /> Blackjack
        </button>
        <div className="flex items-center gap-1">
          {!spectateur && (
            <Button
              variant="ghost"
              onClick={seLever}
              loading={pending === "stand"}
              disabled={pending !== null || mine?.standingAfterRound}
              className="text-xs"
            >
              <LogOut className="size-3.5" aria-hidden />
              {mine?.standingAfterRound ? "Tu te lèves après" : "Se lever"}
            </Button>
          )}
          <Button variant="ghost" onClick={quitterDepuisEntete} loading={leaving} className="text-xs">
            Quitter la table
          </Button>
        </div>
      </div>

      <BlackjackTable view={view} onSit={(seat) => void sasseoir(seat)} sitting={sitting} />

      {view.phase === "result" && mine && mine.roundNet !== null && <Verdict seat={mine} />}

      {/* Barre d'actions. Ancrée en bas de l'écran sur téléphone : le pouce y
          est déjà, et une barre qui défile hors de vue au milieu d'un tour de
          trente secondes est une main perdue. */}
      <section
        aria-label="Tes actions"
        className={cn(
          "panel fixed inset-x-0 bottom-0 z-20 rounded-b-none p-3",
          "pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
          "sm:static sm:rounded-panel sm:p-4 sm:pb-4",
        )}
      >
        {spectateur ? (
          <SpectatorPanel complete={view.seats.length >= view.maxSeats} />
        ) : peutMiser ? (
          <BetPanel
            poses={poses}
            mise={mise}
            plafond={plafond}
            balance={user.balance}
            derniereMise={derniereMise}
            occupe={pending !== null}
            enCours={pending === "bet"}
            onPoser={(jeton) => setPoses((liste) => [...liste, jeton])}
            onRetirer={() => setPoses((liste) => liste.slice(0, -1))}
            onEffacer={() => setPoses([])}
            onRepeter={() => derniereMise !== null && setPoses(chipStack(derniereMise, 12))}
            onMiser={() => void miser()}
          />
        ) : view.phase === "insurance" && view.insuranceCost !== null ? (
          <div className="space-y-2">
            <p className="text-center text-xs text-cream-dim">
              Le croupier montre un as. L&apos;assurance paie 2 pour 1 s&apos;il a un blackjack.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button onClick={() => assurer(true)} loading={pending === "insurance"}>
                <ShieldCheck className="size-4" aria-hidden /> Assurer {formatCoins(view.insuranceCost)}
              </Button>
              <Button variant="outline" onClick={() => assurer(false)} disabled={pending !== null}>
                Sans assurance
              </Button>
            </div>
          </div>
        ) : view.allowedActions.length > 0 ? (
          <ActionPanel
            actions={view.allowedActions}
            hands={mine?.hands.length ?? 1}
            handIndex={mainCourante ?? 0}
            wager={mine?.hands[mainCourante ?? 0]?.wager ?? 0}
            pending={pending}
            onJouer={jouer}
          />
        ) : (
          <p className="text-center text-sm text-cream-dim">
            {mine?.participating
              ? "Ta mise est engagée. Suis la donne autour de la table."
              : "Tu observes cette manche. Tu pourras miser à la suivante."}
          </p>
        )}
      </section>

      <LeaveDialog
        open={sortie}
        onClose={() => setSortie(false)}
        spectateur={spectateur}
        engage={engage}
        wager={mine?.totalWager ?? 0}
        leaving={leaving}
        onGarder={garderMaPlace}
        onQuitter={() => void quitter()}
      />

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {annonce}
      </p>
    </div>
  );
}

/**
 * Sortie de la page — deux issues, jamais la même.
 *
 * Le tapis ne se ferme pas quand on tourne le dos : la place, la mise et le
 * verrou d'activité restent acquis jusqu'à un vrai départ. Un simple lien de
 * retour laissait donc le joueur engagé sans qu'il le sache, et le salon lui
 * refusait ensuite toute autre table sans qu'il comprenne pourquoi.
 *
 * On nomme donc les deux issues au moment du geste, plutôt que d'en deviner une.
 */
function LeaveDialog({
  open,
  onClose,
  spectateur,
  engage,
  wager,
  leaving,
  onGarder,
  onQuitter,
}: {
  open: boolean;
  onClose: () => void;
  spectateur: boolean;
  engage: boolean;
  wager: number;
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
            {spectateur ? "Rester à la table" : "Garder ma place"}
          </Button>
          <Button variant="outline" onClick={onQuitter} loading={leaving} className="flex-1">
            <LogOut className="size-4" aria-hidden /> Quitter la table
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-cream">
          {spectateur
            ? "Tu peux aller au salon sans cesser de suivre cette table : un bandeau te ramènera ici en un clic."
            : "Tu peux aller au salon sans rendre ta place : un bandeau te ramènera ici en un clic."}
        </p>

        {engage && (
          <p className="rounded-xl border border-brass/40 bg-brass/10 px-4 py-3 text-cream">
            {formatCoins(wager)} sont engagés sur cette manche. Ils restent en jeu dans les deux
            cas, et ta main restera automatiquement si ton tour expire sans toi.
          </p>
        )}

        <p className="text-cream-dim">
          {spectateur
            ? "Quitter la table libère ton audience et te rend l'accès aux autres jeux."
            : `Quitter la table rend ta place aux autres joueurs. Rester sans miser pendant ${BLACKJACK_IDLE_ROUNDS_MAX} manches te lève de toi-même.`}
        </p>

        <p className="text-xs text-cream-faint">
          Tant que tu es à cette table, spectateur compris, tu ne peux pas rejoindre un autre jeu.
        </p>
      </div>
    </Modal>
  );
}

/**
 * Ce que voit quelqu'un qui regarde.
 *
 * Le geste attendu est sur le tapis, pas ici : la barre le nomme, et les
 * chaises libres portent le bouton. Dupliquer une liste de places dans la barre
 * donnerait deux endroits pour le même geste, et le doute sur lequel fait foi.
 */
function SpectatorPanel({ complete }: { complete: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2.5 text-center">
      <Eye className="size-4 shrink-0 text-cream-faint" aria-hidden />
      <p className="text-sm text-cream-dim">
        {complete ? (
          <>
            Les cinq places sont prises.{" "}
            <span className="text-cream-faint">Reste, une se libérera à la fin d&apos;une manche.</span>
          </>
        ) : (
          <>
            Tu regardes cette table.{" "}
            <span className="text-brass">Choisis une place libre</span>{" "}
            <span className="text-cream-faint">pour jouer la prochaine manche.</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Case de mise.
 *
 * Le joueur pousse des jetons dans sa case comme à une vraie table, plutôt que
 * de taper un nombre : c'est plus rapide au doigt, ça évite d'ouvrir un clavier
 * par-dessus le tapis, et la mise se lit à la pile sans être relue.
 *
 * « Répéter » n'est pas un raccourci de confort : entre deux manches il ne
 * reste que vingt secondes, et recomposer la même mise jeton par jeton à chaque
 * fois est le meilleur moyen de rater la donne.
 */
function BetPanel({
  poses,
  mise,
  plafond,
  balance,
  derniereMise,
  occupe,
  enCours,
  onPoser,
  onRetirer,
  onEffacer,
  onRepeter,
  onMiser,
}: {
  poses: ChipValue[];
  mise: number;
  plafond: number;
  balance: number;
  derniereMise: number | null;
  occupe: boolean;
  enCours: boolean;
  onPoser: (jeton: ChipValue) => void;
  onRetirer: () => void;
  onEffacer: () => void;
  onRepeter: () => void;
  onMiser: () => void;
}) {
  const valide = mise >= MISE_MIN && mise <= plafond;

  return (
    <div className="space-y-3 [--jeton-l:1.6rem]">
      <div className="flex items-center justify-center gap-4">
        {/* La case de mise : même cercle pointillé que sur le tapis, pour que le
            lien entre ce qu'on compose ici et ce qui apparaît là-haut soit
            immédiat. */}
        <span
          className={cn(
            "grid aspect-square w-20 shrink-0 place-items-end justify-items-center rounded-full border border-dashed pb-1 transition-colors",
            mise > 0 ? "border-brass/70 bg-brass/5" : "border-line-strong",
          )}
        >
          {mise > 0 ? (
            <ChipStack amount={mise} values={poses.slice(-6)} />
          ) : (
            <span className="pb-6 text-[0.6rem] uppercase tracking-[0.14em] text-cream-faint">Mise</span>
          )}
        </span>

        <div className="min-w-0">
          <p className="tabular text-2xl font-black leading-none text-brass-bright">{formatCoins(mise)}</p>
          <p className="mt-1 text-xs text-cream-faint">
            {mise === 0
              ? `Pose tes jetons. Minimum ${formatCoins(MISE_MIN)}.`
              : `Solde après la mise : ${formatCoins(balance - mise)}`}
          </p>
        </div>
      </div>

      <ChipRack balance={balance} current={mise} max={plafond} disabled={occupe} onAdd={onPoser} />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" onClick={onRetirer} disabled={occupe || poses.length === 0} className="text-xs">
          <Undo2 className="size-3.5" aria-hidden /> Retirer
        </Button>
        <Button variant="ghost" onClick={onEffacer} disabled={occupe || poses.length === 0} className="text-xs">
          Tout enlever
        </Button>
        {derniereMise !== null && derniereMise <= plafond && (
          <Button variant="outline" onClick={onRepeter} disabled={occupe} className="text-xs">
            <RotateCcw className="size-3.5" aria-hidden /> Répéter {formatCoins(derniereMise)}
          </Button>
        )}
      </div>

      <Button onClick={onMiser} loading={enCours} disabled={!valide || occupe} className="w-full">
        {valide ? `Miser ${formatCoins(mise)}` : "Miser"}
      </Button>
    </div>
  );
}

/**
 * Boutons de décision.
 *
 * Quand le joueur a séparé, le titre dit sur **quelle** main il agit et pour
 * combien. Les boutons sont les mêmes pour toutes les mains : sans ce rappel,
 * rien à l'écran ne distingue une décision prise sur la première main d'une
 * décision prise sur la seconde, et c'est exactement le reproche fait à la
 * première version.
 */
function ActionPanel({
  actions,
  hands,
  handIndex,
  wager,
  pending,
  onJouer,
}: {
  actions: BlackjackAction[];
  hands: number;
  handIndex: number;
  wager: number;
  pending: string | null;
  onJouer: (action: BlackjackAction) => void;
}) {
  return (
    <div className="space-y-2.5">
      <p className="text-center text-xs">
        {hands > 1 ? (
          <span className="font-semibold text-brass-bright">
            Main {handIndex + 1} sur {hands}
          </span>
        ) : (
          <span className="font-semibold text-cream">À toi de jouer</span>
        )}
        {wager > 0 && <span className="text-cream-faint"> · {formatCoins(wager)} en jeu</span>}
      </p>

      <div className={cn("grid gap-2", actions.length > 2 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2")}>
        {actions.map((action) => {
          const item = ACTIONS[action];
          const Icon = item.icon;
          return (
            <Button
              key={action}
              variant={action === "hit" ? "primary" : "outline"}
              onClick={() => onJouer(action)}
              loading={pending === action}
              disabled={pending !== null}
              title={item.aide}
              className="min-h-12"
            >
              <Icon className="size-4" aria-hidden /> {item.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** Résultat de la manche, du point de vue du joueur. */
function Verdict({ seat }: { seat: BlackjackSeatView }) {
  const net = seat.roundNet ?? 0;
  const gagne = net > 0;
  const nul = net === 0;

  return (
    <div
      role="status"
      className={cn(
        "animate-flip-up panel flex items-center justify-center gap-3 p-3 text-center",
        gagne ? "border-brass/50" : nul ? "border-line-strong" : "border-danger/40",
      )}
    >
      <p className="font-display text-lg font-extrabold">
        {gagne ? "Manche gagnée" : nul ? "Égalité" : "Manche perdue"}
      </p>
      <p
        className={cn(
          "tabular text-lg font-black",
          gagne ? "text-win" : nul ? "text-cream-dim" : "text-danger",
        )}
      >
        {nul ? "Mise rendue" : formatCoinsDelta(net)}
      </p>
    </div>
  );
}
