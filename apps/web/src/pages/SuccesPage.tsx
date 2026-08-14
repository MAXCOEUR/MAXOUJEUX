import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_CATEGORY_HINTS,
  formatCoins,
} from "@maxoujeux/shared";
import { ArrowLeft, Loader2, Medal } from "lucide-react";
import { Lien } from "@/components/Lien";
import { CarteSucces } from "@/components/stats/CarteSucces";
import { useAchievements } from "@/lib/stats";

/**
 * Les succès du site.
 *
 * Classés par catégorie et non par état : une page qui montrerait d'abord les
 * succès obtenus n'aurait rien à proposer. Ce qui reste à faire est ce qu'on
 * vient chercher ici.
 */
export function SuccesPage() {
  const board = useAchievements();

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
          <Medal className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-extrabold text-cream sm:text-2xl">Succès</h1>
          {board.data ? (
            <p className="mt-1 text-sm text-cream-dim">
              <span className="tabular text-brass-bright">
                {board.data.unlocked} / {board.data.total}
              </span>{" "}
              débloqués — {formatCoins(board.data.earned)} de primes encaissées.
            </p>
          ) : (
            <p className="mt-1 text-sm text-cream-dim">
              {ACHIEVEMENTS.length} défis, du plus banal au presque impossible.
            </p>
          )}
        </div>
      </header>

      {board.data && (
        <div
          className="h-2 overflow-hidden rounded-full bg-felt-high"
          role="progressbar"
          aria-valuenow={board.data.unlocked}
          aria-valuemin={0}
          aria-valuemax={board.data.total}
          aria-label="Succès débloqués"
        >
          <div
            className="h-full rounded-full bg-brass transition-[width] duration-700"
            style={{ width: `${(board.data.unlocked / board.data.total) * 100}%` }}
          />
        </div>
      )}

      {board.isPending ? (
        <div className="panel grid place-items-center py-16">
          <Loader2 className="size-5 animate-spin text-cream-faint" aria-label="Chargement" />
        </div>
      ) : board.isError ? (
        <p role="alert" className="panel p-6 text-center text-sm text-danger">
          Les succès n'ont pas pu être chargés. Recharge la page.
        </p>
      ) : (
        ACHIEVEMENT_CATEGORIES.map((category) => {
          const succes = ACHIEVEMENTS.filter((a) => a.category === category);
          if (succes.length === 0) return null;
          const etats = new Map(board.data.states.map((state) => [state.code, state]));
          const obtenus = succes.filter((a) => etats.get(a.code)?.unlockedAt != null).length;

          return (
            <section key={category} aria-labelledby={`succes-${category}`}>
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <div>
                  <h2
                    id={`succes-${category}`}
                    className="font-display text-lg font-bold text-cream"
                  >
                    {category}
                  </h2>
                  <p className="text-xs text-cream-faint">
                    {ACHIEVEMENT_CATEGORY_HINTS[category]}
                  </p>
                </div>
                <span className="tabular shrink-0 text-xs text-cream-faint">
                  {obtenus} / {succes.length}
                </span>
              </div>

              <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
                {succes.map((achievement) => (
                  <CarteSucces
                    key={achievement.code}
                    achievement={achievement}
                    state={etats.get(achievement.code)}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
