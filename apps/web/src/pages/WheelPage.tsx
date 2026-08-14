import {
  WHEEL_SEGMENTS,
  WHEEL_TOTAL_WEIGHT,
  formatCoins,
  getGame,
  isValidStake,
  stakeSuggestions,
  wheelProbability,
  type CurrentUser,
  type WheelView,
} from "@maxoujeux/shared";
import { ArrowLeft, Loader2, Sparkles, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Countdown } from "@/components/Countdown";
import { Lien } from "@/components/Lien";
import { Plaque } from "@/components/Plaque";
import { StakePicker } from "@/components/StakePicker";
import { FortuneWheel } from "@/components/games/FortuneWheel";
import { ClassementDuJour } from "@/components/stats/ClassementDuJour";
import { marquerResultat } from "@/lib/ambiance";
import { serverNow } from "@/lib/clock";
import { cn } from "@/lib/cn";
import { playWheelTicks } from "@/lib/sounds";
import { enterWheelRoom, request, useRealtime } from "@/lib/socket";
import { useWheel } from "@/lib/wheel";

/**
 * La salle de la roue.
 *
 * Il n'y a qu'une roue sur le site : on n'y crée pas de table, on entre et on
 * regarde. Miser est un geste distinct, ouvert une fois par jour.
 *
 * L'écran est construit autour de ce partage : la roue au centre, ceux qui la
 * regardent juste en dessous, et la frise des derniers lancers sur le côté.
 * Une roue quotidienne jouée seul n'aurait aucune raison d'exister comme salle.
 */
export function WheelPage({ user }: { user: CurrentUser }) {
  const view = useWheel((state) => state.view);
  const status = useRealtime((state) => state.status);

  useEffect(() => enterWheelRoom(), []);

  if (!view) {
    return (
      <div className="grid place-items-center py-24">
        {status === "connected" ? (
          <p className="text-sm text-cream-dim">La salle est indisponible.</p>
        ) : (
          <Loader2 className="size-6 animate-spin text-game-wheel" aria-label="Chargement" />
        )}
      </div>
    );
  }

  return <WheelRoom user={user} view={view} />;
}

/**
 * Le son de la roue, calé sur l'animation et non sur la réponse du serveur.
 *
 * L'API a tranché six secondes avant l'arrêt de la roue ; annoncer le résultat à
 * ce moment-là le révélerait pendant qu'elle tourne encore. Le crépitement part
 * donc avec l'animation, et le verdict tombe quand elle s'arrête.
 *
 * Le crépitement est joué pour **toute la salle** — c'est le spectacle partagé
 * de la pièce — mais le verdict n'appartient qu'à celui qui a misé : personne
 * n'a envie d'entendre le carillon du gain d'un autre.
 */
function useSonDeLaRoue(view: WheelView, userId: string): void {
  const dernier = useRef<string | null>(null);

  useEffect(() => {
    const spinning = view.spinning;
    if (!spinning) return;
    // Un même lancer ne sonne qu'une fois : les états de la salle arrivent
    // plusieurs fois pendant la rotation, un spectateur entrant à chaque fois.
    if (dernier.current === spinning.endsAt) return;
    dernier.current = spinning.endsAt;

    const restant = Math.max(0, new Date(spinning.endsAt).getTime() - serverNow());
    playWheelTicks(restant);

    if (spinning.by.userId !== userId) return;

    const { stake, payout } = spinning.result;
    const verdict = setTimeout(() => marquerResultat(payout - stake), restant);
    return () => clearTimeout(verdict);
  }, [view.spinning, userId]);
}

function WheelRoom({ user, view }: { user: CurrentUser; view: WheelView }) {
  const pending = useWheel((state) => state.pending);
  const markPending = useWheel((state) => state.markPending);
  const clearPending = useWheel((state) => state.clearPending);
  const [error, setError] = useState<string>();

  const jeu = getGame("wheel");
  const min = jeu?.wager.min ?? 10;
  const max = jeu?.wager.max ?? 1_000;
  const step = jeu?.wager.step ?? 10;
  const [mise, setMise] = useState(min);

  const miseValide = isValidStake("wheel", mise);
  const abordable = miseValide && user.balance >= mise;
  const tourne = view.spinning !== null;
  const monLancer = view.spinning?.by.userId === user.id;

  useSonDeLaRoue(view, user.id);

  async function lancer() {
    if (!abordable || pending || tourne) return;
    markPending();
    setError(undefined);
    const reply = await request<null>((socket, ack) => socket.emit("wheel:spin", { stake: mise }, ack));
    if (!reply.ok) {
      clearPending();
      setError(reply.message);
    }
  }

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
        <Plaque tone={tourne ? "actif" : view.canSpin ? "gain" : "attente"}>
          {tourne ? "La roue tourne" : view.canSpin ? "À toi de jouer" : "Déjà joué"}
        </Plaque>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="panel relative overflow-hidden p-5 sm:p-7" aria-labelledby="wheel-title">
          <span className="absolute inset-x-0 top-0 h-0.5 bg-game-wheel" aria-hidden />

          <div className="flex items-baseline justify-between gap-3">
            <h1
              id="wheel-title"
              className="font-display text-xl font-black text-balance text-cream sm:text-3xl"
            >
              Roue de la fortune
            </h1>
            <span className="shrink-0 whitespace-nowrap text-xs text-cream-faint">
              1 lancer / jour
            </span>
          </div>

          {/* La roue, dans sa lumière : c'est le seul objet de la pièce. */}
          <div className="relative mx-auto mt-5 max-w-md">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -m-10 opacity-70"
              style={{
                backgroundImage:
                  "radial-gradient(22rem 18rem at 50% 30%, oklch(0.78 0.1 88 / 0.16), transparent 70%)",
              }}
            />
            <FortuneWheel
              target={view.spinning?.result.index ?? null}
              endsAt={view.spinning?.endsAt ?? null}
              className="relative"
            />
          </div>

          <p
            aria-live="polite"
            className={cn(
              "mt-4 text-center text-sm",
              tourne ? "text-cream" : "text-cream-dim",
            )}
          >
            {tourne
              ? monLancer
                ? "Ta roue tourne…"
                : `${view.spinning?.by.pseudo} a lancé la roue.`
              : view.lastSpin
                ? resultatLisible(view.lastSpin.payout, view.lastSpin.stake)
                : "Personne n'a encore lancé aujourd'hui."}
          </p>

          <Audience players={view.audience} meId={user.id} />
        </section>

        <aside className="space-y-4">
          {view.canSpin ? (
            <section className="panel p-5" aria-labelledby="wheel-bet">
              <h2 id="wheel-bet" className="font-display text-sm font-bold text-cream">
                Ta mise
              </h2>
              <p className="mt-1 text-xs text-cream-faint">
                De {formatCoins(min)} à {formatCoins(max)}. Un seul lancer par jour, remis à
                zéro à minuit.
              </p>

              <StakePicker
                className="mt-4"
                options={stakeSuggestions("wheel")}
                value={mise}
                onChange={setMise}
                min={min}
                step={step}
                balance={Math.min(user.balance, max)}
                disabled={pending || tourne}
              />

              <Button
                className="mt-4 w-full"
                onClick={() => void lancer()}
                loading={pending}
                disabled={!abordable || tourne}
              >
                <Sparkles className="size-4" aria-hidden />
                Lancer la roue
              </Button>

              {!abordable && miseValide && (
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
              <h2 className="font-display text-sm font-bold text-cream">Prochain lancer</h2>
              <p className="mt-2 text-2xl font-black text-brass">
                <Countdown to={view.nextSpinAt} fallback="Disponible" />
              </p>
              <p className="mt-2 text-xs text-cream-faint">
                Tu as déjà lancé. Reste regarder les autres tenter leur chance.
              </p>
            </section>
          )}

          <Barème />
          <ClassementDuJour game="wheel" meId={user.id} />
          <Historique view={view} />
        </aside>
      </div>
    </div>
  );
}

/** Ce que la roue vient de rapporter, dit sans jargon. */
function resultatLisible(payout: number, stake: number): string {
  if (payout === 0) return `Ton dernier lancer n'a rien rendu sur ${formatCoins(stake)}.`;
  if (payout > stake) return `Ton dernier lancer t'a rapporté ${formatCoins(payout - stake)}.`;
  if (payout === stake) return "Ton dernier lancer t'a rendu ta mise.";
  return `Ton dernier lancer t'a rendu ${formatCoins(payout)} sur ${formatCoins(stake)}.`;
}

function Audience({ players, meId }: { players: WheelView["audience"]; meId: string }) {
  if (players.length === 0) return null;

  return (
    <div className="mt-6 border-t border-line pt-4">
      <h2 className="flex items-center gap-2 text-xs font-bold text-cream-dim">
        <Users className="size-3.5 text-brass" aria-hidden />
        Autour de la roue
        <span className="tabular rounded-full bg-felt-high px-2 py-0.5 text-cream-dim">
          {players.length}
        </span>
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {players.map((player) => (
          <li
            key={player.userId}
            className={cn(
              "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3",
              player.userId === meId ? "border-brass/50 bg-felt-high" : "border-line bg-felt-deep/50",
            )}
          >
            <Avatar
              userId={player.userId}
              seed={player.avatarSeed}
              pseudo={player.pseudo}
              className="size-6 text-[0.6rem]"
            />
            <span className="text-xs text-cream">{player.pseudo}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Le barème, probabilités comprises.
 *
 * La roue est dessinée en parts égales alors que les cases ne le sont pas : le
 * ×20 occupe un neuvième de la surface pour un millième des chances. Afficher
 * les vraies probabilités est la contrepartie honnête de ce raccourci de
 * dessin, et c'est aussi ce qui distingue cette roue d'une roue de foire.
 */
function Barème() {
  return (
    <section className="panel p-5" aria-labelledby="wheel-odds">
      <h2 id="wheel-odds" className="font-display text-sm font-bold text-cream">
        Les chances, sans détour
      </h2>
      <p className="mt-1 text-xs text-cream-faint">
        Les cases sont dessinées à parts égales, mais elles ne sortent pas à parts égales.
      </p>

      <ul className="mt-3 space-y-1">
        {[...WHEEL_SEGMENTS]
          .map((segment, index) => ({ segment, index }))
          .sort((a, b) => a.segment.multiplierTenths - b.segment.multiplierTenths)
          .map(({ segment, index }) => {
            const chance = wheelProbability(index);
            return (
              <li key={index} className="flex items-center gap-3 text-xs">
                <span className="tabular w-12 shrink-0 font-display font-bold text-cream">
                  {segment.label}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-felt-high">
                  <span
                    className="block h-full rounded-full bg-game-wheel"
                    // Rapportée au poids le plus fort, sinon les cases rares
                    // seraient invisibles à l'échelle.
                    style={{ width: `${(segment.weight / 250) * 100}%` }}
                  />
                </span>
                <span className="tabular w-12 shrink-0 text-right text-cream-faint">
                  {formatChance(chance)}
                </span>
              </li>
            );
          })}
      </ul>

      <p className="mt-3 text-[0.7rem] leading-relaxed text-cream-faint">
        Sur {WHEEL_TOTAL_WEIGHT} lancers, la roue rend en moyenne 92 MaxouCoin pour 100 misés.
      </p>
    </section>
  );
}

function formatChance(chance: number): string {
  const pourcent = chance * 100;
  if (pourcent >= 1) return `${Math.round(pourcent)} %`;
  return `${pourcent.toFixed(1).replace(".", ",")} %`;
}

function Historique({ view }: { view: WheelView }) {
  if (view.history.length === 0) return null;

  return (
    <section className="panel p-5" aria-labelledby="wheel-history">
      <h2 id="wheel-history" className="font-display text-sm font-bold text-cream">
        Derniers lancers
      </h2>
      <ul className="mt-3 space-y-2">
        {view.history.map((entry) => (
          <li key={`${entry.by.userId}-${entry.spunAt}`} className="flex items-center gap-2 text-xs">
            <Avatar
              userId={entry.by.userId}
              seed={entry.by.avatarSeed}
              pseudo={entry.by.pseudo}
              className="size-6 text-[0.6rem]"
            />
            <span className="min-w-0 flex-1 truncate text-cream-dim">{entry.by.pseudo}</span>
            <span
              className={cn(
                "tabular font-display font-bold",
                entry.payout > entry.stake ? "text-brass" : "text-cream-faint",
              )}
            >
              {WHEEL_SEGMENTS[entry.index]?.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
