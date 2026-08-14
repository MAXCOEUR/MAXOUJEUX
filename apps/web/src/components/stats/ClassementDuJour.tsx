import {
  formatChrono,
  formatCoinsDelta,
  formatRank,
  type GameCode,
  type MotusDailyRow,
} from "@maxoujeux/shared";
import { Trophy } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Lien } from "@/components/Lien";
import { cn } from "@/lib/cn";
import { useLeaderboard, useMotusDaily } from "@/lib/stats";

/**
 * Le classement du jour d'un salon, en cinq lignes.
 *
 * Volontairement resserré : cet encart n'est pas la page des classements, il
 * donne l'envie d'y aller. Ce qu'il doit absolument montrer, c'est **la place du
 * joueur** — « 14e sur 23 » vaut mieux qu'un podium où il n'est pas.
 */
export function ClassementDuJour({ game, meId }: { game: GameCode; meId: string }) {
  const board = useLeaderboard(game, "day", "fortune");

  if (board.isPending || board.isError) return null;

  const top = board.data.rows.slice(0, 5);
  const dansLeTop = top.some((row) => row.userId === meId);

  return (
    <section className="panel p-4 sm:p-5" aria-labelledby="jour-titre">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2
          id="jour-titre"
          className="flex items-center gap-2 font-display text-sm font-bold text-cream"
        >
          <Trophy className="size-4 text-brass" aria-hidden />
          Aujourd'hui
        </h2>
        <Lien
          to={{ name: "classement" }}
          className="text-xs text-cream-dim transition-colors hover:text-cream"
        >
          Tous les classements
        </Lien>
      </div>

      {top.length === 0 ? (
        <p className="text-sm text-cream-dim">
          Personne n'a encore joué aujourd'hui — la première manche prend la tête.
        </p>
      ) : (
        <ol className="list-none space-y-1 p-0">
          {top.map((row) => (
            <Ligne
              key={row.userId}
              rank={row.rank}
              pseudo={row.pseudo}
              userId={row.userId}
              avatarSeed={row.avatarSeed}
              valeur={formatCoinsDelta(row.net)}
              positif={row.net > 0}
              negatif={row.net < 0}
              moi={row.userId === meId}
            />
          ))}
        </ol>
      )}

      {/* Le joueur n'est pas au sommet : sa place lui est dite quand même. */}
      {board.data.me && !dansLeTop && (
        <p className="tabular mt-3 border-t border-line pt-3 text-sm text-cream-dim">
          Tu es <span className="text-brass-bright">{formatRank(board.data.me.rank)}</span> sur{" "}
          {board.data.total} — {formatCoinsDelta(board.data.me.net)}
        </p>
      )}
      {!board.data.me && top.length > 0 && (
        <p className="mt-3 border-t border-line pt-3 text-sm text-cream-dim">
          Tu n'as pas encore joué aujourd'hui.
        </p>
      )}
    </section>
  );
}

/**
 * Le tableau des exploits Motus du jour : essais d'abord, chrono en départage.
 *
 * Un encart à part et non une colonne de plus : au Motus, le gain compte moins
 * que la manière — trouver en deux coups vaut mieux que gagner gros en six.
 */
export function ExploitsMotusDuJour({ meId }: { meId: string }) {
  const daily = useMotusDaily();

  if (daily.isPending || daily.isError) return null;

  const top = daily.data.rows.slice(0, 5);
  const dansLeTop = top.some((row) => row.userId === meId);

  return (
    <section className="panel p-4 sm:p-5" aria-labelledby="exploits-titre">
      <h2 id="exploits-titre" className="font-display text-sm font-bold text-cream">
        Les plus fins d'aujourd'hui
      </h2>
      <p className="mb-3 text-xs text-cream-faint">
        Le moins d'essais l'emporte. Le chrono ne départage que les ex æquo.
      </p>

      {top.length === 0 ? (
        <p className="text-sm text-cream-dim">
          Aucun mot trouvé aujourd'hui. La première grille résolue prend la tête.
        </p>
      ) : (
        <ol className="list-none space-y-1 p-0">
          {top.map((row) => (
            <Ligne
              key={row.userId}
              rank={row.rank}
              pseudo={row.pseudo}
              userId={row.userId}
              avatarSeed={row.avatarSeed}
              valeur={`${row.attempts} essai${row.attempts > 1 ? "s" : ""}`}
              detail={formatChrono(row.durationMs)}
              positif
              moi={row.userId === meId}
            />
          ))}
        </ol>
      )}

      {daily.data.me && !dansLeTop && (
        <p className="tabular mt-3 border-t border-line pt-3 text-sm text-cream-dim">
          Tu es <span className="text-brass-bright">{formatRank(daily.data.me.rank)}</span> sur{" "}
          {daily.data.total} — {resume(daily.data.me)}
        </p>
      )}
    </section>
  );
}

function resume(row: MotusDailyRow): string {
  return `${row.attempts} essai${row.attempts > 1 ? "s" : ""} en ${formatChrono(row.durationMs)}`;
}

interface LigneProps {
  rank: number;
  userId: string;
  pseudo: string;
  avatarSeed: string;
  valeur: string;
  detail?: string;
  positif?: boolean;
  negatif?: boolean;
  moi: boolean;
}

function Ligne({
  rank,
  userId,
  pseudo,
  avatarSeed,
  valeur,
  detail,
  positif,
  negatif,
  moi,
}: LigneProps) {
  return (
    <li
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2 py-1.5",
        moi && "bg-brass/10 ring-1 ring-inset ring-brass/40",
      )}
    >
      <span
        className={cn(
          "tabular w-6 shrink-0 text-right text-xs font-bold",
          rank === 1 ? "text-brass-bright" : "text-cream-faint",
        )}
      >
        {rank}
      </span>
      <Avatar userId={userId} seed={avatarSeed} pseudo={pseudo} className="size-6 shrink-0" />
      <Lien
        to={{ name: "profil", pseudo }}
        className="min-w-0 flex-1 truncate text-sm text-cream transition-colors hover:text-brass-bright"
      >
        {pseudo}
      </Lien>
      <span className="shrink-0 text-right">
        <span
          className={cn(
            "tabular block text-sm font-semibold",
            positif ? "text-brass-bright" : negatif ? "text-danger" : "text-cream-dim",
          )}
        >
          {valeur}
        </span>
        {detail && <span className="tabular block text-[11px] text-cream-faint">{detail}</span>}
      </span>
    </li>
  );
}
