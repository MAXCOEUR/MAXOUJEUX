import { formatCoins, getGame } from "@maxoujeux/shared";
import { Eye, Flag } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { Countdown } from "./Countdown";
import { blackjackResume } from "@/lib/blackjack-state";
import { useBlackjack } from "@/lib/blackjack";
import { useGame } from "@/lib/game";
import { useRoulette } from "@/lib/roulette";
import { rouletteResume } from "@/lib/roulette-ui";
import { navigate, useRoute } from "@/lib/route";

/**
 * Bandeau « partie en cours ».
 *
 * Traduction visuelle de la règle posée dans `CLAUDE.md` : quitter la table ne
 * coupe rien. Un joueur qui va consulter son porte-monnaie ou le lobby doit
 * pouvoir revenir en un geste — et surtout **voir** que son chronomètre tourne,
 * sinon il perd sa mise sans comprendre.
 *
 * Le blackjack en a d'autant plus besoin : sa place et son verrou d'activité
 * lui restent acquis même debout du tapis, y compris en simple spectateur.
 * Sans ce rappel, il chercherait pourquoi le salon lui refuse une autre table.
 */
export function ResumeBanner() {
  const match = useGame((state) => state.match);
  const blackjack = useBlackjack((state) => state.view);
  const roulette = useRoulette((state) => state.view);
  const route = useRoute();
  const tableAffichee = route.name === "table" ? route.tableId : null;

  // Le blackjack passe devant : un joueur ne peut pas être aux deux à la fois,
  // et sa table est celle dont l'état bouge à chaque carte.
  const bj = blackjackResume(blackjack, tableAffichee);
  if (bj) {
    return (
      <Banner
        icon={bj.seated ? <Flag className="size-4 shrink-0 text-brass" aria-hidden /> : <Eye className="size-4 shrink-0 text-cream-faint" aria-hidden />}
        tableId={bj.tableId}
      >
        {bj.seated ? "Table de Blackjack" : "Tu regardes la table de Blackjack"}
        {bj.myTurn ? (
          <>
            {" — "}
            <span className="font-semibold text-win">à toi de jouer</span>
            {bj.deadlineAt && (
              <>
                {", "}
                <Countdown to={bj.deadlineAt} format="horloge" urgentBelowMs={6_000} />
              </>
            )}
          </>
        ) : bj.wager > 0 ? (
          <span className="text-cream-dim"> — {formatCoins(bj.wager)} en jeu</span>
        ) : bj.seated ? (
          <span className="text-cream-dim"> — ta place est gardée</span>
        ) : null}
      </Banner>
    );
  }

  const repriseRoulette = rouletteResume(roulette, tableAffichee);
  if (repriseRoulette) {
    return (
      <Banner
        icon={<Flag className="size-4 shrink-0 text-brass" aria-hidden />}
        tableId={repriseRoulette.tableId}
      >
        Table de Roulette
        {repriseRoulette.wager > 0 ? (
          <span className="text-cream-dim"> — {formatCoins(repriseRoulette.wager)} en jeu</span>
        ) : (
          <span className="text-cream-dim"> — ta place est gardée</span>
        )}
      </Banner>
    );
  }

  if (!match || match.status !== "playing") return null;
  if (tableAffichee === match.id) return null;

  const adversaire = match.seats.find((seat) => seat.seat !== match.you);
  const monTour = match.turn === match.you;

  return (
    <Banner icon={<Flag className="size-4 shrink-0 text-brass" aria-hidden />} tableId={match.id}>
      Partie de {getGame(match.game)?.name ?? "jeu"} en cours
      {adversaire ? ` contre ${adversaire.pseudo}` : ""}
      {monTour ? (
        <>
          {" — "}
          <span className="font-semibold text-win">à toi de jouer</span>
          {match.deadlineAt && (
            <>
              {", "}
              <Countdown to={match.deadlineAt} format="horloge" urgentBelowMs={6_000} />
            </>
          )}
        </>
      ) : (
        " — au tour de l'adversaire"
      )}
    </Banner>
  );
}

/** Coquille commune : même gabarit pour un duel et pour une table de blackjack. */
function Banner({
  icon,
  tableId,
  children,
}: {
  icon: ReactNode;
  tableId: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-brass/30 bg-brass/10">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
        {icon}
        <p className="min-w-0 flex-1 text-sm text-cream">{children}</p>
        <Button
          onClick={() => navigate({ name: "table", tableId })}
          className="shrink-0 px-3 py-1.5 text-xs"
        >
          Reprendre
        </Button>
      </div>
    </div>
  );
}
