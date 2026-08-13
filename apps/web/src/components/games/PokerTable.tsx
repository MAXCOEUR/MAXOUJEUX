import { POKER_PHASE_LABELS, formatCoins, type PokerSeatView, type PokerView } from "@maxoujeux/shared";
import { Layers, Pause } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Plaque } from "@/components/Plaque";
import { ProgressRing } from "@/components/ProgressRing";
import { PlayingCard } from "@/components/games/blackjack/PlayingCard";
import { ChipStack } from "@/components/games/casino/Chips";
import { cn } from "@/lib/cn";
import { dealOrigin, ovalPose, pokerSeatOrder, potTravel, seatActionLabel } from "@/lib/poker-ui";

/**
 * La table de poker.
 *
 * Un ovale de feutre cerclé de laiton, le croupier au centre avec son sabot,
 * les joueurs tout autour. Le siège d'ancrage est **toujours en bas** : c'est
 * la table qui tourne, pas le joueur. Un spectateur qui suit quelqu'un voit
 * donc la table de sa place.
 *
 * Les cartes des adversaires arrivent `null` du serveur — elles ne sont pas
 * masquées ici, elles n'existent tout simplement pas côté client tant que la
 * main n'est pas abattue.
 */
export function PokerTable({
  view,
  onSit,
  sitting,
  anchor,
  onFollow,
  followed,
}: {
  view: PokerView;
  onSit?: ((seat: number) => void) | undefined;
  sitting: number | null;
  /** Siège placé en bas. Le sien, ou celui qu'on suit. */
  anchor: number | null;
  /** Suivre un joueur. Absent quand on est assis : on suit forcément sa propre place. */
  onFollow?: ((userId: string | null) => void) | undefined;
  followed: string | null;
}) {
  const ordre = pokerSeatOrder(anchor, view.maxSeats);
  const parSiege = new Map(view.seats.map((seat) => [seat.seat, seat]));
  const ramassage = useRamassage(view);

  return (
    <div className="plateau relative mx-auto mb-12 h-[25rem] w-full max-w-3xl sm:h-auto sm:aspect-[16/10]">
      <Tapis />

      <Croupier view={view} />

      {/* Le tableau et le pot, au centre du feutre. */}
      <div className="absolute inset-x-[16%] top-[46%] -translate-y-1/2 text-center">
        <Tableau view={view} />
        <Pot view={view} />
      </div>

      {/* Les mises ramassées en fin de rue : elles partent des sièges et se
          réunissent au pot. Aucune information ici, uniquement le lien entre
          les jetons qui disparaissent et le pot qui grossit. */}
      {ramassage.map((vol) => (
        <MiseEnVol key={vol.cle} vol={vol} maxSeats={view.maxSeats} anchor={anchor} />
      ))}

      <GainsEnVol view={view} anchor={anchor} />

      {/* Les sièges, répartis sur l'ovale. */}
      {ordre.map((place, index) => {
        const pose = ovalPose(index, view.maxSeats);
        const siege = parSiege.get(place) ?? null;

        return (
          <div
            key={place}
            className="absolute w-[27%] max-w-[9.5rem] -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pose.x}%`, top: `${pose.y}%`, scale: pose.scale }}
          >
            {siege ? (
              <Seat
                seat={siege}
                view={view}
                auTrait={view.turn === siege.seat}
                place={index}
                estAncre={siege.seat === anchor}
                suivi={followed === siege.userId}
                onFollow={onFollow}
              />
            ) : (
              <SeatLibre
                place={place}
                onSit={onSit}
                enCours={sitting === place}
                disponible={onSit !== undefined}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Le tapis.
 *
 * Quatre couches, et chacune répond à un défaut précis d'un simple ovale plat :
 * le rail extérieur donne l'épaisseur du bord, le reflet de laiton pose la
 * lumière en haut, le feutre porte une vignette pour que le centre ressorte, et
 * le liseré intérieur trace la limite au-delà de laquelle on ne pose rien.
 */
function Tapis() {
  return (
    <>
      <div
        className="absolute inset-[3%] rounded-[50%]"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in oklab, var(--color-brass) 55%, black) 0%, var(--color-felt-deep) 55%, color-mix(in oklab, var(--color-brass-deep) 40%, black) 100%)",
          boxShadow: "0 10px 30px rgb(0 0 0 / 0.55)",
        }}
      />
      <div
        className="absolute inset-[6.5%] rounded-[50%] border border-brass-deep/70"
        style={{
          background:
            "radial-gradient(120% 120% at 50% 34%, var(--color-felt-high) 0%, var(--color-felt) 42%, var(--color-felt-deep) 100%)",
          boxShadow: "inset 0 0 70px rgb(0 0 0 / 0.6), inset 0 2px 0 rgb(255 255 255 / 0.05)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-[10%] rounded-[50%] border border-brass/15"
      />
    </>
  );
}

/**
 * Le croupier.
 *
 * Il tient le sabot et annonce la rue. Sa place est au centre haut du feutre,
 * là d'où partent les cartes : c'est ce qui donne une origine crédible à la
 * distribution, plutôt que des cartes qui apparaissent devant chacun.
 */
function Croupier({ view }: { view: PokerView }) {
  const donne = view.phase !== "waiting";
  const montreGenerale =
    view.deadlineAt !== null &&
    view.timerMs !== null &&
    view.timerKind !== null &&
    view.timerKind !== "action";

  return (
    <div className="absolute inset-x-0 top-[25%] flex flex-col items-center gap-1">
      {montreGenerale && view.deadlineAt && view.timerMs && (
        <span className="absolute left-[calc(50%-4.25rem)] top-[-0.45rem] -translate-x-1/2">
          <ProgressRing deadlineAt={view.deadlineAt} turnMs={view.timerMs} size={44} showSeconds>
            <span aria-hidden className="size-8 rounded-full border border-brass/30 bg-felt-deep/80" />
          </ProgressRing>
        </span>
      )}
      <div className="flex items-center gap-2 rounded-full border border-line bg-felt-deep/85 px-2.5 py-1 shadow-[0_2px_8px_rgb(0_0_0/0.5)]">
        {/* Le sabot : deux dos de carte empilés, pas une icône générique. */}
        <span aria-hidden className="relative block h-4 w-3.5 shrink-0">
          <span className="absolute inset-0 translate-x-[2px] translate-y-[-2px] rounded-[2px] border border-brass-deep bg-dos-profond" />
          <span className="absolute inset-0 rounded-[2px] border border-brass-deep bg-dos" />
        </span>
        <span className="font-display text-[0.68rem] font-bold uppercase tracking-[0.14em] text-brass">
          Croupier
        </span>
      </div>
      <p className="text-[0.65rem] uppercase tracking-[0.16em] text-cream-faint">
        {donne ? POKER_PHASE_LABELS[view.phase] : "Table ouverte"}
      </p>
    </div>
  );
}

/** Le tableau commun. */
function Tableau({ view }: { view: PokerView }) {
  return (
    <div
      className="flex min-h-[3.6rem] items-center justify-center gap-1.5 sm:min-h-[4.6rem]"
      aria-label={view.board.length === 0 ? "Cinq cartes communes fermées" : "Cartes communes"}
    >
      {Array.from({ length: 5 }, (_, index) => view.board[index] ?? null).map((carte, index) => (
        <PlayingCard
          // Clé stable : la carte se **retourne** à la révélation au lieu d'être
          // remontée, ce qui rejouerait la distribution.
          key={index}
          data-poker-board-card={index}
          card={carte}
          dealIndex={index}
          dealFromX={0}
          dealFromY={-120}
          className="[--carte-l:2.5rem] sm:[--carte-l:3.3rem]"
        />
      ))}
    </div>
  );
}

/**
 * Le pot.
 *
 * Il pulse quand il grossit : c'est la fin du trajet des jetons ramassés, et
 * sans cet accusé de réception le mouvement se perdrait au milieu de la table.
 */
function Pot({ view }: { view: PokerView }) {
  const precedent = useRef(view.potTotal);
  const [encaisse, setEncaisse] = useState(0);

  useEffect(() => {
    if (view.potTotal > precedent.current) setEncaisse((n) => n + 1);
    precedent.current = view.potTotal;
  }, [view.potTotal]);

  if (view.potTotal <= 0) return null;

  return (
    <div
      key={encaisse}
      className="mt-2 flex flex-col items-center gap-0.5"
      style={{ animation: "var(--animate-pot)" }}
    >
      <ChipStack amount={view.potTotal} max={4} className="[--jeton-l:1.5rem] sm:[--jeton-l:1.8rem]" />
      <p className="tabular font-display text-sm font-bold text-brass">
        {formatCoins(view.potTotal)}
      </p>
      {view.pots.length > 1 && (
        <p className="text-[0.7rem] text-cream-faint">{view.pots.length} pots — tapis inégaux</p>
      )}
    </div>
  );
}

interface Vol {
  cle: string;
  /** Place **d'affichage** du siège, pas son numéro : le trajet part de l'écran. */
  place: number;
  amount: number;
}

/**
 * Retient les mises au moment où la rue se ferme.
 *
 * Le serveur remet les engagements à zéro et augmente le pot dans le même
 * message : sans mémoire du coup d'avant, il ne resterait rien à faire voler.
 */
function useRamassage(view: PokerView): Vol[] {
  const precedent = useRef<{ phase: string; mises: { seat: number; amount: number }[] }>({
    phase: view.phase,
    mises: [],
  });
  const [vols, setVols] = useState<Vol[]>([]);

  useEffect(() => {
    const mises = view.seats
      .filter((siege) => siege.committed > 0)
      .map((siege) => ({ seat: siege.seat, amount: siege.committed }));
    const avant = precedent.current;
    precedent.current = { phase: view.phase, mises };

    // Uniquement au changement de rue, et seulement s'il y avait de quoi
    // ramasser : un simple changement de version ne doit rien déclencher.
    if (avant.phase === view.phase || avant.mises.length === 0) return;

    const lot = avant.mises.map((mise) => ({
      cle: `${view.version}-${mise.seat}`,
      place: mise.seat,
      amount: mise.amount,
    }));
    setVols(lot);
    const minuteur = setTimeout(() => setVols([]), 600);
    return () => clearTimeout(minuteur);
  }, [view.phase, view.version, view.seats]);

  return vols;
}

/** Une mise en route vers le pot. */
function MiseEnVol({
  vol,
  maxSeats,
  anchor,
}: {
  vol: Vol;
  maxSeats: number;
  anchor: number | null;
}) {
  // Le trajet se calcule sur la place **affichée**, pas sur le numéro de siège :
  // la table tourne autour de l'ancre.
  const place = anchor === null ? vol.place : (vol.place - anchor + maxSeats) % maxSeats;
  const trajet = potTravel(place, maxSeats);
  const pose = ovalPose(place, maxSeats);

  return (
    // Le calque fait la taille du tapis : le décaler d'un pourcentage le décale
    // donc d'une fraction de la table, et non de sa propre largeur.
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        animation: "var(--animate-ramasse)",
        ["--ramasse-x" as string]: `${trajet.x}%`,
        ["--ramasse-y" as string]: `${trajet.y}%`,
      }}
    >
      <span
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${pose.x}%`, top: `${pose.y + 9}%` }}
      >
        <ChipStack
          amount={vol.amount}
          max={3}
          animate={false}
          className="[--jeton-l:1.1rem] sm:[--jeton-l:1.3rem]"
        />
      </span>
    </span>
  );
}

/** Le pot quitte le centre et rejoint chaque gagnant pendant le récapitulatif. */
function GainsEnVol({ view, anchor }: { view: PokerView; anchor: number | null }) {
  if (view.phase !== "payout") return null;

  return view.seats
    .filter((seat) => (seat.won ?? 0) > 0)
    .map((seat) => {
      const place = anchor === null
        ? seat.seat
        : (seat.seat - anchor + view.maxSeats) % view.maxSeats;
      const pose = ovalPose(place, view.maxSeats);

      return (
        <span
          key={`${view.version}-${seat.seat}`}
          data-poker-payout-chip={seat.seat}
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            animation: "var(--animate-distribue)",
            ["--distribue-x" as string]: `${pose.x - 50}%`,
            ["--distribue-y" as string]: `${pose.y - 50}%`,
          }}
        >
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <ChipStack
              amount={seat.won ?? 0}
              max={4}
              animate={false}
              className="[--jeton-l:1.3rem] sm:[--jeton-l:1.6rem]"
            />
          </span>
        </span>
      );
    });
}

function Seat({
  seat,
  view,
  auTrait,
  place,
  estAncre,
  suivi,
  onFollow,
}: {
  seat: PokerSeatView;
  view: PokerView;
  auTrait: boolean;
  place: number;
  estAncre: boolean;
  suivi: boolean;
  onFollow?: ((userId: string | null) => void) | undefined;
}) {
  const couche = seat.status === "folded";
  const enPause = seat.status === "sitting-out" || seat.status === "waiting";
  const action = seatActionLabel(seat);
  const origine = dealOrigin(place, view.maxSeats);

  const contenu = (
    <div className={cn("flex flex-col items-center gap-1", couche && "opacity-45")}>
      {/* Les deux cartes privées. */}
      <div className="flex items-end justify-center gap-0.5">
        {seat.cards.map((carte, index) => (
          <PlayingCard
            key={index}
            card={carte}
            dealIndex={index}
            dealFromX={origine.x}
            dealFromY={origine.y}
            className={cn(
              "[--carte-l:1.8rem] sm:[--carte-l:2.3rem]",
              estAncre && "[--carte-l:2.4rem] sm:[--carte-l:3rem]",
              seat.bestCards?.some(
                (meilleure) => carte && meilleure.rank === carte.rank && meilleure.suit === carte.suit,
              ) && "rounded-[0.35rem] ring-2 ring-brass",
            )}
          />
        ))}
      </div>

      {/* La plaque : avatar, pseudo, tapis. L'anneau de temps entoure l'avatar
          du joueur au trait. */}
      <div
        className={cn(
          "flex w-full items-center gap-1.5 rounded-full border px-1.5 py-1 transition-colors",
          auTrait
            ? "border-brass bg-felt-high shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-brass)_22%,transparent)]"
            : "border-line bg-felt-deep/85",
          !seat.connected && "opacity-60",
        )}
      >
        {auTrait && view.deadlineAt && view.timerKind === "action" ? (
          <ProgressRing deadlineAt={view.deadlineAt} turnMs={view.timerMs ?? view.actionMs} size={40}>
            <Avatar
              userId={seat.userId}
              seed={seat.avatarSeed}
              pseudo={seat.pseudo}
              className="size-7 text-[0.65rem]"
            />
          </ProgressRing>
        ) : (
          <span className="grid size-10 shrink-0 place-items-center">
            <Avatar
              userId={seat.userId}
              seed={seat.avatarSeed}
              pseudo={seat.pseudo}
              className="size-7 text-[0.65rem]"
            />
          </span>
        )}
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[0.7rem] leading-tight text-cream">{seat.pseudo}</span>
          <span className="tabular block text-[0.7rem] font-semibold leading-tight text-brass">
            {formatCoins(seat.stack)}
          </span>
        </span>
        {enPause && <Pause className="size-3 shrink-0 text-cream-faint" aria-label="En pause" />}
      </div>

      {/* Bouton donneur, blindes, gain. */}
      <div className="flex flex-wrap items-center justify-center gap-1">
        {seat.isDealer && (
          <span
            aria-label="Donneur"
            className="grid size-4 place-items-center rounded-full bg-cream text-[0.5rem] font-black text-felt-deep"
          >
            D
          </span>
        )}
        {seat.isSmallBlind && <Plaque tone="neutre">PB</Plaque>}
        {seat.isBigBlind && <Plaque tone="neutre">GB</Plaque>}
        {seat.won !== null && seat.won > 0 && <Plaque tone="gain">+{formatCoins(seat.won)}</Plaque>}
      </div>

      {/* La mise engagée, posée devant le siège. */}
      {seat.committed > 0 && (
        <div className="flex items-center gap-1">
          <ChipStack
            amount={seat.committed}
            max={3}
            className="[--jeton-l:1.1rem] sm:[--jeton-l:1.3rem]"
          />
          <span className="tabular text-[0.7rem] text-cream-dim">{formatCoins(seat.committed)}</span>
        </div>
      )}

      {action && <p className="text-[0.65rem] uppercase tracking-wide text-cream-faint">{action}</p>}
      {seat.handLabel && (
        <p className="text-[0.65rem] font-semibold text-brass-bright">{seat.handLabel}</p>
      )}
      {seat.leavingAfterHand && (
        <p className="text-[0.62rem] text-cream-faint">Quitte en fin de coup</p>
      )}
    </div>
  );

  if (!onFollow) return contenu;

  // Un spectateur peut suivre n'importe quel joueur : la table pivote alors
  // pour se présenter de sa place.
  return (
    <button
      type="button"
      onClick={() => onFollow(suivi ? null : seat.userId)}
      aria-pressed={suivi}
      aria-label={suivi ? `Ne plus suivre ${seat.pseudo}` : `Suivre ${seat.pseudo}`}
      className={cn(
        "w-full rounded-2xl p-0.5 transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass",
        suivi ? "bg-brass/15 ring-1 ring-brass/50" : "hover:bg-cream/5",
      )}
    >
      {contenu}
    </button>
  );
}

function SeatLibre({
  place,
  onSit,
  enCours,
  disponible,
}: {
  place: number;
  onSit?: ((seat: number) => void) | undefined;
  enCours: boolean;
  disponible: boolean;
}) {
  if (!disponible || !onSit) {
    return (
      <div className="grid h-14 place-items-center rounded-xl border border-dashed border-line/70 text-[0.68rem] text-cream-faint">
        Place libre
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSit(place)}
      disabled={enCours}
      className={cn(
        "grid h-14 w-full place-items-center gap-0.5 rounded-xl border border-dashed border-line-strong",
        "text-[0.68rem] text-cream-dim transition-colors hover:border-brass hover:bg-brass/10 hover:text-cream",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass",
        enCours && "opacity-60",
      )}
    >
      <Layers className="size-3.5" aria-hidden />
      {enCours ? "…" : "S'asseoir"}
    </button>
  );
}
