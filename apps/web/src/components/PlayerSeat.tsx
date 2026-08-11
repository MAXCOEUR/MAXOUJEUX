import { formatCoins, type MatchView, type Seat, type TableSeat } from "@maxoujeux/shared";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "./Avatar";
import { Plaque } from "./Plaque";
import { ProgressRing } from "./ProgressRing";

interface PlayerSeatProps {
  /** `null` : siège encore libre. */
  occupant: TableSeat | null;
  seat: Seat;
  /** Est-ce le siège du joueur qui regarde ? */
  self: boolean;
  /** Est-ce à ce siège de jouer ? */
  active: boolean;
  match: MatchView;
  className?: string;
}

/** Couleur du jeton, identique à celle des plateaux. */
const SEAT_COLORS: Record<Seat, string> = {
  0: "var(--color-game-connect4)",
  1: "var(--color-game-motus)",
};

/**
 * Siège de table.
 *
 * Le rappel du jeton sous le pseudo n'est pas décoratif : sans lui, il faut
 * deviner quelle couleur on joue, et la confusion coûte un coup. C'est aussi ce
 * qui rend la partie lisible pour un daltonisme — la couleur est doublée par la
 * position et par le pseudo.
 */
export function PlayerSeat({
  occupant,
  seat,
  self,
  active,
  match,
  className,
}: PlayerSeatProps) {
  const outcome = match.outcome;
  const won = outcome?.winnerSeat === seat;
  const draw = outcome !== null && outcome.winnerSeat === null;
  const delta = outcome?.deltas.find((entry) => entry.seat === seat)?.delta;

  if (!occupant) {
    return (
      <div
        className={cn(
          "flex min-w-0 items-center gap-3 rounded-xl border border-dashed border-line-strong px-3 py-2.5",
          className,
        )}
      >
        <span aria-hidden className="size-9 shrink-0 rounded-full border-2 border-dashed border-line-strong" />
        <div className="min-w-0">
          <p className="truncate text-sm text-cream-faint">Place libre</p>
          <p className="text-xs text-cream-faint">En attente d'un adversaire</p>
        </div>
      </div>
    );
  }

  const showRing = active && match.status === "playing" && match.deadlineAt !== null;

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
        active && match.status === "playing"
          ? "border-win/40 bg-win/5"
          : "border-line bg-felt-deep/40",
        className,
      )}
    >
      <div className="relative shrink-0">
        {showRing && match.deadlineAt ? (
          <ProgressRing deadlineAt={match.deadlineAt} turnMs={match.turnMs} size={46}>
            <Avatar seed={occupant.avatarSeed} pseudo={occupant.pseudo} className="size-9" />
          </ProgressRing>
        ) : (
          <div className="grid size-[46px] place-items-center">
            <Avatar seed={occupant.avatarSeed} pseudo={occupant.pseudo} className="size-9" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-cream">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: SEAT_COLORS[seat] }}
          />
          <span className="truncate">{occupant.pseudo}</span>
          {self && <span className="shrink-0 text-xs text-cream-faint">(toi)</span>}
        </p>

        <p className="tabular mt-0.5 text-xs text-brass">{formatCoins(match.stake)}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {!occupant.connected && (
            <Plaque tone="danger" icon={WifiOff}>
              Déconnecté
            </Plaque>
          )}
          {match.status === "playing" && active && (
            <Plaque tone="actif">{self ? "À toi de jouer" : "À son tour"}</Plaque>
          )}
          {outcome && (
            <Plaque tone={won ? "gain" : draw ? "neutre" : "danger"}>
              {won ? "Gagné" : draw ? "Égalité" : "Perdu"}
            </Plaque>
          )}
          {outcome && delta !== undefined && (
            <span
              className={cn(
                "tabular text-xs font-semibold",
                delta > 0 ? "text-win" : delta < 0 ? "text-danger" : "text-cream-dim",
              )}
            >
              {delta > 0 ? "+" : ""}
              {delta} MC
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
