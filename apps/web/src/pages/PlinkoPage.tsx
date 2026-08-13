import {
  PLINKO_MAX_BALLS,
  PLINKO_RISKS,
  PLINKO_RISK_LABELS,
  formatCoins,
  getGame,
  isValidStake,
  plinkoReturnToPlayer,
  plinkoTable,
  stakeSuggestions,
  type CurrentUser,
  type PlinkoRisk,
  type PlinkoTableView,
} from "@maxoujeux/shared";
import { ArrowLeft, Eye, Loader2, LogOut } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Lien } from "@/components/Lien";
import { Modal } from "@/components/Modal";
import { Plaque } from "@/components/Plaque";
import { StakePicker } from "@/components/StakePicker";
import { PlinkoBoard, formatMultiplier } from "@/components/games/PlinkoBoard";
import { navigate } from "@/lib/route";
import { cn } from "@/lib/cn";
import { usePlinko } from "@/lib/plinko";
import { request, useRealtime } from "@/lib/socket";

/**
 * Une table de Plinko.
 *
 * La table appartient à un joueur ; les autres regardent. Les billes
 * s'enchaînent — on peut en avoir une dizaine en l'air — et chacune rejoue le
 * trajet tiré par le serveur, à l'identique pour tout le monde.
 */
export function PlinkoPage({ user, tableId }: { user: CurrentUser; tableId: string }) {
  const view = usePlinko((state) => state.view);
  const status = useRealtime((state) => state.status);

  if (!view || view.id !== tableId) {
    return (
      <div className="grid place-items-center py-24">
        {status === "connected" ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-cream-dim">Cette table n'est plus ouverte.</p>
            <Lien to={{ name: "salon", game: "plinko" }} className="text-sm text-brass underline">
              Retour aux tables
            </Lien>
          </div>
        ) : (
          <Loader2 className="size-6 animate-spin text-game-plinko" aria-label="Chargement" />
        )}
      </div>
    );
  }

  return <PlinkoTableScreen user={user} view={view} />;
}

function PlinkoTableScreen({ user, view }: { user: CurrentUser; view: PlinkoTableView }) {
  const pending = usePlinko((state) => state.pending);
  const markPending = usePlinko((state) => state.markPending);
  const clearPending = usePlinko((state) => state.clearPending);
  const [error, setError] = useState<string>();

  const jeu = getGame("plinko");
  const min = jeu?.wager.min ?? 10;
  const max = jeu?.wager.max ?? 500;
  const step = jeu?.wager.step ?? 10;
  const [mise, setMise] = useState(min);

  const proprietaire = view.owner.userId === user.id;
  const abordable = isValidStake("plinko", mise) && user.balance >= mise;
  const tablePleine = view.balls.length >= PLINKO_MAX_BALLS;

  async function lacher() {
    if (!proprietaire || !abordable || tablePleine) return;
    markPending();
    setError(undefined);
    const reply = await request<null>((socket, ack) =>
      socket.emit("plinko:drop", { tableId: view.id, stake: mise }, ack),
    );
    if (!reply.ok) {
      clearPending();
      setError(reply.message);
    }
  }

  async function changerRisque(risk: PlinkoRisk) {
    if (!proprietaire || risk === view.risk) return;
    const reply = await request<null>((socket, ack) =>
      socket.emit("plinko:risk", { tableId: view.id, risk }, ack),
    );
    if (!reply.ok) setError(reply.message);
  }

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function quitter() {
    setLeaving(true);
    await request<null>((socket, ack) => socket.emit("match:leave", { tableId: view.id }, ack));
    setLeaving(false);
    setConfirmLeave(false);
    navigate({ name: "salon", game: "plinko" });
  }

  /** Aller au salon sans quitter : la table reste ouverte, on peut y revenir. */
  function garderLaTable() {
    setConfirmLeave(false);
    navigate({ name: "salon", game: "plinko" });
  }

  return (
    <div className="space-y-5 pb-8">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setConfirmLeave(true)}
          className="inline-flex items-center gap-1.5 text-sm text-cream-dim transition-colors hover:text-cream"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Les tables
        </button>
        <div className="flex items-center gap-2">
          {!proprietaire && (
            <Plaque tone="neutre" icon={Eye}>
              Spectateur
            </Plaque>
          )}
          <Button variant="ghost" onClick={() => setConfirmLeave(true)} className="text-xs">
            {proprietaire ? "Fermer la table" : "Quitter"}
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="panel relative overflow-hidden p-4 sm:p-6" aria-labelledby="plinko-title">
          <span className="absolute inset-x-0 top-0 h-0.5 bg-game-plinko" aria-hidden />

          <div className="flex items-center justify-between gap-3">
            <h1 id="plinko-title" className="font-display text-xl font-black text-cream">
              {proprietaire ? "Ta table" : `Table de ${view.owner.pseudo}`}
            </h1>
            <span className="tabular text-xs text-cream-faint">
              {view.balls.length} bille{view.balls.length > 1 ? "s" : ""} en l'air
            </span>
          </div>

          <div className="mx-auto mt-4 max-w-xl">
            <PlinkoBoard risk={view.risk} balls={view.balls} />
          </div>

          <Bandeau view={view} />
        </section>

        <aside className="space-y-4">
          {proprietaire ? (
            <section className="panel p-5" aria-labelledby="plinko-controls">
              <h2 id="plinko-controls" className="font-display text-sm font-bold text-cream">
                Lâcher une bille
              </h2>

              <fieldset className="mt-4">
                <legend className="text-xs text-cream-faint">Niveau de risque</legend>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {PLINKO_RISKS.map((risk) => (
                    <button
                      key={risk}
                      type="button"
                      onClick={() => void changerRisque(risk)}
                      aria-pressed={view.risk === risk}
                      className={cn(
                        "rounded-lg border px-2 py-2 text-xs font-semibold transition-colors",
                        view.risk === risk
                          ? "border-game-plinko bg-felt-high text-cream"
                          : "border-line text-cream-dim hover:text-cream",
                      )}
                    >
                      {PLINKO_RISK_LABELS[risk]}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[0.7rem] text-cream-faint">
                  Bords {formatMultiplier(plinkoTable(view.risk)[0] ?? 0)}, centre{" "}
                  {formatMultiplier(plinkoTable(view.risk)[6] ?? 0)}. Le risque change les gains,
                  pas la fréquence.
                </p>
              </fieldset>

              <StakePicker
                className="mt-4"
                options={stakeSuggestions("plinko")}
                value={mise}
                onChange={setMise}
                min={min}
                step={step}
                balance={Math.min(user.balance, max)}
                disabled={pending}
              />

              <Button
                className="mt-4 w-full"
                onClick={() => void lacher()}
                disabled={!abordable || tablePleine}
              >
                Lâcher {formatCoins(mise)}
              </Button>

              <p className="mt-2 text-center text-[0.7rem] text-cream-faint">
                {tablePleine
                  ? "Laisse la table se vider."
                  : "Enchaîne : plusieurs billes peuvent tomber ensemble."}
              </p>

              {error && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {error}
                </p>
              )}
            </section>
          ) : (
            <section className="panel p-5">
              <h2 className="font-display text-sm font-bold text-cream">Tu regardes</h2>
              <p className="mt-2 text-xs leading-relaxed text-cream-dim">
                {view.owner.pseudo} joue en risque{" "}
                {PLINKO_RISK_LABELS[view.risk].toLowerCase()}. Ouvre ta propre table depuis la
                liste pour lâcher tes billes.
              </p>
            </section>
          )}

          <Barème risk={view.risk} />
          <Spectateurs view={view} meId={user.id} />
        </aside>
      </div>

      <LeaveDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        proprietaire={proprietaire}
        spectateurs={view.watchers.length}
        billes={view.balls.length}
        leaving={leaving}
        onGarder={garderLaTable}
        onQuitter={() => void quitter()}
      />
    </div>
  );
}

/**
 * Quitter, ou seulement s'éloigner ?
 *
 * Même geste qu'au Blackjack : aller au salon ne doit pas fermer la table par
 * accident. La différence tient à ce qu'on perd — ici, le propriétaire emmène
 * la table avec lui, spectateurs compris.
 */
function LeaveDialog({
  open,
  onClose,
  proprietaire,
  spectateurs,
  billes,
  leaving,
  onGarder,
  onQuitter,
}: {
  open: boolean;
  onClose: () => void;
  proprietaire: boolean;
  spectateurs: number;
  billes: number;
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
            {proprietaire ? "Garder ma table" : "Rester à la table"}
          </Button>
          <Button variant="outline" onClick={onQuitter} loading={leaving} className="flex-1">
            <LogOut className="size-4" aria-hidden />
            {proprietaire ? "Fermer la table" : "Quitter la table"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-cream">
          Tu peux aller au salon sans fermer cette table : un bandeau te ramènera ici en un clic.
        </p>

        {billes > 0 && (
          <p className="rounded-xl border border-brass/40 bg-brass/10 px-4 py-3 text-cream">
            {billes} bille{billes > 1 ? "s sont" : " est"} encore en l'air.{" "}
            {billes > 1 ? "Elles sont" : "Elle est"} déjà payée
            {billes > 1 ? "s" : ""} : partir ne coûte rien.
          </p>
        )}

        <p className="text-cream-dim">
          {proprietaire
            ? spectateurs > 0
              ? `Fermer la table rend ta place aux autres joueurs et renvoie ${spectateurs === 1 ? "ton spectateur" : `tes ${spectateurs} spectateurs`} au salon.`
              : "Fermer la table rend ta place aux autres joueurs."
            : "Quitter la table te rend l'accès aux autres jeux."}
        </p>

        <p className="text-xs text-cream-faint">
          Tant que tu es à cette table, spectateur compris, tu ne peux pas rejoindre un autre jeu.
        </p>
      </div>
    </Modal>
  );
}

/** Ce que la table a encaissé et rendu depuis son ouverture. */
function Bandeau({ view }: { view: PlinkoTableView }) {
  const solde = view.returned - view.wagered;
  if (view.wagered === 0) return null;

  return (
    <dl className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 border-t border-line pt-4 text-center">
      <div>
        <dt className="text-[0.7rem] text-cream-faint">Misé</dt>
        <dd className="tabular font-display text-sm text-cream">{formatCoins(view.wagered)}</dd>
      </div>
      <div>
        <dt className="text-[0.7rem] text-cream-faint">Rendu</dt>
        <dd className="tabular font-display text-sm text-cream">{formatCoins(view.returned)}</dd>
      </div>
      <div>
        <dt className="text-[0.7rem] text-cream-faint">Bilan</dt>
        <dd
          className={cn(
            "tabular font-display text-sm font-bold",
            solde > 0 ? "text-brass" : solde < 0 ? "text-cream-dim" : "text-cream",
          )}
        >
          {solde > 0 ? "+" : ""}
          {formatCoins(solde)}
        </dd>
      </div>
    </dl>
  );
}

/** Le barème du risque courant, fente par fente. */
function Barème({ risk }: { risk: PlinkoRisk }) {
  const table = useMemo(() => plinkoTable(risk), [risk]);
  const rtp = useMemo(() => plinkoReturnToPlayer(risk), [risk]);

  return (
    <section className="panel p-5" aria-labelledby="plinko-scale">
      <h2 id="plinko-scale" className="font-display text-sm font-bold text-cream">
        Barème — risque {PLINKO_RISK_LABELS[risk].toLowerCase()}
      </h2>
      <ul className="mt-3 grid grid-cols-7 gap-1">
        {table.slice(0, 7).map((tenths, index) => (
          <li
            key={index}
            className={cn(
              "rounded px-1 py-1.5 text-center text-[0.65rem] font-semibold tabular",
              tenths >= 10 ? "bg-brass-deep/40 text-cream" : "bg-felt-high text-cream-dim",
            )}
          >
            {formatMultiplier(tenths)}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.7rem] leading-relaxed text-cream-faint">
        Du bord vers le centre, le plateau est symétrique. Elle rend en moyenne{" "}
        {Math.round(rtp * 100)} MaxouCoin pour 100 misés.
      </p>
    </section>
  );
}

function Spectateurs({ view, meId }: { view: PlinkoTableView; meId: string }) {
  const monde = [view.owner, ...view.watchers];

  return (
    <section className="panel p-5">
      <h2 className="font-display text-sm font-bold text-cream">Autour de la table</h2>
      <ul className="mt-3 space-y-2">
        {monde.map((player, index) => (
          <li key={player.userId} className="flex items-center gap-2">
            <Avatar
              userId={player.userId}
              seed={player.avatarSeed}
              pseudo={player.pseudo}
              className="size-7 text-xs"
            />
            <span className="min-w-0 flex-1 truncate text-sm text-cream">
              {player.pseudo}
              {player.userId === meId && <span className="text-cream-faint"> — toi</span>}
            </span>
            {index === 0 && <Plaque tone="actif">Joue</Plaque>}
          </li>
        ))}
      </ul>
    </section>
  );
}
