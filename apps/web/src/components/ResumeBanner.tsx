import { getGame } from "@maxoujeux/shared";
import { Flag } from "lucide-react";
import { Button } from "./Button";
import { Countdown } from "./Countdown";
import { useGame } from "@/lib/game";
import { navigate, useRoute } from "@/lib/route";

/**
 * Bandeau « partie en cours ».
 *
 * Traduction visuelle de la règle posée dans `CLAUDE.md` : quitter la table ne
 * coupe rien. Un joueur qui va consulter son porte-monnaie ou le lobby doit
 * pouvoir revenir en un geste — et surtout **voir** que son chronomètre tourne,
 * sinon il perd sa mise sans comprendre.
 */
export function ResumeBanner() {
  const match = useGame((state) => state.match);
  const route = useRoute();

  if (!match || match.status !== "playing") return null;
  if (route.name === "table" && route.tableId === match.id) return null;

  const adversaire = match.seats.find((seat) => seat.seat !== match.you);
  const monTour = match.turn === match.you;

  return (
    <div className="border-b border-brass/30 bg-brass/10">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
        <Flag className="size-4 shrink-0 text-brass" aria-hidden />

        <p className="min-w-0 flex-1 text-sm text-cream">
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
        </p>

        <Button
          onClick={() => navigate({ name: "table", tableId: match.id })}
          className="shrink-0 px-3 py-1.5 text-xs"
        >
          Reprendre
        </Button>
      </div>
    </div>
  );
}
