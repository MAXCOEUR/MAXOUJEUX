import { formatCoins, formatCoinsDelta, formatRank, formatRendement } from "@maxoujeux/shared";
import type { LeaderboardMetric, LeaderboardRow } from "@maxoujeux/shared";
import { forwardRef } from "react";
import { Avatar } from "@/components/Avatar";
import { Lien } from "@/components/Lien";
import { cn } from "@/lib/cn";

interface RangLigneProps {
  row: LeaderboardRow;
  metric: LeaderboardMetric;
  /** Ligne du joueur qui consulte : mise en avant, et jamais cliquable en boucle. */
  moi: boolean;
  className?: string;
}

/**
 * Une ligne de classement.
 *
 * Carte et non ligne de tableau : sur téléphone, un `<table>` à cinq colonnes se
 * tronque ou impose un défilement horizontal, et le pseudo est la première
 * chose qui disparaît.
 *
 * Le laiton est réservé à ce qu'il désigne partout ailleurs sur le site :
 * l'argent gagné et la première place. Un rang perdant s'écrit en rouge, mais le
 * **signe est toujours écrit** — la couleur seule ne porte jamais l'information.
 */
export const RangLigne = forwardRef<HTMLDivElement, RangLigneProps>(function RangLigne(
  { row, metric, moi, className },
  ref,
) {
  const premier = row.rank === 1;
  const positif = row.net > 0;

  return (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors sm:gap-4 sm:px-4",
        moi
          ? "border-brass/50 bg-brass/10"
          : "border-line bg-felt/60 hover:border-line-strong hover:bg-felt-raised/60",
        className,
      )}
    >
      <span
        className={cn(
          "tabular w-8 shrink-0 text-right text-sm font-bold sm:w-10 sm:text-base",
          premier ? "text-brass-bright" : moi ? "text-cream" : "text-cream-faint",
        )}
      >
        {formatRank(row.rank)}
      </span>

      <Avatar
        userId={row.userId}
        seed={row.avatarSeed}
        pseudo={row.pseudo}
        className="size-8 shrink-0 sm:size-9"
      />

      <div className="min-w-0 flex-1">
        <Lien
          to={{ name: "profil", pseudo: row.pseudo }}
          className="block truncate text-sm font-medium text-cream transition-colors hover:text-brass-bright"
        >
          {row.pseudo}
          {moi && <span className="ml-1.5 text-xs font-normal text-brass">— toi</span>}
        </Lien>
        <p className="tabular truncate text-xs text-cream-faint">
          {row.rounds} manche{row.rounds > 1 ? "s" : ""} · {row.wins} gagnée
          {row.wins > 1 ? "s" : ""} · {formatCoins(row.wagered)} misés
        </p>
      </div>

      <div className="shrink-0 text-right">
        {metric === "rendement" ? (
          <>
            <p
              className={cn(
                "tabular text-sm font-bold sm:text-base",
                positif ? "text-brass-bright" : row.net < 0 ? "text-danger" : "text-cream-dim",
              )}
            >
              {formatRendement(row.rendement)}
            </p>
            <p className="tabular text-xs text-cream-faint">{formatCoinsDelta(row.net)}</p>
          </>
        ) : (
          <>
            <p
              className={cn(
                "tabular text-sm font-bold sm:text-base",
                positif ? "text-brass-bright" : row.net < 0 ? "text-danger" : "text-cream-dim",
              )}
            >
              {formatCoinsDelta(row.net)}
            </p>
            {row.bestWin > 0 && (
              <p className="tabular text-xs text-cream-faint">
                meilleur coup {formatCoins(row.bestWin)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
});
