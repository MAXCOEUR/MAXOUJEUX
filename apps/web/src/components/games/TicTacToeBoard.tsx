import type { Cell, MatchView, Seat } from "@maxoujeux/shared";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/motion";

interface BoardProps {
  match: MatchView;
  you: Seat | null;
  playable: boolean;
  pending: number | null;
  onPlay: (move: number) => void;
}

const MARK_COLORS: Record<Seat, string> = {
  0: "var(--color-game-connect4)",
  1: "var(--color-game-tictactoe)",
};

const MARK_NAMES: Record<Seat, string> = { 0: "croix", 1: "cercle" };

/**
 * Plateau de Morpion.
 *
 * Neuf cases justifient une navigation aux flèches, contrairement au Puissance 4
 * où le coup se désigne par une colonne : `role="grid"`, une seule case
 * tabulable, déplacement aux flèches. Sans bouclage — plus prévisible quand on
 * ne voit pas l'écran.
 *
 * Les marques sont **tracées en SVG** et non écrites en caractères : un X
 * typographique change de dessin selon la police et ne peut pas s'animer au
 * trait.
 */
export function TicTacToeBoard({ match, you, playable, pending, onPlay }: BoardProps) {
  const reduced = useReducedMotion();
  const [focused, setFocused] = useState(() => match.cells.findIndex((cell) => cell === null));
  const [refused, setRefused] = useState<number | null>(null);

  const animatedVersion = useRef<number>(-1);
  const animate = match.lastMove !== null && animatedVersion.current !== match.version;
  useEffect(() => {
    animatedVersion.current = match.version;
  }, [match.version]);

  function attempt(index: number) {
    if (!playable) return;
    if ((match.cells[index] ?? null) !== null) {
      setRefused(index);
      window.setTimeout(() => setRefused(null), 400);
      return;
    }
    onPlay(index);
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const row = Math.floor(index / 3);
    const col = index % 3;
    let next: number | null = null;

    switch (event.key) {
      case "ArrowRight":
        next = col < 2 ? index + 1 : null;
        break;
      case "ArrowLeft":
        next = col > 0 ? index - 1 : null;
        break;
      case "ArrowDown":
        next = row < 2 ? index + 3 : null;
        break;
      case "ArrowUp":
        next = row > 0 ? index - 3 : null;
        break;
      case "Home":
        next = row * 3;
        break;
      case "End":
        next = row * 3 + 2;
        break;
      default:
        return;
    }

    if (next === null) return;
    event.preventDefault();
    setFocused(next);
    // Le focus suit la case active : sans cela, les flèches déplaceraient un
    // curseur invisible.
    (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }

  // Une seule case reste tabulable : la dernière visitée, ou la première libre.
  const tabbable = focused >= 0 ? focused : 0;

  return (
    <div
      role="grid"
      aria-label="Plateau de Morpion"
      className="plateau relative mx-auto grid aspect-square w-full max-w-[min(88vw,22rem)] grid-cols-3 gap-1.5 landscape:max-h-[58dvh] landscape:w-auto"
    >
      {match.cells.map((cell, index) => (
        <button
          key={index}
          type="button"
          role="gridcell"
          tabIndex={index === tabbable ? 0 : -1}
          aria-disabled={!playable || cell !== null}
          aria-label={cellLabel(index, cell, match)}
          onClick={() => attempt(index)}
          onFocus={() => setFocused(index)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={cn(
            "panel-plat grid touch-manipulation place-items-center p-2",
            playable && cell === null && "panel-interactif cursor-pointer",
            match.winningLine?.includes(index) && "border-cream/60 bg-felt-high/60",
            refused === index && !reduced && "animate-[tremble_0.36s_ease-in-out]",
          )}
        >
          {cell !== null && (
            <Mark
              seat={cell}
              animate={animate && match.lastMove?.index === index && !reduced}
              winning={match.winningLine?.includes(index) ?? false}
            />
          )}
          {pending === index && (
            <span aria-hidden className="animate-pulse-soft size-3 rounded-full bg-cream-faint" />
          )}
        </button>
      ))}
      {/* La couleur du joueur est rappelée par la marque elle-même ; `you` sert
          à ne pas afficher de survol quand on regarde sans jouer. */}
      <span className="sr-only">
        {you === null ? "Tu observes cette partie." : `Tu joues les ${MARK_NAMES[you]}.`}
      </span>
    </div>
  );
}

/** X ou O, tracés au feutre. `pathLength="1"` rend le décalage indépendant de la taille. */
function Mark({
  seat,
  animate,
  winning,
}: {
  seat: Seat;
  animate: boolean;
  winning: boolean;
}) {
  const color = MARK_COLORS[seat];
  const style = animate
    ? { strokeDasharray: 1, animation: "var(--animate-trace)" }
    : undefined;

  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      className={cn("size-[72%]", winning && "animate-lueur")}
      fill="none"
      stroke={color}
      strokeWidth={11}
      strokeLinecap="round"
    >
      {seat === 0 ? (
        <>
          <path d="M24 24 L76 76" pathLength={1} style={style} />
          <path
            d="M76 24 L24 76"
            pathLength={1}
            style={style ? { ...style, animationDelay: "140ms" } : undefined}
          />
        </>
      ) : (
        <circle cx="50" cy="50" r="27" pathLength={1} style={style} />
      )}
    </svg>
  );
}

function cellLabel(index: number, cell: Cell, match: MatchView): string {
  const row = Math.floor(index / 3) + 1;
  const col = (index % 3) + 1;
  if (cell === null) return `Ligne ${row}, colonne ${col} — vide`;

  const owner = match.seats.find((seat) => seat.seat === cell);
  return `Ligne ${row}, colonne ${col} — ${MARK_NAMES[cell]} de ${owner?.pseudo ?? "l'adversaire"}`;
}
