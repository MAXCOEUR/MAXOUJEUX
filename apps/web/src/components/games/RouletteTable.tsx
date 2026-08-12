import { rouletteColor } from "@maxoujeux/engines";
import {
  ROULETTE_BETTING_MS,
  ROULETTE_RESULT_MS,
  formatCoins,
  formatCoinsDelta,
  type RoulettePhase,
  type RouletteSpot,
  type RouletteView,
} from "@maxoujeux/shared";
import { Avatar } from "@/components/Avatar";
import { ProgressRing } from "@/components/ProgressRing";
import { cn } from "@/lib/cn";
import { BettingMat } from "./roulette/BettingMat";
import { Wheel } from "./roulette/Wheel";

interface TableProps {
  view: RouletteView;
  /** Composition en cours, pas encore confirmée. */
  draft?: ReadonlyMap<string, { spot: RouletteSpot; amount: number }>;
  onPlace?: (spot: RouletteSpot) => void;
}

const VIDE: ReadonlyMap<string, { spot: RouletteSpot; amount: number }> = new Map();

/** Durée nominale de la phase, pour dimensionner l'anneau de temps. */
function phaseDurationMs(phase: RoulettePhase, spinMs: number): number | null {
  switch (phase) {
    case "betting":
      return ROULETTE_BETTING_MS;
    case "spinning":
      return spinMs;
    case "result":
      return ROULETTE_RESULT_MS;
    default:
      return null;
  }
}

function phaseLabel(phase: RoulettePhase): string {
  switch (phase) {
    case "idle":
      return "Table ouverte";
    case "betting":
      return "Faites vos jeux";
    case "spinning":
      return "Rien ne va plus";
    case "result":
      return "Paiement";
  }
}

/**
 * La table de roulette.
 *
 * Deux zones, et l'ordre compte : la roue et le bandeau des derniers numéros en
 * haut, le tapis en dessous. C'est la disposition d'une vraie table — on lève
 * les yeux vers le cylindre, on baisse la main vers le tapis — et c'est aussi
 * celle qui marche sur téléphone, où tout s'empile de toute façon.
 */
export function RouletteTable({ view, draft = VIDE, onPlace }: TableProps) {
  const duree = phaseDurationMs(view.phase, view.spinMs);
  const ouvert = view.phase === "idle" || view.phase === "betting";

  return (
    <div
      className={cn(
        "plateau relative isolate overflow-hidden rounded-[1.25rem] border border-line-strong bg-felt",
        "p-3 shadow-2xl sm:rounded-[1.75rem] sm:p-5",
      )}
      style={{
        backgroundImage:
          "radial-gradient(55% 45% at 28% 6%, oklch(0.72 0.09 88 / 0.14), transparent 70%), radial-gradient(90% 70% at 50% 108%, oklch(0.28 0.05 155 / 0.5), transparent 70%)",
      }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-1.5 rounded-[1rem] border border-brass/20 sm:inset-2 sm:rounded-[1.45rem]" />

      <div className="relative flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
        {/* Largeur explicite : sans elle, la colonne de la roue se dimensionne
            sur son libellé de phase et le cylindre se retrouve écrasé à une
            centaine de pixels à côté du tapis. */}
        <div className="flex w-[min(74vw,15rem)] shrink-0 flex-col items-center gap-2">
          <Wheel
            result={view.result}
            spinning={view.phase === "spinning"}
            deadlineAt={view.deadlineAt}
            spinMs={view.spinMs}
          />
          <PhaseClock
            phase={view.phase}
            deadlineAt={view.deadlineAt}
            durationMs={duree}
          />
        </div>

        {/* `w-full` est indispensable en colonne : l'alignement centré du parent
            donnerait sinon à cette colonne la largeur de son contenu — 34 rem
            de tapis — qui déborderait des **deux** côtés, et la moitié gauche
            deviendrait inatteignable derrière le `overflow-hidden` du plateau. */}
        <div className="w-full min-w-0 flex-1 space-y-3">
          <History numbers={view.history} />
          <BettingMat bets={view.bets} draft={draft} open={ouvert && onPlace !== undefined} onPlace={onPlace ?? (() => {})} />
          <Players view={view} />
        </div>
      </div>
    </div>
  );
}

/**
 * Le bandeau des derniers numéros.
 *
 * Purement informatif, et volontairement conservé : c'est le tableau lumineux
 * de toutes les tables du monde. Il n'aide en rien à prévoir le prochain tirage
 * — chaque lancer est indépendant — mais les joueurs le lisent, et son absence
 * se remarquerait plus que sa présence.
 */
function History({ numbers }: { numbers: readonly number[] }) {
  if (numbers.length === 0) {
    return (
      <p className="text-[0.65rem] uppercase tracking-[0.16em] text-cream-faint">
        Aucun numéro sorti pour l&apos;instant
      </p>
    );
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto" aria-label="Derniers numéros sortis">
      <span className="shrink-0 text-[0.6rem] uppercase tracking-[0.16em] text-cream-faint">Sortis</span>
      {numbers.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className={cn(
            "tabular grid size-6 shrink-0 place-items-center rounded-full text-[0.65rem] font-bold text-cream",
            index === 0 && "ring-2 ring-brass",
          )}
          style={{
            backgroundColor: {
              red: "var(--color-roulette-rouge)",
              black: "var(--color-roulette-noir)",
              green: "var(--color-roulette-vert)",
            }[rouletteColor(value)],
          }}
        >
          {value}
        </span>
      ))}
    </div>
  );
}

/** Où en est la table, et combien de temps il reste. */
function PhaseClock({
  phase,
  deadlineAt,
  durationMs,
}: {
  phase: RoulettePhase;
  deadlineAt: string | null;
  durationMs: number | null;
}) {
  return (
    <div className="flex items-center gap-2">
      {/* Aucune pastille au centre quand l'anneau compte les secondes : elle
          passait derrière les chiffres et les rendait illisibles. */}
      {deadlineAt && durationMs ? (
        <ProgressRing deadlineAt={deadlineAt} turnMs={durationMs} size={38} showSeconds>
          <span
            aria-hidden
            className="size-7 rounded-full border border-brass/25 bg-felt-deep/80"
          />
        </ProgressRing>
      ) : (
        <span aria-hidden className="grid size-[38px] place-items-center">
          <span className="size-2 rounded-full bg-line-strong" />
        </span>
      )}
      <span
        className={cn(
          "text-[0.65rem] font-semibold uppercase tracking-[0.14em]",
          phase === "spinning" ? "text-brass-bright" : "text-cream-faint",
        )}
      >
        {phaseLabel(phase)}
      </span>
    </div>
  );
}

/** Qui est à la table, et ce que chacun a engagé. */
function Players({ view }: { view: RouletteView }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Joueurs à la table">
      {view.players.map((player) => {
        const moi = player.userId === view.you;
        return (
          <li
            key={player.userId}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2 py-1",
              moi ? "border-brass/60 bg-brass/10" : "border-line bg-felt-deep/50",
              !player.connected && "opacity-55",
            )}
          >
            <Avatar userId={player.userId} seed={player.avatarSeed} pseudo={player.pseudo} className="size-5 text-[0.55rem]" />
            <span className="max-w-24 truncate text-[0.68rem] text-cream">{player.pseudo}</span>
            {player.roundNet !== null ? (
              <span
                className={cn(
                  "tabular text-[0.65rem] font-bold",
                  player.roundNet > 0 ? "text-win" : player.roundNet < 0 ? "text-danger" : "text-cream-dim",
                )}
              >
                {player.roundNet === 0 ? "±0" : formatCoinsDelta(player.roundNet)}
              </span>
            ) : player.totalWager > 0 ? (
              <span className="tabular text-[0.65rem] text-brass">{formatCoins(player.totalWager)}</span>
            ) : (
              <span className="text-[0.65rem] text-cream-faint">regarde</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
