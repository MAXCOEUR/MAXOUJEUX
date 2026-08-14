import {
  SLOTS_SPIN_MS,
  SLOT_SYMBOLS,
  formatCoins,
  getGame,
  isValidStake,
  slotSymbol,
  slotsHitRate,
  slotsReturnToPlayer,
  stakeSuggestions,
  type CurrentUser,
  type SlotsSpinResult,
  type SlotsTableView,
} from "@maxoujeux/shared";
import { ArrowLeft, Eye, Loader2, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Lien } from "@/components/Lien";
import { Modal } from "@/components/Modal";
import { Plaque } from "@/components/Plaque";
import { StakePicker } from "@/components/StakePicker";
import { SlotMachine } from "@/components/games/SlotMachine";
import { SlotSymbolGlyph } from "@/components/games/SlotSymbolGlyph";
import { marquerResultat } from "@/lib/ambiance";
import { cn } from "@/lib/cn";
import { navigate } from "@/lib/route";
import { useSlots } from "@/lib/slots";
import { request, useRealtime } from "@/lib/socket";
import { playSound } from "@/lib/sounds";

/**
 * Une machine à sous.
 *
 * La machine appartient à son joueur ; les autres regardent. La mise se choisit
 * tour par tour, et les rouleaux occupent la machine le temps de leur rotation :
 * il n'y a rien à enchaîner, juste à tirer et attendre.
 */
export function SlotsPage({ user, tableId }: { user: CurrentUser; tableId: string }) {
  const view = useSlots((state) => state.view);
  const status = useRealtime((state) => state.status);

  if (!view || view.id !== tableId) {
    return (
      <div className="grid place-items-center py-24">
        {status === "connected" ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-cream-dim">Cette machine n'est plus ouverte.</p>
            <Lien to={{ name: "salon", game: "slots" }} className="text-sm text-brass underline">
              Retour aux machines
            </Lien>
          </div>
        ) : (
          <Loader2 className="size-6 animate-spin text-game-slots" aria-label="Chargement" />
        )}
      </div>
    );
  }

  return <SlotsTableScreen user={user} view={view} />;
}

/**
 * Le son des rouleaux, calé sur leur arrêt.
 *
 * Le tirage est décidé au départ ; le verdict ne doit tomber qu'une fois les
 * trois rouleaux immobiles, sans quoi le son annoncerait le résultat avant que
 * le troisième symbole ne soit lisible — et c'est précisément l'attente du
 * troisième qui fait le suspense d'une machine à sous.
 */
function useSonDesRouleaux(spinning: SlotsSpinResult | null, proprietaire: boolean): void {
  const dernier = useRef<string | null>(null);

  useEffect(() => {
    if (!spinning || !proprietaire) return;
    // Un même tirage ne sonne qu'une fois : l'état de la machine est rediffusé
    // à chaque spectateur qui entre ou sort pendant la rotation.
    if (dernier.current === spinning.id) return;
    dernier.current = spinning.id;

    playSound("jeton");
    const verdict = setTimeout(
      () => marquerResultat(spinning.payout - spinning.stake),
      SLOTS_SPIN_MS,
    );
    return () => clearTimeout(verdict);
  }, [spinning, proprietaire]);
}

function SlotsTableScreen({ user, view }: { user: CurrentUser; view: SlotsTableView }) {
  const pending = useSlots((state) => state.pending);
  const markPending = useSlots((state) => state.markPending);
  const clearPending = useSlots((state) => state.clearPending);
  const [error, setError] = useState<string>();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const jeu = getGame("slots");
  const min = jeu?.wager.min ?? 10;
  const max = jeu?.wager.max ?? 100;
  const step = jeu?.wager.step ?? 10;
  const [mise, setMise] = useState(min);

  const proprietaire = view.owner.userId === user.id;
  const abordable = isValidStake("slots", mise) && user.balance >= mise;
  const tourne = view.spinning !== null;
  const dernier = view.history[0] ?? null;

  useSonDesRouleaux(view.spinning, proprietaire);

  async function tirer() {
    if (!proprietaire || !abordable || tourne) return;
    markPending();
    setError(undefined);
    const reply = await request<null>((socket, ack) =>
      socket.emit("slots:spin", { tableId: view.id, stake: mise }, ack),
    );
    if (!reply.ok) {
      clearPending();
      setError(reply.message);
    }
  }

  async function quitter() {
    setLeaving(true);
    await request<null>((socket, ack) => socket.emit("match:leave", { tableId: view.id }, ack));
    setLeaving(false);
    setConfirmLeave(false);
    navigate({ name: "salon", game: "slots" });
  }

  /** Aller au salon sans quitter : la machine reste ouverte, on peut y revenir. */
  function garderLaMachine() {
    setConfirmLeave(false);
    navigate({ name: "salon", game: "slots" });
  }

  return (
    <div className="space-y-5 pb-8">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setConfirmLeave(true)}
          className="-my-2 inline-flex min-h-11 items-center gap-1.5 py-2 text-sm text-cream-dim transition-colors hover:text-cream"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Les machines
        </button>
        <div className="flex items-center gap-2">
          {!proprietaire && (
            <Plaque tone="neutre" icon={Eye}>
              Spectateur
            </Plaque>
          )}
          <Button variant="ghost" onClick={() => setConfirmLeave(true)} className="text-xs">
            {proprietaire ? "Fermer la machine" : "Quitter"}
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="panel relative overflow-hidden p-4 sm:p-6" aria-labelledby="slots-title">
          <span className="absolute inset-x-0 top-0 h-0.5 bg-game-slots" aria-hidden />

          <div className="flex items-center justify-between gap-3">
            <h1 id="slots-title" className="font-display text-xl font-black text-cream">
              {proprietaire ? "Ta machine" : `Machine de ${view.owner.pseudo}`}
            </h1>
            <span className="text-xs text-cream-faint">
              {tourne ? "Les rouleaux tournent" : "Prête"}
            </span>
          </div>

          <div className="relative mx-auto mt-5 max-w-sm sm:max-w-md">
            {/* Lueur de plafonnier : la machine est l'objet éclairé de la pièce. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -m-8 opacity-70"
              style={{
                backgroundImage:
                  "radial-gradient(18rem 14rem at 50% 30%, oklch(0.78 0.1 88 / 0.14), transparent 70%)",
              }}
            />
            <SlotMachine
              spinning={view.spinning}
              resting={dernier}
              stake={mise}
              onPull={proprietaire ? () => void tirer() : undefined}
              canPull={abordable}
              className="relative"
            />
          </div>

          <p aria-live="polite" className="mt-5 text-center text-sm text-cream-dim">
            <Annonce spinning={view.spinning} dernier={dernier} tourne={tourne} />
          </p>

          <Bandeau view={view} />
        </section>

        <aside className="space-y-4">
          {proprietaire ? (
            <section className="panel p-5" aria-labelledby="slots-controls">
              <h2 id="slots-controls" className="font-display text-sm font-bold text-cream">
                Ta mise
              </h2>
              <p className="mt-1 text-xs text-cream-faint">
                De {formatCoins(min)} à {formatCoins(max)}, à chaque tour.
              </p>

              <StakePicker
                className="mt-4"
                options={stakeSuggestions("slots")}
                value={mise}
                onChange={setMise}
                min={min}
                step={step}
                balance={Math.min(user.balance, max)}
                disabled={pending || tourne}
              />

              <Button
                className="mt-4 w-full"
                onClick={() => void tirer()}
                loading={pending && !tourne}
                disabled={!abordable || tourne}
              >
                Tirer pour {formatCoins(mise)}
              </Button>

              {!abordable && isValidStake("slots", mise) && (
                <p className="mt-2 text-xs text-cream-faint">
                  Il te manque {formatCoins(mise - user.balance)}.
                </p>
              )}
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
                {view.owner.pseudo} joue. Ouvre ta propre machine depuis la liste pour tirer tes
                rouleaux.
              </p>
            </section>
          )}

          <TableDesGains />
          <Frise history={view.history} />
          <Spectateurs view={view} meId={user.id} />
        </aside>
      </div>

      <LeaveDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        proprietaire={proprietaire}
        spectateurs={view.watchers.length}
        tourne={tourne}
        leaving={leaving}
        onGarder={garderLaMachine}
        onQuitter={() => void quitter()}
      />
    </div>
  );
}

/** Ce que la machine vient de faire, dit sans jargon. */
function Annonce({
  spinning,
  dernier,
  tourne,
}: {
  spinning: SlotsSpinResult | null;
  dernier: SlotsSpinResult | null;
  tourne: boolean;
}) {
  if (tourne && spinning) return <>Les rouleaux tournent…</>;
  if (!dernier) return <>Tire les rouleaux pour lancer la machine.</>;

  if (dernier.kind === "none") {
    return <>Rien d'aligné. {formatCoins(dernier.stake)} perdus.</>;
  }

  const nom = dernier.symbol !== null ? slotSymbol(dernier.symbol).name : "";
  const net = dernier.payout - dernier.stake;

  return (
    <span className="text-cream">
      {dernier.kind === "triple" ? `Trois ${nom.toLowerCase()}s` : `Deux ${nom.toLowerCase()}s`} —{" "}
      <span className="tabular font-semibold text-brass">
        {net >= 0 ? `+${formatCoins(net)}` : formatCoins(dernier.payout)}
      </span>
    </span>
  );
}

/** Ce que la machine a encaissé et rendu depuis son ouverture. */
function Bandeau({ view }: { view: SlotsTableView }) {
  if (view.wagered === 0) return null;
  const solde = view.returned - view.wagered;

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

/**
 * La table de gains.
 *
 * Elle est affichée en entier, paires comprises : une machine à sous dont on ne
 * connaît pas le barème ne se joue pas, elle se subit. Le taux de redistribution
 * est annoncé au bas, comme sur la roue.
 */
function TableDesGains() {
  const rtp = Math.round(slotsReturnToPlayer() * 100);
  const frequence = slotsHitRate();

  return (
    <section className="panel p-5" aria-labelledby="slots-paytable">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="slots-paytable" className="font-display text-sm font-bold text-cream">
          Table de gains
        </h2>
        <p className="text-xs text-cream-faint">
          {Math.round(frequence * 100)} % des tours paient — la machine rend {rtp} MC pour 100 misés
        </p>
      </div>

      {/* Une carte par symbole, du plus rare au plus commun : c'est le MAXOU
          qu'on cherche des yeux en premier, pas la cerise. */}
      <ul className="grid grid-cols-2 gap-2">
        {[...SLOT_SYMBOLS]
          .map((symbol, index) => ({ symbol, index }))
          .reverse()
          .map(({ symbol, index }) => (
            <li
              key={symbol.code}
              className="flex items-center gap-2.5 rounded-xl border border-line bg-felt-deep/50 px-3 py-2"
            >
              <span className="size-8 shrink-0">
                <SlotSymbolGlyph index={index} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-cream-dim">{symbol.name}</span>
                <span className="tabular flex items-baseline gap-2 text-xs">
                  <span className="font-display font-bold text-brass">
                    ×{symbol.tripleTenths / 10}
                  </span>
                  <span className="text-cream-faint">
                    ×{formatDecimal(symbol.pairTenths / 10)}
                  </span>
                </span>
              </span>
            </li>
          ))}
      </ul>

      <p className="mt-2 text-[0.7rem] text-cream-faint">
        Premier chiffre : trois symboles alignés. Second : deux seulement, où qu'ils soient.
      </p>
    </section>
  );
}

function formatDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

/** Les derniers tirages, du plus récent au plus ancien. */
function Frise({ history }: { history: SlotsSpinResult[] }) {
  if (history.length === 0) return null;

  return (
    <section className="panel p-5" aria-labelledby="slots-history">
      <h2 id="slots-history" className="font-display text-sm font-bold text-cream">
        Derniers tours
      </h2>
      <ul className="mt-3 space-y-1.5">
        {history.map((spin) => (
          <li key={spin.id} className="flex items-center gap-2 text-xs">
            <span className="flex gap-0.5">
              {spin.reels.map((symbol, position) => (
                <span key={position} className="size-5">
                  <SlotSymbolGlyph index={symbol} />
                </span>
              ))}
            </span>
            <span className="min-w-0 flex-1 truncate text-cream-faint">
              {formatCoins(spin.stake)}
            </span>
            <span
              className={cn(
                "tabular font-display font-bold",
                spin.payout > spin.stake
                  ? "text-brass"
                  : spin.payout > 0
                    ? "text-cream-dim"
                    : "text-cream-faint",
              )}
            >
              {spin.payout > 0 ? `+${formatCoins(spin.payout)}` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Spectateurs({ view, meId }: { view: SlotsTableView; meId: string }) {
  const monde = [view.owner, ...view.watchers];

  return (
    <section className="panel p-5">
      <h2 className="font-display text-sm font-bold text-cream">Autour de la machine</h2>
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

/** Quitter, ou seulement s'éloigner ? Même geste qu'au Blackjack et au Plinko. */
function LeaveDialog({
  open,
  onClose,
  proprietaire,
  spectateurs,
  tourne,
  leaving,
  onGarder,
  onQuitter,
}: {
  open: boolean;
  onClose: () => void;
  proprietaire: boolean;
  spectateurs: number;
  tourne: boolean;
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
            {proprietaire ? "Garder ma machine" : "Rester à la machine"}
          </Button>
          <Button variant="outline" onClick={onQuitter} loading={leaving} className="flex-1">
            <LogOut className="size-4" aria-hidden />
            {proprietaire ? "Fermer la machine" : "Quitter la machine"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-cream">
          Tu peux aller au salon sans fermer cette machine : un bandeau te ramènera ici en un clic.
        </p>

        {tourne && (
          <p className="rounded-xl border border-brass/40 bg-brass/10 px-4 py-3 text-cream">
            Les rouleaux tournent encore. Le tour est déjà payé : partir ne coûte rien.
          </p>
        )}

        <p className="text-cream-dim">
          {proprietaire
            ? spectateurs > 0
              ? `Fermer la machine rend ta place aux autres joueurs et renvoie ${spectateurs === 1 ? "ton spectateur" : `tes ${spectateurs} spectateurs`} au salon.`
              : "Fermer la machine rend ta place aux autres joueurs."
            : "Quitter la machine te rend l'accès aux autres jeux."}
        </p>

        <p className="text-xs text-cream-faint">
          Tant que tu es à cette machine, spectateur compris, tu ne peux pas rejoindre un autre jeu.
        </p>
      </div>
    </Modal>
  );
}
