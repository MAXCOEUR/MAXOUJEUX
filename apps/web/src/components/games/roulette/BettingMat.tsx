import { rouletteColor } from "@maxoujeux/engines";
import {
  formatCoins,
  spotKey,
  type RouletteSpot,
  type RouletteSpotBet,
} from "@maxoujeux/shared";
import { Chip } from "@/components/games/casino/Chips";
import { chipFor } from "@/lib/chips";
import { cn } from "@/lib/cn";
import {
  MAT_COLUMNS,
  MAT_DOZENS,
  MAT_EVEN_MONEY,
  MAT_ROWS,
  betOn,
  spotAria,
  spotLabel,
} from "@/lib/roulette-ui";

interface MatProps {
  /** Mises confirmées, toute la table confondue. */
  bets: readonly RouletteSpotBet[];
  /** Composition en cours, pas encore envoyée au serveur. */
  draft: ReadonlyMap<string, { spot: RouletteSpot; amount: number }>;
  /** Les cases acceptent-elles un jeton ? */
  open: boolean;
  onPlace: (spot: RouletteSpot) => void;
}

/**
 * Le tapis.
 *
 * Chaque case est un vrai `<button>` : la navigation clavier, le focus et la
 * sémantique viennent gratuitement avec l'élément natif, là où des `<div>`
 * cliquables obligeraient à tout réimplémenter — et le feraient mal.
 *
 * Le tapis **défile horizontalement** sur téléphone plutôt que de rétrécir :
 * douze colonnes dans 360 px donneraient des cases de 24 px, sous le minimum
 * tactile de 44. Mieux vaut faire glisser que rater sa case.
 */
export function BettingMat({ bets, draft, open, onPlace }: MatProps) {
  return (
    <div
      // `pan-x pan-y` est indispensable : sans lui, un doigt pose sur le tapis
      // ne declenche que le defilement horizontal, et la page reste bloquee —
      // impossible d'atteindre les cases du bas.
      className="overflow-x-auto pb-1 [scrollbar-width:thin] [touch-action:pan-x_pan-y]"
    >
      <div className="min-w-[34rem] select-none">
        {/* Les numéros : le zéro sur toute la hauteur, puis 3 × 12. */}
        <div className="flex gap-0.5">
          <Cell
            spot={{ kind: "straight", number: 0 }}
            bets={bets}
            draft={draft}
            open={open}
            onPlace={onPlace}
            className="w-9 shrink-0 self-stretch"
          />

          <div className="min-w-0 flex-1">
            {MAT_ROWS.map((row, index) => (
              <div key={index} className="mb-0.5 flex gap-0.5">
                {row.map((value) => (
                  <Cell
                    key={value}
                    spot={{ kind: "straight", number: value }}
                    bets={bets}
                    draft={draft}
                    open={open}
                    onPlace={onPlace}
                    className="flex-1"
                  />
                ))}
                {/* La colonne se mise au bout de sa ligne, comme au casino. */}
                <Cell
                  spot={{ kind: MAT_COLUMNS[index]! }}
                  bets={bets}
                  draft={draft}
                  open={open}
                  onPlace={onPlace}
                  className="w-11 shrink-0"
                  compact
                />
              </div>
            ))}
          </div>
        </div>

        {/* Les douzaines, alignées sous leurs quatre colonnes de numéros. */}
        <div className="ml-[calc(2.25rem+0.125rem)] mt-1 flex gap-0.5 pr-[calc(2.75rem+0.125rem)]">
          {MAT_DOZENS.map((kind) => (
            <Cell
              key={kind}
              spot={{ kind }}
              bets={bets}
              draft={draft}
              open={open}
              onPlace={onPlace}
              className="flex-1"
              compact
            />
          ))}
        </div>

        {/* Les mises simples. */}
        <div className="ml-[calc(2.25rem+0.125rem)] mt-0.5 flex gap-0.5 pr-[calc(2.75rem+0.125rem)]">
          {MAT_EVEN_MONEY.map((kind) => (
            <Cell
              key={kind}
              spot={{ kind }}
              bets={bets}
              draft={draft}
              open={open}
              onPlace={onPlace}
              className="flex-1"
              compact
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Une case du tapis.
 *
 * Trois informations s'y superposent sans se gêner : le nom de la case, le tas
 * déjà confirmé par la table, et le jeton en cours de composition. Le jeton du
 * brouillon est cerclé de laiton — c'est ce qui distingue « je vais miser » de
 * « j'ai misé », et sans cette distinction on ne sait plus ce qui est engagé.
 */
function Cell({
  spot,
  bets,
  draft,
  open,
  onPlace,
  className,
  compact = false,
}: {
  spot: RouletteSpot;
  bets: readonly RouletteSpotBet[];
  draft: ReadonlyMap<string, { spot: RouletteSpot; amount: number }>;
  open: boolean;
  onPlace: (spot: RouletteSpot) => void;
  className?: string;
  compact?: boolean;
}) {
  const key = spotKey(spot);
  const pose = betOn(bets, spot);
  const brouillon = draft.get(key)?.amount ?? 0;
  const engage = pose?.mine ?? 0;
  const table = pose?.total ?? 0;
  const plein = spot.kind === "straight";

  const fond = plein
    ? {
        red: "var(--color-roulette-rouge)",
        black: "var(--color-roulette-noir)",
        green: "var(--color-roulette-vert)",
      }[rouletteColor(spot.number)]
    : undefined;

  return (
    <button
      type="button"
      // Plus aucune case ne se sature : seul le solde borne la mise, et il est
      // vérifié à la pose du jeton, pas case par case.
      disabled={!open}
      onClick={() => onPlace(spot)}
      aria-label={spotAria(spot, engage + brouillon, table + brouillon)}
      className={cn(
        "relative grid place-items-center rounded-[0.2rem] border text-cream transition-[transform,border-color]",
        compact ? "min-h-8 px-1" : "min-h-11",
        plein ? "border-brass-deep/60" : "border-line-strong bg-felt-raised/70",
        open
          ? "cursor-pointer hover:border-brass active:translate-y-px"
          : "cursor-not-allowed opacity-70",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brass",
        className,
      )}
      style={fond ? { backgroundColor: fond } : undefined}
    >
      <span
        className={cn(
          "tabular font-semibold leading-none",
          compact ? "text-[0.58rem] uppercase tracking-[0.04em]" : "text-xs",
        )}
      >
        {plein ? spot.number : shortLabel(spot)}
      </span>

      {/* Les jetons se posent **dans les coins, à l'intérieur** de la case.
          Débordants, ils étaient rognés par la case voisine ; centrés, ils
          masquaient le numéro — or c'est justement le numéro qu'on vérifie
          avant de confirmer. Le tas de la table à droite, le sien à gauche. */}
      {table > 0 && (
        <span
          aria-hidden
          className="absolute bottom-0.5 right-0.5 z-10 [--jeton-l:1.3rem]"
          title={`${formatCoins(table)} sur ${spotLabel(spot)}`}
        >
          <Chip value={chipFor(table) ?? 10} />
        </span>
      )}

      {/* Le jeton en cours de composition, cerclé de laiton : c'est ce qui
          distingue « je vais miser » de « j'ai misé ». */}
      {brouillon > 0 && (
        <span
          aria-hidden
          className="absolute bottom-0.5 left-0.5 z-20 rounded-full ring-2 ring-brass [--jeton-l:1.3rem]"
        >
          <Chip value={chipFor(brouillon) ?? 10} />
        </span>
      )}
    </button>
  );
}

/** Libellé court, pour tenir dans une case de tapis. */
function shortLabel(spot: RouletteSpot): string {
  switch (spot.kind) {
    case "dozen1":
      return "1-12";
    case "dozen2":
      return "13-24";
    case "dozen3":
      return "25-36";
    case "column1":
    case "column2":
    case "column3":
      return "2:1";
    case "low":
      return "1-18";
    case "high":
      return "19-36";
    case "even":
      return "Pair";
    case "odd":
      return "Impair";
    case "red":
      return "Rouge";
    case "black":
      return "Noir";
    default:
      return spotLabel(spot);
  }
}
