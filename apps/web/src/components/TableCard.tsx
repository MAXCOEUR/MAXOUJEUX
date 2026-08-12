import { formatCoins, getGame, isMyTable, winPayout, type TableSummary } from "@maxoujeux/shared";
import { Swords } from "lucide-react";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Plaque } from "./Plaque";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/countdown";
import { msSinceServer } from "@/lib/clock";

/** Ce que promet le bouton : le joueur doit savoir avant de cliquer. */
function libelleAction({
  spectateur,
  casino,
  busy,
  complete,
  tropCher,
  enCours,
}: {
  spectateur: boolean;
  casino: boolean;
  busy: boolean;
  complete: boolean;
  tropCher: boolean;
  enCours: boolean;
}): string {
  if (busy) return "Déjà en partie";
  if (spectateur) return complete ? "Regarder — table complète" : "Regarder";
  if (casino) {
    if (complete) return "Complète";
    // Entrer pendant le lancer est permis : on annonce l'attente plutôt que de
    // laisser croire qu'on va pouvoir miser tout de suite.
    return enCours ? "Rejoindre — tour en cours" : "Rejoindre";
  }
  if (complete) return "Complète";
  if (tropCher) return "Solde insuffisant";
  return "Rejoindre";
}

interface TableCardProps {
  table: TableSummary;
  userId: string;
  balance: number;
  /** Le joueur est déjà à une autre partie : tout est verrouillé. */
  busy: boolean;
  joining: boolean;
  error?: string | undefined;
  onJoin: (table: TableSummary) => void;
  onReprendre: (table: TableSummary) => void;
  /** Décalage de l'animation d'arrivée, pour un effet en escalier. */
  delay: number;
}

export function TableCard({
  table,
  userId,
  balance,
  busy,
  joining,
  error,
  onJoin,
  onReprendre,
  delay,
}: TableCardProps) {
  const mine = isMyTable(table, userId);
  const host = table.seats.find((seat) => seat.seat === 0);
  const enCours = table.status === "playing";
  const complete = table.seats.length >= table.maxSeats;
  const tropCher = table.stake !== null && table.stake > balance;
  const wager = getGame(table.game)?.wager;

  /**
   * Tables de casino : s'asseoir ne coûte rien et la manche en cours n'interdit
   * pas d'entrer — on attend simplement le tour suivant pour miser. Les duels,
   * eux, engagent la mise à l'entrée et se ferment une fois lancés.
   */
  const casino = table.stake === null;
  /**
   * Au blackjack, entrer veut dire **regarder** : la place se choisit ensuite,
   * sur le tapis. Une table complète reste donc ouverte — c'est même là que le
   * mode spectateur sert le plus. À la roulette il n'y a pas de siège : une
   * table pleine est vraiment pleine.
   */
  const spectateur = table.game === "blackjack";
  const joignable = casino
    ? !mine && !busy && (spectateur || !complete)
    : !enCours && !complete && !mine && !busy && !tropCher;

  return (
    <article
      style={{ animation: "var(--animate-deal)", animationDelay: `${delay}ms` }}
      className={cn(
        "panel-plat flex flex-col gap-3 p-4",
        joignable && "panel-interactif",
        enCours && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {host && (
            <Avatar
              userId={host.userId}
              seed={host.avatarSeed}
              pseudo={host.pseudo}
              className="size-8 text-xs"
            />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-cream">{host?.pseudo ?? "—"}</p>
            <p className="text-xs text-cream-faint">
              {/* Recalculé à chaque instantané reçu : inutile de faire tourner
                  une minuterie par carte pour une information indicative. */}
              ouverte il y a {formatDuration(msSinceServer(table.createdAt))}
            </p>
          </div>
        </div>

        {mine ? (
          <Plaque tone="gain">Ta table</Plaque>
        ) : enCours ? (
          <Plaque tone="neutre" icon={Swords}>
            En cours
          </Plaque>
        ) : (
          <Plaque tone="attente">En attente</Plaque>
        )}
      </div>

      {/* Sur une table de casino ce sont les bornes du tapis, pas un droit
          d'entrée : les valeurs viennent du jeu, plus du barème du blackjack
          recopié en dur. */}
      <dl className="flex items-end justify-between gap-3">
        <div>
          <dt className="text-xs text-cream-faint">{casino ? "Mises au tapis" : "Mise"}</dt>
          <dd className="tabular text-sm font-semibold text-brass">
            {table.stake === null
              ? `${formatCoins(wager?.min ?? 0)} – ${formatCoins(wager?.max ?? 0)}`
              : formatCoins(table.stake)}
          </dd>
        </div>
        <div className="text-right">
          <dt className="text-xs text-cream-faint">{casino ? "Rapport" : "Gain si victoire"}</dt>
          <dd className="tabular text-sm font-semibold text-cream">
            {table.stake === null
              ? (wager?.payout ?? "—")
              : formatCoins(winPayout(table.game, table.stake))}
          </dd>
        </div>
      </dl>

      {/* Deux pastilles plutôt qu'un « 1/2 » : on voit d'un coup d'œil qui est
          là et qu'il reste une place. */}
      <div className="flex items-center gap-2">
        {Array.from({ length: table.maxSeats }, (_, index) => {
          const occupant = table.seats[index];
          return occupant ? (
            <Avatar
              key={occupant.userId}
              userId={occupant.userId}
              seed={occupant.avatarSeed}
              pseudo={occupant.pseudo}
              className="size-7 text-xs"
            />
          ) : (
            <span
              key={`libre-${index}`}
              aria-hidden
              className="size-7 rounded-full border-2 border-dashed border-line-strong"
            />
          );
        })}
        <span className="text-xs text-cream-faint">
          {complete ? "complète" : `${table.maxSeats - table.seats.length} place libre`}
        </span>
      </div>

      {mine ? (
        <Button variant="outline" onClick={() => onReprendre(table)} className="w-full">
          Revenir à ma table
        </Button>
      ) : enCours && !casino ? null : (
        <Button
          onClick={() => onJoin(table)}
          loading={joining}
          disabled={!joignable}
          className="w-full"
        >
          {libelleAction({ spectateur, casino, busy, complete, tropCher, enCours })}
        </Button>
      )}

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </article>
  );
}
