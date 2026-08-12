import {
  ROULETTE_MIN_BET,
  formatCoins,
  formatCoinsDelta,
  spotKey,
  type CurrentUser,
  type RouletteSpot,
  type RouletteView,
} from "@maxoujeux/shared";
import { ArrowLeft, Eraser, LogOut, RotateCcw, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { RouletteTable } from "@/components/games/RouletteTable";
import { ChipRack } from "@/components/games/casino/Chips";
import { cn } from "@/lib/cn";
import type { ChipValue } from "@/lib/chips";
import { navigate } from "@/lib/route";
import { useRoulette } from "@/lib/roulette";
import { draftTotal } from "@/lib/roulette-ui";
import { request } from "@/lib/socket";
import { pushToast } from "@/lib/toast";

type Draft = Map<string, { spot: RouletteSpot; amount: number }>;

export function RouletteTablePage({ user, view }: { user: CurrentUser; view: RouletteView }) {
  const pending = useRoulette((state) => state.pending);
  const markPending = useRoulette((state) => state.markPending);
  const clearPending = useRoulette((state) => state.clearPending);

  /**
   * La mise en cours de composition, **côté client seulement**.
   *
   * Rien n'est débité tant que le joueur n'a pas confirmé : il pose ses jetons,
   * se ravise, recommence. C'est ce qui rend le misclic sur un tapis de
   * trente-sept cases sans conséquence, là où un débit à chaque clic ouvrirait
   * un chemin de remboursement par case.
   */
  const [draft, setDraft] = useState<Draft>(new Map());
  /**
   * Pile des jetons posés, dans l'ordre.
   *
   * Chaque entrée porte **sa valeur** et non seulement sa case : un joueur qui
   * pose un 10 puis un 100 sur le même numéro doit récupérer 100 en cliquant
   * « Retirer », pas la moyenne des deux.
   */
  const [ordre, setOrdre] = useState<{ key: string; amount: ChipValue }[]>([]);
  const [jeton, setJeton] = useState<ChipValue>(10);
  const [derniere, setDerniere] = useState<{ spot: RouletteSpot; amount: number }[] | null>(null);
  const [sortie, setSortie] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const compose = draftTotal(draft);
  const moi = view.players.find((player) => player.userId === user.id) ?? null;
  const engage = moi?.totalWager ?? 0;
  const ouvert = view.phase === "idle" || view.phase === "betting";
  // Plus aucun plafond de case ni de tour : ce qui reste à engager, c'est le
  // solde, moins ce qui est déjà composé sur le tapis.
  const restant = user.balance - compose;

  function poser(spot: RouletteSpot) {
    const key = spotKey(spot);
    const brouillon = draft.get(key)?.amount ?? 0;

    if (jeton > restant) {
      pushToast(
        "erreur",
        restant > 0
          ? `Il te reste ${formatCoins(restant)} à engager.`
          : "Tu as engagé tout ton solde pour ce tour.",
      );
      return;
    }

    setDraft((current) => {
      const next = new Map(current);
      next.set(key, { spot, amount: brouillon + jeton });
      return next;
    });
    setOrdre((current) => [...current, { key, amount: jeton }]);
  }

  function retirer() {
    const dernier = ordre.at(-1);
    if (!dernier) return;
    setOrdre((current) => current.slice(0, -1));
    setDraft((current) => {
      const next = new Map(current);
      const pose = next.get(dernier.key);
      if (!pose) return next;
      const reste = pose.amount - dernier.amount;
      if (reste > 0) next.set(dernier.key, { ...pose, amount: reste });
      else next.delete(dernier.key);
      return next;
    });
  }

  function effacer() {
    setDraft(new Map());
    setOrdre([]);
  }

  async function confirmer() {
    const bets = [...draft.values()];
    if (bets.length === 0) return;
    markPending("bet");
    const reponse = await request<null>((socket, ack) =>
      socket.emit("roulette:bet", { tableId: view.id, bets }, ack),
    );
    if (!reponse.ok) {
      clearPending();
      pushToast("erreur", reponse.message);
      return;
    }
    // Le tapis ne se vide qu'une fois la mise acceptée : le vider avant
    // laisserait le joueur devant un tapis nu si le serveur refuse.
    setDerniere(bets);
    effacer();
  }

  function reprendre() {
    markPending("clear");
    void request<null>((socket, ack) => socket.emit("roulette:clear", { tableId: view.id }, ack)).then(
      (reponse) => {
        if (!reponse.ok) {
          clearPending();
          pushToast("erreur", reponse.message);
        }
      },
    );
  }

  function rejouer() {
    if (!derniere) return;
    const next: Draft = new Map();
    for (const bet of derniere) next.set(spotKey(bet.spot), bet);
    setDraft(next);
    // Une mise rappelée compte pour une entrée par case : « Retirer » enlèvera
    // alors la case entière. Acceptable — et bien moins déroutant qu'un bouton
    // « Retirer » devenu inerte juste après un rappel.
    setOrdre([...next.values()].map((bet) => ({ key: spotKey(bet.spot), amount: bet.amount as ChipValue })));
  }

  async function quitter() {
    setLeaving(true);
    const reponse = await request<null>((socket, ack) => socket.emit("match:leave", { tableId: view.id }, ack));
    setLeaving(false);
    if (!reponse.ok && reponse.code !== "TABLE_GONE") {
      pushToast("erreur", reponse.message);
      return;
    }
    setSortie(false);
    useRoulette.getState().clear();
    navigate({ name: "salon", game: "roulette" });
  }

  /** Revenir au salon sans rendre sa place ni toucher aux mises confirmées. */
  function garderMaPlace() {
    setSortie(false);
    navigate({ name: "salon", game: "roulette" });
  }

  const annonce = useMemo(() => {
    if (view.phase === "spinning") return "Rien ne va plus, la bille tourne.";
    if (view.phase === "result" && view.result !== null) {
      const net = moi?.roundNet;
      const sortie = `Le ${view.result} est sorti.`;
      if (net === null || net === undefined) return sortie;
      return net > 0
        ? `${sortie} Tu gagnes ${formatCoinsDelta(net)}.`
        : net < 0
          ? `${sortie} Tu perds ${formatCoinsDelta(net)}.`
          : `${sortie} Tu récupères ta mise.`;
    }
    if (view.phase === "betting") return "Les mises sont ouvertes.";
    return "La table attend une première mise.";
  }, [view, moi]);

  return (
    <div className="space-y-4 pb-44 sm:pb-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setSortie(true)}
          className="inline-flex items-center gap-1.5 text-sm text-cream-dim transition-colors hover:text-cream"
        >
          <ArrowLeft className="size-4" aria-hidden /> Roulette
        </button>
        <Button variant="ghost" onClick={() => void quitter()} loading={leaving} className="text-xs">
          Quitter la table
        </Button>
      </div>

      <RouletteTable view={view} draft={draft} onPlace={poser} />

      {view.phase === "result" && moi?.roundNet !== null && moi !== null && (
        <Verdict result={view.result} net={moi.roundNet} />
      )}

      <section
        aria-label="Tes mises"
        className={cn(
          "panel fixed inset-x-0 bottom-0 z-20 rounded-b-none p-3",
          "pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
          "sm:static sm:rounded-panel sm:p-4 sm:pb-4",
        )}
      >
        {!ouvert ? (
          <p className="text-center text-sm text-cream-dim">
            {view.phase === "spinning"
              ? "Rien ne va plus. La bille est lancée."
              : "Paiement en cours. Les mises rouvrent dans un instant."}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 text-xs">
              <span className="text-cream-faint">
                Jeton choisi — clique une case pour le poser
              </span>
              {engage > 0 && (
                <span className="tabular text-cream-dim">
                  {formatCoins(engage)} déjà engagés
                </span>
              )}
              <span className="tabular text-cream-faint">
                {formatCoins(Math.max(0, restant))} disponibles
              </span>
            </div>

            <ChipRack
              balance={Math.max(0, restant)}
              current={0}
              max={Math.max(0, restant)}
              disabled={pending !== null}
              selected={jeton}
              onAdd={setJeton}
            />

            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" onClick={retirer} disabled={ordre.length === 0} className="text-xs">
                <Undo2 className="size-3.5" aria-hidden /> Retirer
              </Button>
              <Button variant="ghost" onClick={effacer} disabled={draft.size === 0} className="text-xs">
                Tout enlever
              </Button>
              {derniere && draft.size === 0 && (
                <Button variant="outline" onClick={rejouer} className="text-xs">
                  <RotateCcw className="size-3.5" aria-hidden /> Même mise
                </Button>
              )}
              {engage > 0 && (
                <Button
                  variant="ghost"
                  onClick={reprendre}
                  loading={pending === "clear"}
                  className="text-xs text-danger"
                >
                  <Eraser className="size-3.5" aria-hidden /> Reprendre mes jetons
                </Button>
              )}
            </div>

            <Button
              onClick={() => void confirmer()}
              loading={pending === "bet"}
              disabled={compose < ROULETTE_MIN_BET || pending !== null}
              className="w-full"
            >
              {compose > 0 ? `Miser ${formatCoins(compose)}` : "Pose tes jetons"}
            </Button>
          </div>
        )}
      </section>

      <LeaveDialog
        open={sortie}
        onClose={() => setSortie(false)}
        wager={engage}
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

/** Distingue un simple retour au salon d'un véritable départ de la table. */
function LeaveDialog({
  open,
  onClose,
  wager,
  leaving,
  onGarder,
  onQuitter,
}: {
  open: boolean;
  onClose: () => void;
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
            Garder ma place
          </Button>
          <Button variant="outline" onClick={onQuitter} loading={leaving} className="flex-1">
            <LogOut className="size-4" aria-hidden /> Quitter la table
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-cream">
          Tu peux revenir au salon sans quitter cette table : un bandeau te ramènera ici en un clic.
        </p>

        {wager > 0 && (
          <p className="rounded-xl border border-brass/40 bg-brass/10 px-4 py-3 text-cream">
            {formatCoins(wager)} restent engagés sur ce tour et seront réglés normalement.
          </p>
        )}

        <p className="text-cream-dim">
          Quitter la table libère ta place et te rend l'accès aux autres jeux.
        </p>
      </div>
    </Modal>
  );
}

function Verdict({ result, net }: { result: number | null; net: number }) {
  const gagne = net > 0;
  return (
    <div
      role="status"
      className={cn(
        "animate-flip-up panel flex items-center justify-center gap-3 p-3 text-center",
        gagne ? "border-brass/50" : net < 0 ? "border-danger/40" : "border-line-strong",
      )}
    >
      <p className="font-display text-lg font-extrabold text-cream">
        {result !== null ? `Le ${result}` : "Tour terminé"}
      </p>
      <p
        className={cn(
          "tabular text-lg font-black",
          gagne ? "text-win" : net < 0 ? "text-danger" : "text-cream-dim",
        )}
      >
        {net === 0 ? "Mise rendue" : formatCoinsDelta(net)}
      </p>
    </div>
  );
}
