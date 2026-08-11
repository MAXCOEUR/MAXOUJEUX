import {
  BLACKJACK_BET_OPTIONS,
  formatCoins,
  type BlackjackAction,
  type BlackjackView,
  type CurrentUser,
} from "@maxoujeux/shared";
import { ArrowLeft, Hand, Layers3, Plus, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Countdown } from "@/components/Countdown";
import { Lien } from "@/components/Lien";
import { StakePicker } from "@/components/StakePicker";
import { BlackjackTable } from "@/components/games/BlackjackTable";
import { useBlackjack } from "@/lib/blackjack";
import { navigate } from "@/lib/route";
import { request } from "@/lib/socket";
import { pushToast } from "@/lib/toast";

const ACTION_LABELS: Record<BlackjackAction, { label: string; icon: typeof Plus }> = {
  hit: { label: "Carte", icon: Plus },
  stand: { label: "Rester", icon: Hand },
  double: { label: "Doubler", icon: Layers3 },
  split: { label: "Séparer", icon: Layers3 },
};

function phaseLabel(view: BlackjackView): string {
  if (view.phase === "idle") return "La table attend une première mise";
  if (view.phase === "betting") return "Les mises sont ouvertes";
  if (view.phase === "insurance") return "Le croupier propose l’assurance";
  if (view.phase === "players") return view.turn?.seat === view.you ? "À toi de jouer" : "Un autre joueur réfléchit";
  if (view.phase === "dealer") return "Le croupier joue";
  return "Résultats de la manche";
}

export function BlackjackTablePage({ user, view }: { user: CurrentUser; view: BlackjackView }) {
  const pending = useBlackjack((state) => state.pending);
  const markPending = useBlackjack((state) => state.markPending);
  const clearPending = useBlackjack((state) => state.clearPending);
  const affordable = BLACKJACK_BET_OPTIONS.filter((amount) => amount <= user.balance);
  const [stake, setStake] = useState<number>(affordable.at(-1) ?? 10);
  const validStake = Number.isInteger(stake) && stake >= 10 && stake <= 2_500 && stake % 10 === 0;
  const mine = view.seats.find((seat) => seat.seat === view.you);
  const canBet = (view.phase === "idle" || view.phase === "betting") && mine && !mine.participating;
  const currentHand = view.turn?.seat === view.you ? view.turn.handIndex : null;

  async function intention(name: string, send: Parameters<typeof request<null>>[0]) {
    markPending(name);
    const reply = await request<null>(send);
    if (!reply.ok) {
      clearPending();
      pushToast("erreur", reply.message);
    }
  }

  function bet() {
    void intention("bet", (socket, ack) => socket.emit("blackjack:bet", {
      tableId: view.id,
      amount: stake,
      version: view.version,
    }, ack));
  }

  function insure(take: boolean) {
    void intention("insurance", (socket, ack) => socket.emit("blackjack:insurance", {
      tableId: view.id,
      take,
      version: view.version,
    }, ack));
  }

  function act(action: BlackjackAction) {
    if (currentHand === null) return;
    void intention(action, (socket, ack) => socket.emit("blackjack:act", {
      tableId: view.id,
      handIndex: currentHand,
      action,
      version: view.version,
    }, ack));
  }

  async function leave() {
    const active = mine?.participating && view.phase !== "idle" && view.phase !== "result";
    if (active && !window.confirm("Ta main restera automatiquement. Quitter la table ?")) return;
    const reply = await request<null>((socket, ack) => socket.emit("match:leave", { tableId: view.id }, ack));
    if (!reply.ok && reply.code !== "TABLE_GONE") {
      pushToast("erreur", reply.message);
      return;
    }
    useBlackjack.getState().clear();
    navigate({ name: "salon", game: "blackjack" });
  }

  const live = useMemo(() => {
    const activeSeat = view.turn ? view.seats.find((seat) => seat.seat === view.turn?.seat) : null;
    return view.turn?.seat === view.you ? "À toi de jouer." : activeSeat ? `Au tour de ${activeSeat.pseudo}.` : phaseLabel(view);
  }, [view]);

  return (
    <div className="space-y-4 pb-28 sm:pb-4">
      <div className="flex items-center justify-between gap-3">
        <Lien to={{ name: "salon", game: "blackjack" }} className="inline-flex items-center gap-1.5 text-sm text-cream-dim hover:text-cream">
          <ArrowLeft className="size-4" aria-hidden /> Blackjack
        </Lien>
        <Button variant="ghost" onClick={() => void leave()} className="text-xs">Quitter la table</Button>
      </div>

      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-extrabold text-cream">Table Blackjack</h1>
          <p className="text-sm text-cream-dim">{phaseLabel(view)}</p>
        </div>
        {view.deadlineAt && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-cream-faint">Temps</p>
            <Countdown to={view.deadlineAt} format="horloge" className="tabular text-xl font-bold text-cream" />
          </div>
        )}
      </header>

      <BlackjackTable view={view} />

      <section className="panel p-4" aria-label="Tes actions">
        {canBet ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-base font-bold text-cream">Ta mise</h2>
              <p className="text-xs text-cream-faint">La première mise lance 20 secondes de préparation.</p>
            </div>
            <StakePicker options={[...BLACKJACK_BET_OPTIONS]} value={stake} onChange={setStake} balance={user.balance} disabled={pending !== null} />
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-cream-faint">
              Mise précise
              <input
                type="number"
                min={10}
                max={2_500}
                step={10}
                value={stake}
                disabled={pending !== null}
                onChange={(event) => setStake(Number(event.target.value))}
                className="mt-1.5 w-full rounded-xl border border-line-strong bg-felt-deep/60 px-3.5 py-2.5 text-base text-cream focus:border-brass focus:outline-none"
              />
            </label>
            <Button onClick={bet} loading={pending === "bet"} disabled={!validStake || stake > user.balance} className="w-full">
              Miser {formatCoins(stake)}
            </Button>
          </div>
        ) : view.phase === "insurance" && view.insuranceCost !== null ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Button onClick={() => insure(true)} loading={pending === "insurance"}>
              <ShieldCheck className="size-4" aria-hidden /> Assurance {formatCoins(view.insuranceCost)}
            </Button>
            <Button variant="outline" onClick={() => insure(false)} disabled={pending !== null}>Sans assurance</Button>
          </div>
        ) : view.allowedActions.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {view.allowedActions.map((action) => {
              const item = ACTION_LABELS[action];
              const Icon = item.icon;
              return (
                <Button key={action} variant={action === "hit" ? "primary" : "outline"} onClick={() => act(action)} loading={pending === action} disabled={pending !== null}>
                  <Icon className="size-4" aria-hidden /> {item.label}
                </Button>
              );
            })}
          </div>
        ) : (
          <p className="text-center text-sm text-cream-dim">
            {mine?.participating ? "Ta mise est engagée. Suis la donne autour de la table." : "Tu observes cette manche. Tu pourras miser à la suivante."}
          </p>
        )}
      </section>

      <p aria-live="polite" aria-atomic="true" className="sr-only">{live}</p>
    </div>
  );
}
