import {
  formatChrono,
  formatCoins,
  formatCoinsDelta,
  getAchievement,
  getGame,
  type CurrentUser,
  type GameBreakdown,
} from "@maxoujeux/shared";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Lien } from "@/components/Lien";
import { Plaque } from "@/components/Plaque";
import { CourbeFortune } from "@/components/stats/CourbeFortune";
import { cn } from "@/lib/cn";
import { usePlayerProfile } from "@/lib/stats";

/**
 * Profil public d'un joueur.
 *
 * Le joueur lit le sien par la même page que celui des autres : c'est la seule
 * façon de garantir qu'il voit exactement ce qui est montré de lui.
 */
export function ProfilPage({ pseudo, user }: { pseudo: string; user: CurrentUser }) {
  const profil = usePlayerProfile(pseudo);
  const moi = profil.data?.userId === user.id;

  if (profil.isPending) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="size-5 animate-spin text-cream-faint" aria-label="Chargement" />
      </div>
    );
  }

  if (profil.isError || !profil.data) {
    return (
      <EmptyState
        title="Aucun joueur de ce nom"
        description="Le pseudo a peut-être changé, ou l'adresse a été mal recopiée."
        action={
          <Lien to={{ name: "classement" }}>
            <Button variant="outline">Voir les classements</Button>
          </Lien>
        }
      />
    );
  }

  const { totals, games, fortune, achievements } = profil.data;
  const aJoue = totals.rounds > 0;

  return (
    <div className="space-y-5 pb-8">
      <Lien
        to={{ name: "classement" }}
        className="-my-2 inline-flex min-h-11 items-center gap-1.5 py-2 text-sm text-cream-dim transition-colors hover:text-cream"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Les classements
      </Lien>

      <header className="panel flex flex-wrap items-center gap-4 p-5 sm:p-6">
        <Avatar
          userId={profil.data.userId}
          seed={profil.data.avatarSeed}
          pseudo={profil.data.pseudo}
          className="size-16 text-xl"
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-extrabold text-cream sm:text-2xl">
            {profil.data.pseudo}
          </h1>
          <p className="mt-0.5 text-sm text-cream-dim">
            Sur MaxouJeux depuis le {new Date(profil.data.memberSince).toLocaleDateString("fr-FR")}
          </p>
        </div>
        {moi && <Plaque tone="gain">C'est toi</Plaque>}
      </header>

      {!aJoue ? (
        <EmptyState
          title="Aucune manche jouée"
          description={
            moi
              ? "Ouvre une table, et cette page se remplira toute seule."
              : "Ce joueur n'a encore rien joué."
          }
          action={
            moi ? (
              <Lien to={{ name: "lobby" }}>
                <Button>Choisir un jeu</Button>
              </Lien>
            ) : undefined
          }
        />
      ) : (
        <>
          <section aria-label="Chiffres clés" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tuile
              titre="Bilan"
              valeur={formatCoinsDelta(totals.net)}
              ton={totals.net > 0 ? "gain" : totals.net < 0 ? "perte" : "neutre"}
            />
            <Tuile titre="Manches" valeur={String(totals.rounds)} />
            <Tuile titre="Victoires" valeur={String(totals.wins)} />
            <Tuile
              titre="Meilleur coup"
              valeur={formatCoins(totals.bestWin)}
              ton={totals.bestWin > 0 ? "gain" : "neutre"}
            />
          </section>

          <section className="panel p-4 sm:p-5" aria-labelledby="courbe-titre">
            <h2 id="courbe-titre" className="font-display text-sm font-bold text-cream">
              Fortune des trente derniers jours
            </h2>
            <p className="mb-3 text-xs text-cream-faint">
              Gain cumulé, tous jeux confondus. Les jours sans partie comptent pour zéro.
            </p>
            <CourbeFortune points={fortune} />
          </section>

          <section className="panel p-4 sm:p-5" aria-labelledby="jeux-titre">
            <h2 id="jeux-titre" className="mb-3 font-display text-sm font-bold text-cream">
              Jeu par jeu
            </h2>
            <ul className="list-none space-y-2 p-0">
              {games.map((game) => (
                <LigneJeu key={game.game} game={game} maximum={amplitudeMax(games)} />
              ))}
            </ul>
          </section>

          <section className="panel p-4 sm:p-5" aria-labelledby="succes-titre">
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h2 id="succes-titre" className="font-display text-sm font-bold text-cream">
                Succès
              </h2>
              <span className="tabular text-xs text-brass-bright">
                {achievements.unlocked} / {achievements.total}
              </span>
            </div>

            {achievements.recent.length === 0 ? (
              <p className="text-sm text-cream-dim">Aucun succès débloqué pour l'instant.</p>
            ) : (
              <ul className="flex list-none flex-wrap gap-2 p-0">
                {achievements.recent.map((entry) => {
                  const succes = getAchievement(entry.code);
                  if (!succes) return null;
                  return (
                    <li key={entry.code}>
                      <Plaque tone="gain" className="normal-case">
                        {succes.name}
                      </Plaque>
                    </li>
                  );
                })}
              </ul>
            )}

            {moi && (
              <Lien
                to={{ name: "succes" }}
                className="mt-3 inline-flex min-h-11 items-center text-sm text-cream-dim transition-colors hover:text-cream"
              >
                Voir tous les succès
              </Lien>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** La plus grande valeur absolue du lot : c'est elle qui dimensionne les barres. */
function amplitudeMax(games: GameBreakdown[]): number {
  return Math.max(1, ...games.map((game) => Math.abs(game.net)));
}

function Tuile({
  titre,
  valeur,
  ton = "neutre",
}: {
  titre: string;
  valeur: string;
  ton?: "gain" | "perte" | "neutre";
}) {
  return (
    <div className="panel-plat p-4">
      <p className="text-xs uppercase tracking-wide text-cream-faint">{titre}</p>
      <p
        className={cn(
          "tabular mt-1 text-lg font-bold sm:text-xl",
          ton === "gain" ? "text-brass-bright" : ton === "perte" ? "text-danger" : "text-cream",
        )}
      >
        {valeur}
      </p>
    </div>
  );
}

/**
 * Un poste de la répartition par jeu.
 *
 * La barre est **signée et légendée** : le montant est écrit à côté, la couleur
 * ne fait que confirmer. Une barre rouge sans chiffre laisserait un daltonien
 * incapable de dire s'il gagne ou s'il perd.
 */
function LigneJeu({ game, maximum }: { game: GameBreakdown; maximum: number }) {
  const definition = getGame(game.game);
  const positif = game.net > 0;
  const largeur = (Math.abs(game.net) / maximum) * 100;

  return (
    <li className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-sm text-cream sm:w-36">
        {definition?.name ?? game.game}
      </span>

      <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-felt-high">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            positif ? "bg-brass/70" : game.net < 0 ? "bg-danger/60" : "bg-line-strong",
          )}
          style={{ width: `${Math.max(largeur, game.net === 0 ? 0 : 3)}%` }}
        />
      </span>

      <span className="w-28 shrink-0 text-right sm:w-40">
        <span
          className={cn(
            "tabular block text-sm font-semibold",
            positif ? "text-brass-bright" : game.net < 0 ? "text-danger" : "text-cream-dim",
          )}
        >
          {formatCoinsDelta(game.net)}
        </span>
        <span className="tabular block text-[11px] text-cream-faint">
          {game.rounds} manche{game.rounds > 1 ? "s" : ""}
          {game.bestAttempts !== null && ` · ${game.bestAttempts} essais`}
          {game.bestTimeMs !== null && ` · ${formatChrono(game.bestTimeMs)}`}
        </span>
      </span>
    </li>
  );
}
