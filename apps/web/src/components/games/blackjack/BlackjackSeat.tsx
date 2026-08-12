import {
  BLACKJACK_IDLE_ROUNDS_MAX,
  formatCoins,
  formatCoinsDelta,
  type BlackjackHandView,
  type BlackjackPhase,
  type BlackjackSeatView,
} from "@maxoujeux/shared";
import { UserPlus, WifiOff } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { ProgressRing } from "@/components/ProgressRing";
import { arcPose, dealOriginX, handVerdict } from "@/lib/blackjack-ui";
import { cn } from "@/lib/cn";
import { ChipStack } from "@/components/games/casino/Chips";
import { PlayingCard } from "./PlayingCard";

interface SeatProps {
  /** `null` : la place est libre. */
  seat: BlackjackSeatView | null;
  /** Numéro de siège réel — celui qui est annoncé, indépendant de la place sur l'arc. */
  seatIndex: number;
  /** Place occupée sur l'arc, de la gauche vers la droite. */
  place: number;
  maxSeats: number;
  self: boolean;
  phase: BlackjackPhase;
  /** Index de la main en train de jouer à ce siège, `null` sinon. */
  activeHand: number | null;
  /** Échéance du tour, quand c'est à ce siège de jouer. */
  deadlineAt: string | null;
  turnMs: number | null;
  /** Le spectateur peut-il s'asseoir ici ? `null` : il a déjà une place. */
  onSit: (() => void) | null;
  /** Prise de place émise, réponse du serveur en attente. */
  sitting: boolean;
}

/**
 * Un siège de la table.
 *
 * De haut en bas, dans l'ordre où l'œil les cherche sur une vraie table : les
 * mains, la case de mise, puis le joueur. L'ordre inverse — le joueur au-dessus
 * de ses cartes — obligerait à sauter par-dessus le nom pour lire un total.
 */
export function BlackjackSeat({
  seat,
  seatIndex,
  place,
  maxSeats,
  self,
  phase,
  activeHand,
  deadlineAt,
  turnMs,
  onSit,
  sitting,
}: SeatProps) {
  const pose = arcPose(place, maxSeats);
  const actif = activeHand !== null;

  return (
    <div
      data-arc
      data-self={self || undefined}
      data-blackjack-seat={seatIndex}
      aria-label={seat ? `Place ${seatIndex + 1}, ${seat.pseudo}` : `Place ${seatIndex + 1}, libre`}
      className={cn(
        "flex min-w-0 flex-col items-center gap-1.5",
        // Sur téléphone, le siège du joueur passe en premier et prend toute la
        // largeur : c'est le seul dont il doit lire les cartes en un coup d'œil.
        self ? "order-first col-span-2 sm:order-none sm:col-span-1" : "col-span-1",
      )}
      style={{ ["--arc-y" as string]: pose.y, ["--arc-s" as string]: pose.scale }}
    >
      {!seat ? (
        <EmptySeat seatIndex={seatIndex} onSit={onSit} sitting={sitting} />
      ) : (
        <>
          <div className="flex min-h-[calc(var(--carte-l)*1.4)] items-end justify-center gap-2 sm:gap-3">
            {seat.hands.length === 0 ? (
              <p className="pb-2 text-[0.7rem] text-cream-faint">
                {seat.participating ? "Mise engagée" : "Attend la donne"}
              </p>
            ) : (
              seat.hands.map((hand, index) => (
                <Hand
                  key={index}
                  hand={hand}
                  index={index}
                  total={seat.hands.length}
                  place={place}
                  maxSeats={maxSeats}
                  active={activeHand === index}
                  yours={self}
                />
              ))
            )}
          </div>

          <Nameplate
            seat={seat}
            self={self}
            actif={actif}
            phase={phase}
            deadlineAt={actif ? deadlineAt : null}
            turnMs={turnMs}
          />
        </>
      )}
    </div>
  );
}

/**
 * Une chaise vide.
 *
 * Pour un spectateur, c'est un bouton : c'est le geste réel — on désigne la
 * chaise où l'on veut s'asseoir. Pour un joueur déjà assis, ce n'est qu'une
 * marque sur le tapis, et un bouton mort qui refuse le clic vaudrait moins
 * qu'une absence de bouton.
 */
function EmptySeat({
  seatIndex,
  onSit,
  sitting,
}: {
  seatIndex: number;
  onSit: (() => void) | null;
  sitting: boolean;
}) {
  if (!onSit) {
    return (
      <div className="flex flex-col items-center gap-2 py-2 opacity-45">
        <span
          aria-hidden
          className="grid aspect-square w-[calc(var(--jeton-l)*1.5)] place-items-center rounded-full border border-dashed border-line-strong"
        />
        <span className="text-[0.65rem] uppercase tracking-[0.18em] text-cream-faint">Libre</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSit}
      aria-busy={sitting || undefined}
      aria-label={`S'asseoir à la place ${seatIndex + 1}`}
      className={cn(
        "group flex min-h-11 flex-col items-center gap-1.5 rounded-xl px-2 py-2",
        "transition-[background-color,transform] duration-150",
        "hover:bg-brass/10 active:translate-y-px",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid aspect-square w-[calc(var(--jeton-l)*1.5)] place-items-center rounded-full",
          "border border-dashed border-brass/50 text-brass transition-colors",
          "group-hover:border-brass group-hover:bg-brass/10",
        )}
      >
        <UserPlus className="size-3.5" />
      </span>
      <span className="text-[0.62rem] font-semibold uppercase leading-tight tracking-[0.1em] text-brass">
        {sitting ? "…" : "S'asseoir"}
      </span>
    </button>
  );
}

/**
 * Une main : les cartes, le total, la case de mise.
 *
 * Quand le joueur a séparé, plusieurs mains cohabitent et **une seule** est
 * jouable. Trois marques la désignent plutôt qu'une : le liseré laiton qui
 * respire, le numéro de main affiché en toutes lettres, et l'effacement des
 * autres mains. Un seul de ces signaux se rate — c'est le reproche fait à la
 * première version, où rien ne distinguait la main active.
 */
function Hand({
  hand,
  index,
  total,
  place,
  maxSeats,
  active,
  yours,
}: {
  hand: BlackjackHandView;
  index: number;
  total: number;
  place: number;
  maxSeats: number;
  active: boolean;
  yours: boolean;
}) {
  const separee = total > 1;
  const verdict = handVerdict(hand.status);
  const sautee = hand.status === "busted";

  return (
    <div
      className={cn(
        "relative flex flex-col items-center gap-1 rounded-xl px-1.5 pb-1 pt-1 transition-[opacity,transform] duration-300",
        separee && !active && "scale-[0.88] opacity-55",
        sautee && "opacity-70",
      )}
      aria-current={active ? "step" : undefined}
    >
      {active && (
        <span
          aria-hidden
          className="animate-lueur pointer-events-none absolute inset-0 rounded-xl ring-2 ring-brass"
        />
      )}

      {separee && (
        <span
          className={cn(
            "relative whitespace-nowrap rounded px-1.5 text-[0.58rem] font-bold uppercase leading-tight tracking-[0.08em]",
            active ? "bg-brass text-felt-deep" : "text-cream-faint",
          )}
        >
          Main {index + 1}
          {/* Le liseré et le remplissage laiton disent « c'est ici » à l'œil ;
              cette phrase le dit au lecteur d'écran, qui ne voit ni l'un ni
              l'autre. Deux canaux pour une information dont dépend le coup. */}
          {active && <span className="sr-only">, à jouer</span>}
        </span>
      )}

      <div className="relative flex [&>*:not(:first-child)]:-ml-[calc(var(--carte-l)*0.56)]">
        {hand.cards.map((card, cardIndex) => (
          <PlayingCard
            key={cardIndex}
            card={card}
            dealIndex={cardIndex}
            dealFromX={dealOriginX(place, maxSeats)}
          />
        ))}

        {verdict && (
          <span
            className={cn(
              "animate-verdict pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
              "whitespace-nowrap rounded border px-1 py-0.5 text-[0.55rem] font-black uppercase tracking-[0.06em]",
              "backdrop-blur-[1px]",
              verdict.tone === "gain"
                ? "border-brass bg-felt-deep/85 text-brass-bright"
                : verdict.tone === "perte"
                  ? "border-danger bg-felt-deep/85 text-danger"
                  : "border-line-strong bg-felt-deep/85 text-cream-dim",
            )}
          >
            {verdict.label}
          </span>
        )}
      </div>

      <HandTotal hand={hand} active={active} />

      {hand.wager > 0 && (
        <span className="relative flex flex-col items-center">
          <span
            aria-hidden
            className={cn(
              "grid aspect-square w-[calc(var(--jeton-l)*1.55)] place-items-center rounded-full border border-dashed",
              active ? "border-brass/70" : "border-brass/25",
            )}
          >
            <ChipStack amount={hand.wager} max={4} />
          </span>
          <span className="tabular mt-0.5 text-[0.6rem] text-brass">{formatCoins(hand.wager)}</span>
          <span className="sr-only">
            {yours ? "Ta mise" : "Mise"} sur la main {index + 1} : {formatCoins(hand.wager)}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * Total de la main.
 *
 * Une main molle affiche ses deux lectures — « 7 / 17 » pour As-6 — tant
 * qu'elle est en jeu : c'est l'information dont dépend la décision de tirer, et
 * la calculer de tête est exactement ce que la table dispense de faire.
 */
function HandTotal({ hand, active }: { hand: BlackjackHandView; active: boolean }) {
  if (hand.cards.length === 0) return null;
  const molle = hand.soft && hand.status === "playing" && hand.total <= 21;
  const sautee = hand.status === "busted";

  return (
    <span
      className={cn(
        "tabular relative rounded-full border px-2 py-px text-[0.7rem] font-bold leading-tight",
        sautee
          ? "border-danger/60 bg-danger/15 text-danger"
          : active
            ? "border-brass/60 bg-brass/15 text-brass-bright"
            : "border-line-strong bg-felt-deep/70 text-cream",
      )}
    >
      {molle ? `${hand.total - 10} / ${hand.total}` : hand.total}
    </span>
  );
}

/** Deuxième ligne de la plaque : ce que ce joueur fait de sa manche. */
function SeatStatus({ seat, phase }: { seat: BlackjackSeatView; phase: BlackjackPhase }) {
  if (seat.roundNet !== null) {
    return (
      <span
        className={cn(
          "tabular block text-[0.68rem] font-bold leading-tight",
          seat.roundNet > 0 ? "text-win" : seat.roundNet < 0 ? "text-danger" : "text-cream-dim",
        )}
      >
        {seat.roundNet === 0 ? "Mise rendue" : formatCoinsDelta(seat.roundNet)}
      </span>
    );
  }

  if (seat.standingAfterRound) {
    return (
      <span className="block text-[0.66rem] leading-tight text-cream-faint">
        Se lève après la manche
      </span>
    );
  }

  return (
    <span className="tabular block text-[0.68rem] leading-tight text-cream-faint">
      {seat.totalWager > 0
        ? formatCoins(seat.totalWager)
        : phase === "betting" || phase === "idle"
          ? "Pas encore misé"
          : "Passe cette manche"}
    </span>
  );
}

/** Plaque du joueur : avatar cerclé du temps restant, pseudo, gain de la manche. */
function Nameplate({
  seat,
  self,
  actif,
  phase,
  deadlineAt,
  turnMs,
}: {
  seat: BlackjackSeatView;
  self: boolean;
  actif: boolean;
  phase: BlackjackPhase;
  deadlineAt: string | null;
  turnMs: number | null;
}) {
  const anneau = actif && deadlineAt !== null && turnMs !== null;

  return (
    <div
      className={cn(
        "relative flex min-w-0 max-w-full items-center gap-2 rounded-full border px-2 py-1 transition-colors",
        actif
          ? "border-brass/70 bg-brass/10"
          : self
            ? "border-line-strong bg-felt-deep/70"
            : "border-line bg-felt-deep/50",
      )}
    >
      {anneau && deadlineAt && turnMs ? (
        <ProgressRing deadlineAt={deadlineAt} turnMs={turnMs} size={40}>
          <Avatar seed={seat.avatarSeed} pseudo={seat.pseudo} className="size-7 text-[0.65rem]" />
        </ProgressRing>
      ) : (
        <span className="grid size-10 shrink-0 place-items-center">
          <Avatar seed={seat.avatarSeed} pseudo={seat.pseudo} className="size-7 text-[0.65rem]" />
        </span>
      )}

      <span className="min-w-0">
        <span className="flex items-center gap-1">
          <span className="truncate text-[0.72rem] font-semibold text-cream">{seat.pseudo}</span>
          {self && <span className="shrink-0 text-[0.62rem] text-brass">toi</span>}
          {!seat.connected && <WifiOff className="size-3 shrink-0 text-danger" aria-label="Déconnecté" />}
        </span>

        <SeatStatus seat={seat} phase={phase} />

        {/* Le préavis d'éviction. Un joueur levé sans avertissement conclura à
            un bug ; il lui faut une manche pour réagir. */}
        {seat.roundNet === null
          && !seat.standingAfterRound
          && seat.idleRounds >= BLACKJACK_IDLE_ROUNDS_MAX - 1 && (
          <span className="block text-[0.62rem] font-semibold leading-tight text-danger">
            Mise ou tu perds ta place
          </span>
        )}
      </span>

      {/* Les jetons gagnés remontent vers le solde de l'en-tête. Monté une fois
          par manche réglée, donc joué une fois : la clé de la manche est portée
          par la table, qui remonte tout le siège au changement de manche. */}
      {seat.roundNet !== null && seat.roundNet > 0 && (
        <span
          aria-hidden
          className="animate-encaisse tabular pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-black text-brass-bright"
        >
          {formatCoinsDelta(seat.roundNet)}
        </span>
      )}
    </div>
  );
}
