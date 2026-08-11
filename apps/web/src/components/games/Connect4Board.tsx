import { C4_COLS, C4_ROWS, dropRow } from "@maxoujeux/engines";
import type { Cell, MatchView, Seat } from "@maxoujeux/shared";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/motion";

interface BoardProps {
  match: MatchView;
  /** Siège du joueur, `null` s'il ne joue pas. */
  you: Seat | null;
  /** Le plateau accepte-t-il un coup ? */
  playable: boolean;
  /** Coup émis, réponse en attente : la colonne est marquée. */
  pending: number | null;
  onPlay: (move: number) => void;
}

/** Couleur d'un disque. Le siège 0 prend le rouge du jeu, le siège 1 le doré. */
const DISC_COLORS: Record<Seat, string> = {
  0: "var(--color-game-connect4)",
  1: "var(--color-game-motus)",
};

/**
 * Plateau de Puissance 4.
 *
 * Quatre couches superposées :
 * 1. le fond du plateau ;
 * 2. les 42 disques, en grille ;
 * 3. un cadre percé en SVG, qui passe **par-dessus** les disques — c'est lui qui
 *    rend la chute crédible, le disque n'apparaissant que dans les trous ;
 * 4. sept boutons de colonne pleine hauteur.
 *
 * Les boutons couvrent toute la hauteur, ce qui donne une cible tactile énorme
 * (45 px de large à 320 px de viewport, au-dessus du minimum de 44) **et**
 * résout l'accessibilité clavier : sept boutons tabulables valent mieux que
 * quarante-deux cases à parcourir aux flèches, puisque le coup se désigne de
 * toute façon par une colonne.
 */
export function Connect4Board({ match, you, playable, pending, onPlay }: BoardProps) {
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState<number | null>(null);
  const [refused, setRefused] = useState<number | null>(null);

  // On n'anime que le dernier coup, et une seule fois. Sans cette mémoire, un
  // état de resynchronisation ferait retomber les quarante-deux disques.
  const animatedVersion = useRef<number>(-1);
  const animate = match.lastMove !== null && animatedVersion.current !== match.version;
  useEffect(() => {
    animatedVersion.current = match.version;
  }, [match.version]);

  function attempt(col: number) {
    if (!playable) return;
    if (dropRow(match.cells, col) === null) {
      // Un refus silencieux se lit comme une interface cassée.
      setRefused(col);
      window.setTimeout(() => setRefused(null), 400);
      return;
    }
    onPlay(col);
  }

  const ghostSeat = you;

  return (
    <div className="plateau relative mx-auto aspect-[7/6] w-full max-w-[min(94vw,34rem)] landscape:max-h-[62dvh] landscape:w-auto">
      {/* 1. Fond du plateau. */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-2xl bg-felt-raised shadow-[inset_0_2px_0_rgb(255_255_255/0.05),inset_0_-10px_24px_rgb(0_0_0/0.5)]"
      />

      {/* 2. Les disques. `overflow-hidden` : le disque en chute doit sembler
             entrer par le haut du plateau, pas surgir au-dessus. */}
      <div className="absolute inset-0 grid grid-cols-7 overflow-hidden rounded-2xl">
        {match.cells.map((cell, index) => (
          <Disc
            key={index}
            cell={cell}
            index={index}
            winning={match.winningLine?.includes(index) ?? false}
            animate={animate && match.lastMove?.index === index && !reduced}
          />
        ))}
      </div>

      {/* 3. Cadre percé : un rectangle plein dont un masque retire 42 disques. */}
      <BoardFrame />

      {/* 4. Boutons de colonne. */}
      <div className="absolute inset-0 grid grid-cols-7">
        {Array.from({ length: C4_COLS }, (_, col) => {
          const free = dropRow(match.cells, col);
          const full = free === null;
          const isPending = pending === col;

          return (
            <button
              key={col}
              type="button"
              // `aria-disabled` et non `disabled` : un bouton désactivé sort de
              // l'ordre de tabulation, et un joueur au clavier ne pourrait plus
              // parcourir les colonnes pleines pour comprendre le plateau.
              aria-disabled={!playable || full}
              aria-label={columnLabel(col, match.cells, full)}
              onClick={() => attempt(col)}
              onPointerEnter={() => setHovered(col)}
              onPointerLeave={() => setHovered((current) => (current === col ? null : current))}
              onFocus={() => setHovered(col)}
              onBlur={() => setHovered((current) => (current === col ? null : current))}
              className={cn(
                "relative h-full touch-manipulation rounded-lg",
                "focus-visible:outline-offset-[-3px]",
                playable && !full ? "cursor-pointer" : "cursor-default",
                refused === col && !reduced && "animate-[tremble_0.36s_ease-in-out]",
              )}
            >
              {/* Disque fantôme au survol. La variante `hover:` de Tailwind v4
                  est déjà encapsulée dans `@media (hover: hover)` : pas de
                  survol collant après un appui sur téléphone. */}
              {playable && !full && hovered === col && ghostSeat !== null && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-[2%] aspect-square w-[72%] -translate-x-1/2 rounded-full opacity-40"
                  style={{ backgroundColor: DISC_COLORS[ghostSeat] }}
                />
              )}

              {isPending && (
                <span
                  aria-hidden
                  className="animate-pulse-soft pointer-events-none absolute inset-x-2 top-1 h-1 rounded-full bg-cream-faint"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Un disque, ou un trou vide. */
function Disc({
  cell,
  index,
  winning,
  animate,
}: {
  cell: Cell;
  index: number;
  winning: boolean;
  animate: boolean;
}) {
  const row = Math.floor(index / C4_COLS);

  // Un disque qui atteint le fond tombe de plus haut, il doit donc tomber plus
  // longtemps : sans cette proportionnalité, tous les disques ont la même
  // vitesse apparente et le mouvement sonne faux.
  const durationMs = 240 + row * 40;

  return (
    <div className="grid place-items-center">
      {cell === null ? (
        <span aria-hidden className="size-[78%] rounded-full bg-felt-deep/70" />
      ) : (
        <span
          aria-hidden
          className={cn(
            "size-[78%] rounded-full shadow-[inset_0_-3px_6px_rgb(0_0_0/0.35),inset_0_2px_3px_rgb(255_255_255/0.25)]",
            winning && "animate-lueur ring-2 ring-cream/80",
          )}
          style={{
            backgroundColor: DISC_COLORS[cell],
            ...(animate
              ? {
                  animation: "var(--animate-chute)",
                  animationDuration: `${durationMs}ms`,
                  ["--chute-depart" as string]: `${-(row + 1) * 118}%`,
                }
              : {}),
          }}
        />
      )}
    </div>
  );
}

/**
 * Cadre du plateau, percé de 42 trous par un masque SVG.
 *
 * C'est ce qui fait qu'un disque en chute passe *derrière* le plateau et
 * n'apparaît que dans les ouvertures. Sans ce masque, le disque glisse
 * par-dessus la grille et l'illusion tombe.
 */
function BoardFrame() {
  const cellW = 100 / C4_COLS;
  const cellH = 100 / C4_ROWS;

  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 size-full"
    >
      <defs>
        <mask id="c4-holes">
          <rect x="0" y="0" width="100" height="100" fill="white" />
          {Array.from({ length: C4_ROWS * C4_COLS }, (_, index) => {
            const row = Math.floor(index / C4_COLS);
            const col = index % C4_COLS;
            return (
              <ellipse
                key={index}
                cx={(col + 0.5) * cellW}
                cy={(row + 0.5) * cellH}
                rx={cellW * 0.39}
                ry={cellH * 0.39}
                fill="black"
              />
            );
          })}
        </mask>
      </defs>

      <rect
        x="0"
        y="0"
        width="100"
        height="100"
        rx="3"
        ry="3.5"
        fill="var(--color-felt-high)"
        mask="url(#c4-holes)"
      />
      {/* Tranche éclairée en haut : donne l'épaisseur du plastique. */}
      <rect x="0" y="0" width="100" height="0.5" fill="rgb(255 255 255 / 0.12)" />
    </svg>
  );
}

function columnLabel(col: number, cells: readonly Cell[], full: boolean): string {
  if (full) return `Colonne ${col + 1} — pleine`;

  let count = 0;
  for (let row = 0; row < C4_ROWS; row += 1) {
    if ((cells[row * C4_COLS + col] ?? null) !== null) count += 1;
  }
  const libres = C4_ROWS - count;
  return `Colonne ${col + 1} — ${count} disque${count > 1 ? "s" : ""}, ${libres} place${libres > 1 ? "s" : ""} libre${libres > 1 ? "s" : ""}`;
}
