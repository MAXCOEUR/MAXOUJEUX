import {
  GAMES,
  LEADERBOARD_METRICS,
  LEADERBOARD_METRIC_HINTS,
  LEADERBOARD_METRIC_LABELS,
  RENDEMENT_MIN_ROUNDS,
  STAT_PERIODS,
  STAT_PERIOD_LABELS,
  STAT_PERIOD_SHORT,
  type CurrentUser,
  type GameCode,
  type LeaderboardMetric,
  type StatPeriod,
} from "@maxoujeux/shared";
import { ArrowLeft, Loader2, Trophy } from "lucide-react";
import { useState } from "react";
import { Lien } from "@/components/Lien";
import { TableauClassement } from "@/components/stats/TableauClassement";
import { cn } from "@/lib/cn";
import { useLeaderboard } from "@/lib/stats";

/**
 * Les classements du site.
 *
 * Deux onglets et non un seul chiffre : le net brut récompense mécaniquement
 * celui qui mise le plus gros, le rendement celui qui joue le mieux. Aucun des
 * deux n'est « le vrai » classement — les afficher côte à côte est plus honnête
 * que d'en élire un.
 */
export function ClassementPage({ user }: { user: CurrentUser }) {
  const [period, setPeriod] = useState<StatPeriod>("day");
  const [metric, setMetric] = useState<LeaderboardMetric>("fortune");
  const [scope, setScope] = useState<"global" | GameCode>("global");

  const board = useLeaderboard(scope, period, metric);

  return (
    <div className="space-y-5 pb-8">
      <Lien
        to={{ name: "lobby" }}
        className="-my-2 inline-flex min-h-11 items-center gap-1.5 py-2 text-sm text-cream-dim transition-colors hover:text-cream"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Le lobby
      </Lien>

      <header className="panel flex items-center gap-4 p-5 sm:p-6">
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-full border border-brass/40 bg-brass/10 text-brass-bright sm:size-14"
        >
          <Trophy className="size-6" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-xl font-extrabold text-cream sm:text-2xl">
            Classements
          </h1>
          <p className="mt-1 text-sm text-cream-dim">
            {LEADERBOARD_METRIC_HINTS[metric]}
          </p>
        </div>
      </header>

      <section className="panel space-y-4 p-4 sm:p-5">
        <Onglets
          legende="Classement"
          options={LEADERBOARD_METRICS.map((value) => ({
            value,
            label: LEADERBOARD_METRIC_LABELS[value],
          }))}
          valeur={metric}
          onChange={setMetric}
        />

        <Onglets
          legende="Période"
          options={STAT_PERIODS.map((value) => ({
            value,
            label: STAT_PERIOD_SHORT[value],
            titre: STAT_PERIOD_LABELS[value],
          }))}
          valeur={period}
          onChange={setPeriod}
        />

        <FiltreJeu valeur={scope} onChange={setScope} />

        {metric === "rendement" && (
          <p className="text-xs text-cream-faint">
            Il faut {RENDEMENT_MIN_ROUNDS} manches sur la période pour être classé au
            rendement : une seule manche gagnée ne fait pas un bon joueur.
          </p>
        )}
      </section>

      {board.isPending ? (
        <div className="panel grid place-items-center py-16">
          <Loader2 className="size-5 animate-spin text-cream-faint" aria-label="Chargement" />
        </div>
      ) : board.isError ? (
        <p role="alert" className="panel p-6 text-center text-sm text-danger">
          Le classement n'a pas pu être chargé. Recharge la page.
        </p>
      ) : (
        <section className="panel p-4 sm:p-5">
          <TableauClassement
            board={board.data}
            meId={user.id}
            vide={`Personne n'a encore joué ${STAT_PERIOD_LABELS[period].toLowerCase()}`}
          />
        </section>
      )}
    </div>
  );
}

interface OngletsProps<T extends string> {
  legende: string;
  options: { value: T; label: string; titre?: string }[];
  valeur: T;
  onChange: (value: T) => void;
}

/**
 * Sélecteur segmenté.
 *
 * L'onglet actif porte **une couleur et un fond**, jamais la couleur seule :
 * c'est ce qui le rend lisible aux daltoniens comme sur un écran fatigué. Le
 * `aria-pressed` dit la même chose aux lecteurs d'écran.
 */
function Onglets<T extends string>({ legende, options, valeur, onChange }: OngletsProps<T>) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-cream-faint">
        {legende}
      </p>
      <div role="group" aria-label={legende} className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const actif = option.value === valeur;
          return (
            <button
              key={option.value}
              type="button"
              title={option.titre}
              aria-pressed={actif}
              onClick={() => onChange(option.value)}
              className={cn(
                "min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors",
                actif
                  ? "border-brass/60 bg-brass/15 text-brass-bright"
                  : "border-line bg-felt/50 text-cream-dim hover:border-line-strong hover:text-cream",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** « Tous » plus une pastille par jeu, teintée de son accent. */
function FiltreJeu({
  valeur,
  onChange,
}: {
  valeur: "global" | GameCode;
  onChange: (value: "global" | GameCode) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-cream-faint">
        Jeu
      </p>
      <div role="group" aria-label="Jeu" className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={valeur === "global"}
          onClick={() => onChange("global")}
          className={cn(
            "min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors",
            valeur === "global"
              ? "border-brass/60 bg-brass/15 text-brass-bright"
              : "border-line bg-felt/50 text-cream-dim hover:border-line-strong hover:text-cream",
          )}
        >
          Tous
        </button>

        {GAMES.filter((game) => game.status === "live").map((game) => {
          const actif = valeur === game.code;
          return (
            <button
              key={game.code}
              type="button"
              aria-pressed={actif}
              onClick={() => onChange(game.code)}
              // La couleur du jeu ne sert qu'à le reconnaître : c'est le fond
              // relevé et le liseré qui disent lequel est sélectionné.
              style={actif ? { borderColor: game.accent, color: game.accent } : undefined}
              className={cn(
                "min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors",
                actif
                  ? "bg-felt-high/60"
                  : "border-line bg-felt/50 text-cream-dim hover:border-line-strong hover:text-cream",
              )}
            >
              {game.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
