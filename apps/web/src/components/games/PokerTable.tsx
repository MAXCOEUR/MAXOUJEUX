import { formatCoins, type PokerSeatView, type PokerView } from "@maxoujeux/shared";
import { Avatar } from "@/components/Avatar";
import { Plaque } from "@/components/Plaque";
import { ProgressRing } from "@/components/ProgressRing";
import { PlayingCard } from "@/components/games/blackjack/PlayingCard";
import { ChipStack } from "@/components/games/casino/Chips";
import { cn } from "@/lib/cn";
import { dealOriginX, ovalPose, pokerSeatOrder, seatActionLabel } from "@/lib/poker-ui";

/**
 * La table de poker.
 *
 * Un ovale, les joueurs tout autour, le tableau et le pot au centre. Le
 * destinataire est **toujours en bas** : c'est la table qui tourne, pas lui.
 *
 * Les cartes des adversaires arrivent `null` du serveur — elles ne sont pas
 * masquées ici, elles n'existent tout simplement pas côté client tant que la
 * main n'est pas abattue.
 */
export function PokerTable({
  view,
  onSit,
  sitting,
}: {
  view: PokerView;
  onSit?: ((seat: number) => void) | undefined;
  sitting: number | null;
}) {
  const ordre = pokerSeatOrder(view.you, view.maxSeats);
  const parSiege = new Map(view.seats.map((seat) => [seat.seat, seat]));

  return (
    <div className="plateau relative mx-auto aspect-[4/3] w-full max-w-3xl sm:aspect-[16/10]">
      {/* Le tapis : un ovale de feutre cerclé de laiton. */}
      <div className="absolute inset-[6%] rounded-[50%] border-4 border-brass-deep bg-felt shadow-[inset_0_0_60px_rgb(0_0_0/0.55)]">
        <div className="absolute inset-[7%] rounded-[50%] border border-line/70" />
      </div>

      {/* Le centre : tableau, pot, phase. */}
      <div className="absolute inset-x-[18%] top-1/2 -translate-y-1/2 text-center">
        <div className="flex min-h-[var(--carte-l)] items-center justify-center gap-1.5">
          {view.board.map((carte, index) => (
            <PlayingCard
              // Clé stable : la carte se **retourne** à la révélation au lieu
              // d'être remontée, ce qui rejouerait la distribution.
              key={index}
              card={carte}
              dealIndex={index}
              dealFromX={0}
              className="[--carte-l:2.6rem] sm:[--carte-l:3.4rem]"
            />
          ))}
          {view.board.length === 0 && (
            <p className="text-xs uppercase tracking-[0.2em] text-cream-faint">
              {view.phase === "waiting" ? "Table ouverte" : "Distribution"}
            </p>
          )}
        </div>

        {view.potTotal > 0 && (
          <div className="mt-3 flex flex-col items-center gap-1">
            <ChipStack amount={view.potTotal} max={4} />
            <p className="tabular font-display text-sm font-bold text-brass">
              {formatCoins(view.potTotal)}
            </p>
            {view.pots.length > 1 && (
              <p className="text-[0.7rem] text-cream-faint">
                {view.pots.length} pots — tapis inégaux
              </p>
            )}
          </div>
        )}
      </div>

      {/* Les sièges, répartis sur l'ovale. */}
      {ordre.map((place, index) => {
        const pose = ovalPose(index, view.maxSeats);
        const siege = parSiege.get(place) ?? null;

        return (
          <div
            key={place}
            className="absolute w-[26%] max-w-[9rem] -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pose.x}%`, top: `${pose.y}%`, scale: pose.scale }}
          >
            {siege ? (
              <Seat
                seat={siege}
                view={view}
                auTrait={view.turn === siege.seat}
                place={index}
                estMoi={siege.seat === view.you}
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

function Seat({
  seat,
  view,
  auTrait,
  place,
  estMoi,
}: {
  seat: PokerSeatView;
  view: PokerView;
  auTrait: boolean;
  place: number;
  estMoi: boolean;
}) {
  const couche = seat.status === "folded";
  const action = seatActionLabel(seat);

  return (
    <div className={cn("flex flex-col items-center gap-1", couche && "opacity-45")}>
      {/* Les deux cartes privées. */}
      <div className="flex items-end justify-center gap-0.5">
        {seat.cards.map((carte, index) => (
          <PlayingCard
            key={index}
            card={carte}
            dealIndex={index}
            dealFromX={dealOriginX(place, view.maxSeats)}
            className={cn(
              "[--carte-l:1.9rem] sm:[--carte-l:2.4rem]",
              estMoi && "[--carte-l:2.4rem] sm:[--carte-l:3rem]",
              seat.bestCards?.some(
                (meilleure) => carte && meilleure.rank === carte.rank && meilleure.suit === carte.suit,
              ) && "ring-2 ring-brass rounded-[0.35rem]",
            )}
          />
        ))}
      </div>

      {/* La plaque : avatar, pseudo, tapis. L'anneau de temps entoure l'avatar
          du joueur au trait. */}
      <div
        className={cn(
          "flex w-full items-center gap-1.5 rounded-full border px-1.5 py-1 transition-colors",
          auTrait ? "border-brass bg-felt-high" : "border-line bg-felt-deep/80",
        )}
      >
        {auTrait && view.deadlineAt ? (
          <ProgressRing deadlineAt={view.deadlineAt} turnMs={view.actionMs} size={26}>
            <Avatar userId={seat.userId} seed={seat.avatarSeed} pseudo={seat.pseudo} className="size-5 text-[0.5rem]" />
          </ProgressRing>
        ) : (
          <Avatar userId={seat.userId} seed={seat.avatarSeed} pseudo={seat.pseudo} className="size-6 text-[0.55rem]" />
        )}
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[0.7rem] leading-tight text-cream">{seat.pseudo}</span>
          <span className="tabular block text-[0.7rem] leading-tight text-brass">
            {formatCoins(seat.stack)}
          </span>
        </span>
      </div>

      {/* Bouton donneur et blindes. */}
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
          <ChipStack amount={seat.committed} max={3} />
          <span className="tabular text-[0.7rem] text-cream-dim">{formatCoins(seat.committed)}</span>
        </div>
      )}

      {action && (
        <p className="text-[0.65rem] uppercase tracking-wide text-cream-faint">{action}</p>
      )}
      {seat.handLabel && (
        <p className="text-[0.65rem] font-semibold text-brass-bright">{seat.handLabel}</p>
      )}
    </div>
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
      <div className="grid h-14 place-items-center rounded-xl border border-dashed border-line text-[0.7rem] text-cream-faint">
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
        "grid h-14 w-full place-items-center rounded-xl border border-dashed border-line-strong",
        "text-[0.7rem] text-cream-dim transition-colors hover:border-brass hover:text-cream",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass",
        enCours && "opacity-60",
      )}
    >
      {enCours ? "…" : "S'asseoir"}
    </button>
  );
}
