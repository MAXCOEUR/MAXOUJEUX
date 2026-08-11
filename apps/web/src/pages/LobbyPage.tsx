import {
  formatCoins,
  GAMES,
  type CurrentUser,
  type GameDefinition,
  type TableCounts,
} from "@maxoujeux/shared";
import { Lock, Play, Users } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { GameArtefact } from "@/components/GameArtefact";
import { Lien } from "@/components/Lien";
import { Plaque } from "@/components/Plaque";
import { StreakStrip } from "@/components/StreakStrip";
import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDuration, useCountdown } from "@/lib/countdown";
import { useLobby } from "@/lib/lobby";
import { useRealtime } from "@/lib/socket";
import { useTables } from "@/lib/tables";
import { useClaimDailyBonus, useWallet } from "@/lib/wallet";

export function LobbyPage({ user }: { user: CurrentUser }) {
  const presence = useRealtime((state) => state.presence);
  const lobby = useLobby();
  const liveCounts = useTables((state) => state.counts);

  // La socket est la source à jour ; l'appel REST ne sert qu'à ne pas afficher
  // « 0 table » pendant la seconde d'établissement de la liaison.
  const counts = Object.keys(liveCounts).length > 0 ? liveCounts : (lobby.data?.tables ?? {});

  return (
    <div className="space-y-8">
      <WelcomeBar user={user} />

      <section aria-labelledby="games-heading">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="games-heading" className="font-display text-xl font-bold text-cream">
            Les tables
          </h2>
          <p className="text-xs text-cream-faint">
            Les jeux s'ouvrent au fil des livraisons.
          </p>
        </div>

        {/* Le jeu en vedette occupe deux colonnes : cinq vignettes égales
            laisseraient un trou en fin de grille et aucun point d'entrée. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GAMES.map((game, index) => (
            <GameCard
              key={game.code}
              game={game}
              counts={counts[game.code]}
              delay={index * 70}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="players-heading" className="panel p-5">
        <h2
          id="players-heading"
          className="flex items-center gap-2 font-display text-sm font-bold text-cream"
        >
          <Users className="size-4 text-brass" aria-hidden />
          À table
          <span className="tabular rounded-full bg-felt-high px-2 py-0.5 text-xs text-cream-dim">
            {presence.online}
          </span>
        </h2>

        {presence.players.length <= 1 ? (
          <p className="mt-3 text-sm text-cream-faint">
            Tu es seul pour l'instant. Ouvre le site sur ton téléphone, ou envoie l'adresse à
            quelqu'un — les parties se jouent à deux minimum.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {presence.players.map((player) => (
              <li
                key={player.userId}
                className="flex items-center gap-2 rounded-full border border-line bg-felt-deep/50 py-1 pl-1 pr-3"
              >
                <Avatar
                  seed={player.avatarSeed}
                  pseudo={player.pseudo}
                  className="size-7 text-xs"
                />
                <span className="text-sm text-cream">{player.pseudo}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Bandeau d'accueil.
 *
 * Le bonus quotidien s'encaisse ici, pas au fond d'un panneau : c'est l'action
 * la plus fréquente du site, il n'y a aucune raison de la faire chercher.
 */
function WelcomeBar({ user }: { user: CurrentUser }) {
  const wallet = useWallet(true);
  const claim = useClaimDailyBonus();
  const untilMidnight = useCountdown(wallet.data?.nextClaimAt);
  const untilMotus = useCountdown(wallet.data?.nextMotusSlotAt);

  const error = claim.error instanceof ApiClientError ? claim.error.message : null;

  return (
    <section className="panel relative overflow-hidden p-5 sm:p-6">
      {/* Lueur discrète derrière le montant : rappelle le laiton sans l'imposer. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle, oklch(0.78 0.1 88 / 0.22), transparent 65%)",
        }}
      />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold text-cream sm:text-3xl">
            Bonsoir {user.pseudo}.
          </h1>
          <p className="mt-1 text-sm text-cream-dim">
            Tu as <span className="tabular text-brass-bright">{formatCoins(user.balance)}</span>{" "}
            sur la table.
          </p>

          {wallet.data && (
            <div className="mt-4 max-w-md">
              <StreakStrip
                streak={wallet.data.streak}
                currentAmount={wallet.data.claimableAmount}
              />
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-3 lg:w-64 lg:items-stretch">
          {wallet.data?.canClaim ? (
            <>
              <Button
                onClick={() => claim.mutate()}
                loading={claim.isPending}
                className="w-full text-base"
              >
                Encaisser {formatCoins(wallet.data.claimableAmount)}
              </Button>
              <p className="text-center text-xs text-cream-faint">
                Demain, si tu reviens : {formatCoins(wallet.data.nextDayAmount)}
              </p>
            </>
          ) : (
            wallet.data && (
              <div className="rounded-xl border border-line bg-felt-deep/50 px-4 py-3 text-center">
                <p className="text-sm text-cream">Bonus du jour encaissé</p>
                <p className="tabular mt-1 text-lg font-bold text-brass">
                  {formatDuration(untilMidnight)}
                </p>
                <p className="mt-0.5 text-xs text-cream-faint">
                  puis {formatCoins(wallet.data.nextDayAmount)}
                </p>
              </div>
            )
          )}

          {/* Le prochain mot Motus est une raison de revenir : il a sa place ici,
              même si le jeu n'est pas encore ouvert. */}
          {wallet.data && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-felt-deep/40 px-3 py-2">
              {/* `min-w-0 truncate` / `shrink-0` : depuis que les secondes
                  s'affichent, la valeur est plus large et poussait le libellé
                  hors de la boîte sur petit écran. */}
              <span className="min-w-0 truncate text-xs text-cream-dim">Prochain mot Motus</span>
              <span className="tabular shrink-0 text-xs font-semibold text-game-motus">
                {formatDuration(untilMotus)}
              </span>
            </div>
          )}

          {error && (
            <p role="alert" className="text-center text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function GameCard({
  game,
  counts,
  delay,
}: {
  game: GameDefinition;
  counts: TableCounts | undefined;
  delay: number;
}) {
  const locked = game.status !== "live";
  const wager =
    game.wager.min === game.wager.max
      ? formatCoins(game.wager.min)
      : `${formatCoins(game.wager.min)} – ${formatCoins(game.wager.max)}`;

  const ouvertes = counts?.waiting ?? 0;
  const enCours = counts?.playing ?? 0;

  return (
    <article
      style={{ animation: "var(--animate-deal)", animationDelay: `${delay}ms` }}
      className={cn(
        "panel group relative flex flex-col overflow-hidden transition-transform duration-200",
        !locked && "hover:-translate-y-1",
        game.featured ? "lg:col-span-2" : "",
      )}
    >
      {/* Filet de couleur du jeu, en haut : repère immédiat dans la grille. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ backgroundColor: game.accent }}
      />

      <div className={cn("flex flex-1 gap-4 p-5", game.featured && "sm:gap-6 sm:p-6")}>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-2">
            <h3
              className={cn(
                "font-display font-bold text-cream",
                game.featured ? "text-xl sm:text-2xl" : "text-lg",
              )}
            >
              {game.name}
            </h3>
            {locked ? (
              <Plaque icon={Lock} className="ml-auto">
                Lot {game.milestone}
              </Plaque>
            ) : ouvertes > 0 ? (
              <Plaque tone="actif" className="ml-auto">
                {ouvertes} table{ouvertes > 1 ? "s" : ""} libre{ouvertes > 1 ? "s" : ""}
              </Plaque>
            ) : (
              <Plaque tone="attente" className="ml-auto">
                Ouvert
              </Plaque>
            )}
          </div>

          <p className="mt-2 text-sm leading-relaxed text-cream-dim">{game.tagline}</p>

          <dl className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <div>
              <dt className="text-cream-faint">Joueurs</dt>
              <dd className="tabular mt-0.5 text-cream">
                {game.minPlayers === game.maxPlayers
                  ? game.maxPlayers
                  : `${game.minPlayers} à ${game.maxPlayers}`}
              </dd>
            </div>

            <div>
              <dt className="text-cream-faint">
                {game.wager.label} {game.wager.min === game.wager.max ? "fixe" : "min. / max."}
              </dt>
              <dd className="tabular mt-0.5 text-brass">{wager}</dd>
            </div>

            {game.wager.payout && (
              <div>
                <dt className="text-cream-faint">Gain</dt>
                <dd
                  className={cn(
                    "mt-0.5 font-semibold",
                    game.code === "motus" ? "text-game-motus" : "text-cream",
                  )}
                >
                  {game.wager.payout}
                </dd>
              </div>
            )}
          </dl>

          {/* Point d'entrée du jeu. Un vrai lien : le clic milieu, le Ctrl+clic
              et le clavier fonctionnent comme partout ailleurs. */}
          <div className="mt-auto pt-4">
            {locked ? (
              <p className="text-xs text-cream-faint">Disponible au lot {game.milestone}.</p>
            ) : (
              <Lien to={{ name: "salon", game: game.code }} className="inline-block">
                <Button className="px-3.5 py-2">
                  <Play className="size-4" aria-hidden />
                  Jouer
                  {enCours > 0 && (
                    <span className="tabular text-xs font-normal opacity-70">
                      · {enCours} en cours
                    </span>
                  )}
                </Button>
              </Lien>
            )}
          </div>
        </div>

        {/* L'artefact : c'est lui qui distingue une table d'une autre. */}
        <div
          className={cn(
            "shrink-0 self-center opacity-90 transition-opacity group-hover:opacity-100",
            game.featured ? "w-32 sm:w-44" : "w-20 sm:w-24",
          )}
        >
          <GameArtefact code={game.code} />
        </div>
      </div>
    </article>
  );
}
