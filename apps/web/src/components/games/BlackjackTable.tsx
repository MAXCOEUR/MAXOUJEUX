import { BLACKJACK_SHOE_DECKS } from "@maxoujeux/engines";
import {
  BLACKJACK_RANKS,
  BLACKJACK_SUITS,
  type BlackjackView,
} from "@maxoujeux/shared";
import { Eye } from "lucide-react";
import { ProgressRing } from "@/components/ProgressRing";
import { phaseDurationMs, phaseLabel, seatOrder } from "@/lib/blackjack-ui";
import { cn } from "@/lib/cn";
import { BlackjackSeat } from "./blackjack/BlackjackSeat";
import { PlayingCard } from "./blackjack/PlayingCard";

/** Taille du sabot neuf, pour la jauge d'usure. */
const SHOE_CARDS = BLACKJACK_SHOE_DECKS * BLACKJACK_RANKS.length * BLACKJACK_SUITS.length;

/**
 * La table de blackjack.
 *
 * Une vraie table est un ovale : le croupier debout d'un côté, les joueurs
 * assis en arc de l'autre. C'est ce que reproduit la disposition — chaque siège
 * est reculé et rapetissé selon sa place sur l'arc, et **le joueur est toujours
 * assis au milieu**, face au croupier. Sur téléphone l'arc est abandonné : cinq
 * places dans 360 pixels ne donnent pas une table, elles donnent des vignettes.
 *
 * Deux variables gouvernent toutes les tailles, `--carte-l` et `--jeton-l` :
 * cartes, index, cases de mise et piles en dépendent. Redimensionner la table
 * revient à changer deux nombres, jamais trente.
 */
interface TableProps {
  view: BlackjackView;
  /** Prise de place. Absent en rendu statique : les places ne sont alors pas cliquables. */
  onSit?: (seat: number) => void;
  /** Numéro de place demandée, réponse du serveur en attente. */
  sitting?: number | null;
}

export function BlackjackTable({ view, onSit, sitting = null }: TableProps) {
  const ordre = seatOrder(view.you, view.maxSeats);
  const seatAt = (index: number) => view.seats.find((seat) => seat.seat === index) ?? null;
  const dureePhase = phaseDurationMs(view.phase);
  const surLaTable = view.phase !== "players";

  return (
    <div
      className={cn(
        "bj-tapis plateau relative isolate mx-auto w-full max-w-4xl overflow-hidden",
        "border border-line-strong bg-felt p-3 shadow-2xl sm:px-6 sm:pb-9 sm:pt-5",
        "[--carte-l:clamp(2rem,5vw,3rem)] [--jeton-l:clamp(1.35rem,3.2vw,1.9rem)]",
      )}
      style={{
        // La lumière du plafonnier tombe sur le croupier, pas au centre
        // géométrique : c'est ce décentrage qui donne du relief au tapis.
        backgroundImage:
          "radial-gradient(60% 55% at 50% 8%, oklch(0.72 0.09 88 / 0.16), transparent 72%), radial-gradient(90% 70% at 50% 105%, oklch(0.28 0.05 155 / 0.55), transparent 70%)",
      }}
    >
      {/* Le rail de laiton : la tranche capitonnée d'une table de casino. */}
      <div aria-hidden className="bj-rail pointer-events-none absolute inset-1.5 border border-brass/20 sm:inset-2" />

      <Markings />

      <div className="relative flex items-start justify-between gap-2">
        <div className="flex w-16 shrink-0 flex-col items-center gap-1 sm:w-20">
          <PitClock
            phase={view.phase}
            deadlineAt={surLaTable ? view.deadlineAt : null}
            durationMs={surLaTable ? dureePhase : null}
            yourTurn={view.turn?.seat === view.you}
          />
          <Gallery count={view.watching} />
        </div>
        <Dealer view={view} />
        <Shoe remaining={view.shoeRemaining} />
      </div>

      {/* La bande de feutre entre le croupier et les cases de mise n'est pas du
          vide : c'est là que le croupier pose les cartes communes du sabot et
          que sont sérigraphiées les règles. Serrer les sièges contre le
          croupier ferait perdre la proportion d'une table. */}
      <div className="bj-arc relative mt-4 grid grid-cols-2 items-end gap-x-2 gap-y-4 sm:mt-14 sm:grid-cols-5 sm:gap-x-1">
        {ordre.map((seatIndex, place) => (
          <BlackjackSeat
            // La manche est dans la clé : au changement de manche tout le siège
            // est remonté, ce qui rejoue la donne et le paiement. Sans elle, les
            // cartes de la manche suivante apparaîtraient sans être distribuées.
            key={`${view.roundId ?? "vide"}-${seatIndex}`}
            seat={seatAt(seatIndex)}
            seatIndex={seatIndex}
            place={place}
            maxSeats={view.maxSeats}
            self={view.you === seatIndex}
            phase={view.phase}
            activeHand={view.turn?.seat === seatIndex ? view.turn.handIndex : null}
            deadlineAt={view.deadlineAt}
            turnMs={dureePhase}
            // Seul un spectateur peut s'asseoir. Proposer la chaise à qui en
            // occupe déjà une lui ferait croire qu'il peut jouer deux mains.
            onSit={onSit && view.you === null ? () => onSit(seatIndex) : null}
            sitting={sitting === seatIndex}
          />
        ))}
      </div>
    </div>
  );
}

/** Main du croupier. Sa carte fermée le reste jusqu'à ce que le serveur l'ouvre. */
function Dealer({ view }: { view: BlackjackView }) {
  const joue = view.phase === "dealer";

  return (
    <section className="bj-croupier min-w-0 flex-1 text-center" aria-label="Main du croupier">
      <p
        className={cn(
          "text-[0.6rem] font-bold uppercase tracking-[0.28em] transition-colors",
          joue ? "text-brass-bright" : "text-cream-faint",
        )}
      >
        Croupier
      </p>

      <div className="mt-1.5 flex min-h-[calc(var(--carte-l)*1.4)] items-start justify-center [&>*:not(:first-child)]:-ml-[calc(var(--carte-l)*0.56)]">
        {view.dealer.cards.length > 0 ? (
          view.dealer.cards.map((card, index) => (
            // La carte fermée garde la même clé une fois ouverte : c'est ce qui
            // fait qu'elle se **retourne** au lieu de disparaître et revenir.
            <PlayingCard key={index} card={card} dealIndex={index} dealFromX={110} />
          ))
        ) : (
          <span className="grid min-h-[calc(var(--carte-l)*1.4)] place-items-center text-[0.7rem] text-cream-faint">
            Sabot prêt
          </span>
        )}
      </div>

      {view.dealer.total !== null && (
        <span className="tabular mt-1 inline-block rounded-full border border-line-strong bg-felt-deep/70 px-2 py-px text-xs font-bold text-cream">
          {view.dealer.total}
        </span>
      )}
    </section>
  );
}

/**
 * Montre de table.
 *
 * L'anneau se pose sur qui est au trait. Pendant le tour des joueurs, c'est
 * l'avatar du joueur actif qui le porte — la montre n'affiche alors que le nom
 * de la phase. Deux anneaux qui tournent en même temps sur le même écran
 * donneraient deux réponses à « combien de temps me reste-t-il ».
 */
function PitClock({
  phase,
  deadlineAt,
  durationMs,
  yourTurn,
}: {
  phase: BlackjackView["phase"];
  deadlineAt: string | null;
  durationMs: number | null;
  yourTurn: boolean;
}) {
  const libelle = phaseLabel(phase, yourTurn);

  return (
    <div className="flex flex-col items-center gap-1">
      {deadlineAt && durationMs ? (
        <ProgressRing deadlineAt={deadlineAt} turnMs={durationMs} size={44} showSeconds>
          {/* Disque de fond seulement : une pastille au centre passerait
              derrière les secondes et les rendrait illisibles. */}
          <span
            aria-hidden
            className="size-8 rounded-full border border-brass/30 bg-felt-deep/80"
          />
        </ProgressRing>
      ) : (
        <span
          aria-hidden
          className="grid size-11 place-items-center rounded-full border border-brass/25 bg-felt-deep/60"
        >
          <span className="size-2.5 rounded-full bg-brass/40" />
        </span>
      )}
      <span className="text-center text-[0.58rem] font-semibold uppercase leading-tight tracking-[0.06em] text-cream-faint">
        {libelle}
      </span>
    </div>
  );
}

/**
 * Le sabot.
 *
 * Ce n'est pas un ornement : c'est de là que partent les cartes, et sa jauge
 * annonce le mélange à venir. Un joueur qui voit le sabot presque vide sait
 * qu'une pause arrive.
 */
function Shoe({ remaining }: { remaining: number }) {
  const part = Math.max(0, Math.min(1, remaining / SHOE_CARDS));

  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-1 sm:w-20">
      <span
        aria-hidden
        className="relative block h-11 w-8 overflow-hidden rounded-[0.3rem] border border-brass-deep bg-felt-deep shadow-[0_4px_10px_-4px_rgb(0_0_0/0.8)]"
        style={{ transform: "rotate(-7deg)" }}
      >
        <span
          className="absolute inset-x-0 bottom-0 block"
          style={{
            height: `${part * 100}%`,
            backgroundImage:
              "repeating-linear-gradient(to bottom, var(--color-dos) 0 2px, var(--color-dos-profond) 2px 3px)",
          }}
        />
        <span className="absolute inset-x-0 top-0 block h-1.5 bg-brass-deep/70" />
      </span>
      <span className="tabular text-center text-[0.58rem] leading-tight text-cream-faint">
        {remaining} cartes
      </span>
    </div>
  );
}

/**
 * Les spectateurs, en nombre.
 *
 * Un compteur et non une liste : savoir qu'on est regardé change la partie,
 * savoir par qui ne la change pas — et vingt pseudos mangeraient le tapis.
 *
 * Placé sous la montre de table, en pendant du compteur du sabot. Le coin
 * inférieur droit, qui semblait le bon endroit, est **avalé par la courbe** :
 * le tapis est en `overflow-hidden` et son rayon elliptique emporte les coins
 * du bas.
 */
function Gallery({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="inline-flex items-center gap-1 text-[0.58rem] leading-tight text-cream-faint">
      <Eye className="size-3 shrink-0" aria-hidden />
      {/* Un seul nœud de texte : deux `span` séparés par une gouttière se lisent
          « deux », « spectateurs » à la synthèse vocale, avec une pause entre. */}
      <span className="tabular">
        {count} {count > 1 ? "spectateurs" : "spectateur"}
      </span>
    </p>
  );
}

/**
 * Marquages du tapis.
 *
 * « Blackjack paie 3 pour 2 » et la règle du croupier sont sérigraphiées sur
 * toutes les tables du monde, et pour une raison : ce sont les deux seules
 * informations dont dépend une décision, et elles doivent être lisibles sans
 * demander. Ici elles remplacent une aide contextuelle qu'il faudrait ouvrir.
 *
 * Posées en position absolue et sous les sièges : c'est de la peinture sur le
 * feutre, pas un bandeau. Dans le flux, elles pousseraient les joueurs vers le
 * bas et la table cesserait d'avoir la proportion d'une table.
 *
 * Masquées sur téléphone, où la place manque et où le texte deviendrait
 * illisible avant d'être utile.
 */
function Markings() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 66"
      className="pointer-events-none absolute left-1/2 top-[25%] -z-10 hidden w-[min(60%,25rem)] -translate-x-1/2 sm:block"
    >
      <defs>
        <path id="bj-marque-haute" d="M 40 52 Q 200 2 360 52" fill="none" />
        <path id="bj-marque-basse" d="M 34 66 Q 200 18 366 66" fill="none" />
      </defs>
      <text
        fill="var(--color-brass)"
        fontSize="15"
        fontWeight="800"
        letterSpacing="3"
        textAnchor="middle"
        opacity="0.42"
        style={{ fontFamily: "var(--font-display)" }}
      >
        <textPath href="#bj-marque-haute" startOffset="50%">
          BLACKJACK PAIE 3 POUR 2
        </textPath>
      </text>
      <text
        fill="var(--color-cream-faint)"
        fontSize="8"
        letterSpacing="1.4"
        textAnchor="middle"
        opacity="0.6"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <textPath href="#bj-marque-basse" startOffset="50%">
          LE CROUPIER TIRE À 16, RESTE À 17
        </textPath>
      </text>
    </svg>
  );
}
