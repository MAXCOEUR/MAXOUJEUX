import {
  COIN_NAME,
  formatCoins,
  GAMES,
  STAKE_TIERS,
  type GameDefinition,
} from "@maxoujeux/shared";
import { Coins, Lock, Users } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { useRealtime } from "@/lib/socket";

export function LobbyPage() {
  const presence = useRealtime((state) => state.presence);

  return (
    <div className="space-y-10">
      <section className="animate-rise">
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">Choisis ta table</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Les jeux s'activent au fil des livraisons. Puissance 4 et Morpion arrivent au prochain lot.
        </p>
      </section>

      <section aria-labelledby="games-heading">
        <h2 id="games-heading" className="sr-only">
          Jeux disponibles
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GAMES.map((game) => (
            <GameCard key={game.code} game={game} />
          ))}
        </div>
      </section>

      <section aria-labelledby="players-heading">
        <h2 id="players-heading" className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink">
          <Users className="size-4 text-accent-cyan" aria-hidden />
          Joueurs connectés
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs tabular-nums text-ink-muted">
            {presence.online}
          </span>
        </h2>

        {presence.players.length === 0 ? (
          <p className="card-surface px-4 py-6 text-center text-sm text-ink-faint">
            Personne d'autre pour l'instant. Ouvre le site sur un autre appareil pour tester.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {presence.players.map((player) => (
              <li
                key={player.userId}
                className="flex items-center gap-2 rounded-full border border-line bg-surface-2/60 py-1 pl-1 pr-3"
              >
                <Avatar seed={player.avatarSeed} pseudo={player.pseudo} className="size-7 text-xs" />
                <span className="text-sm text-ink">{player.pseudo}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function GameCard({ game }: { game: GameDefinition }) {
  const locked = game.status !== "live";

  return (
    <article
      className={cn(
        "card-surface group relative overflow-hidden p-5 transition-transform",
        locked ? "opacity-60" : "hover:-translate-y-0.5",
      )}
      aria-disabled={locked || undefined}
    >
      {/* Bandeau coloré propre au jeu : repère visuel immédiat dans la grille. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: game.accent }}
      />

      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">{game.name}</h3>
        {locked && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-3 px-2 py-1 text-[11px] text-ink-muted">
            <Lock className="size-3" aria-hidden />
            Lot {game.milestone}
          </span>
        )}
      </div>

      <p className="mt-1.5 min-h-10 text-sm text-ink-muted">{game.tagline}</p>

      <div className="mt-4 flex items-center gap-3 text-xs text-ink-faint">
        <span className="flex items-center gap-1">
          <Users className="size-3.5" aria-hidden />
          {game.minPlayers === game.maxPlayers
            ? `${game.maxPlayers} joueurs`
            : `${game.minPlayers} à ${game.maxPlayers} joueurs`}
        </span>
        {game.usesChips && (
          <span className="flex items-center gap-1 text-gold" title={`Se joue en ${COIN_NAME}`}>
            <Coins className="size-3.5" aria-hidden />
            {formatCoins(STAKE_TIERS[0].buyIn)} min.
          </span>
        )}
      </div>
    </article>
  );
}
