import { formatCoins, type BlackjackCard, type BlackjackSeatView, type BlackjackView } from "@maxoujeux/shared";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";

const RANK_NAMES: Record<BlackjackCard["rank"], string> = {
  A: "As", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7",
  "8": "8", "9": "9", "10": "10", J: "Valet", Q: "Dame", K: "Roi",
};
const SUIT_NAMES: Record<BlackjackCard["suit"], string> = {
  clubs: "trèfle", diamonds: "carreau", hearts: "cœur", spades: "pique",
};
const SUIT_GLYPHS: Record<BlackjackCard["suit"], string> = {
  clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠",
};

function PlayingCard({ card }: { card: BlackjackCard | null }) {
  if (!card) {
    return (
      <span
        aria-label="Carte fermée"
        className="grid aspect-[5/7] w-11 place-items-center rounded-md border border-brass/60 bg-[repeating-linear-gradient(135deg,#5b171c_0_4px,#2b0d10_4px_8px)] shadow-lg sm:w-14"
      >
        <span aria-hidden className="size-5 rounded-full border border-brass/60" />
      </span>
    );
  }
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return (
    <span
      aria-label={`${RANK_NAMES[card.rank]} de ${SUIT_NAMES[card.suit]}`}
      className={cn(
        "relative grid aspect-[5/7] w-11 place-items-center rounded-md border border-cream-dim bg-cream text-lg font-black shadow-lg sm:w-14",
        red ? "text-danger" : "text-felt-deep",
      )}
    >
      <span className="absolute left-1 top-0.5 text-xs leading-none">{card.rank}</span>
      <span aria-hidden>{SUIT_GLYPHS[card.suit]}</span>
    </span>
  );
}

function Seat({ seat, index, active, self }: { seat: BlackjackSeatView | null; index: number; active: boolean; self: boolean }) {
  return (
    <section
      data-blackjack-seat={index}
      aria-label={seat ? `Place ${index + 1}, ${seat.pseudo}` : `Place ${index + 1}, libre`}
      className={cn(
        "min-w-0 rounded-2xl border bg-felt-deep/65 p-2 text-center transition-[border-color,transform,box-shadow] sm:p-3",
        active ? "border-win shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-win)_25%,transparent)] sm:-translate-y-1" : "border-line",
        self && "ring-1 ring-brass/70",
      )}
    >
      {!seat ? (
        <div className="grid min-h-24 place-items-center text-xs text-cream-faint">Place libre</div>
      ) : (
        <>
          <div className="flex items-center justify-center gap-2">
            <Avatar seed={seat.avatarSeed} pseudo={seat.pseudo} className="size-7 text-[10px]" />
            <span className="max-w-24 truncate text-xs font-semibold text-cream">{seat.pseudo}{self ? " · toi" : ""}</span>
            {!seat.connected && <span className="size-1.5 rounded-full bg-danger" aria-label="Déconnecté" />}
          </div>
          <p className="mt-1 text-[10px] text-brass">
            {seat.totalWager > 0 ? `${formatCoins(seat.totalWager)} engagés` : "En attente"}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {seat.hands.map((hand, handIndex) => (
              <div key={handIndex} className={cn("rounded-lg p-1", active && "bg-win/10")}>
                <div className="flex -space-x-5">
                  {hand.cards.map((card, cardIndex) => <PlayingCard key={cardIndex} card={card} />)}
                </div>
                <p className="mt-1 text-[10px] text-cream-dim">
                  {hand.total} · {formatCoins(hand.wager)}
                </p>
              </div>
            ))}
          </div>
          {seat.roundNet !== null && (
            <p className={cn("mt-1 text-xs font-bold", seat.roundNet >= 0 ? "text-win" : "text-danger") }>
              {seat.roundNet >= 0 ? "+" : ""}{formatCoins(seat.roundNet)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function BlackjackTable({ view }: { view: BlackjackView }) {
  const seatAt = (index: number) => view.seats.find((seat) => seat.seat === index) ?? null;
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-line-strong bg-felt p-3 shadow-2xl sm:p-6">
      <div aria-hidden className="pointer-events-none absolute inset-3 rounded-[1.5rem] border border-brass/15" />
      <section className="relative text-center" aria-label="Main du croupier">
        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cream-faint">Croupier</p>
        <div className="mt-2 flex min-h-20 justify-center -space-x-4">
          {view.dealer.cards.length > 0
            ? view.dealer.cards.map((card, index) => <PlayingCard key={index} card={card} />)
            : <span className="grid min-h-16 place-items-center text-xs text-cream-faint">En attente des mises</span>}
        </div>
        {view.dealer.total !== null && <p className="mt-1 tabular text-sm font-bold text-cream">{view.dealer.total}</p>}
      </section>

      <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className={cn(index === 4 && "col-span-2 mx-auto w-1/2 sm:col-span-1 sm:mx-0 sm:w-auto")}>
            <Seat
              seat={seatAt(index)}
              index={index}
              active={view.turn?.seat === index}
              self={view.you === index}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
