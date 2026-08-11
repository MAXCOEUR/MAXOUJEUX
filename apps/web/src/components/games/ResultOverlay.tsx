import { formatCoins, formatCoinsDelta, type MatchView } from "@maxoujeux/shared";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/Button";

interface ResultOverlayProps {
  match: MatchView;
  onRejouer: () => void;
  onQuitter: () => void;
  rejouerLoading?: boolean;
}

/** Titre et ton du résultat, du point de vue du destinataire. */
function verdict(match: MatchView): { titre: string; detail: string; tone: "gain" | "perte" | "nul" } {
  const outcome = match.outcome;
  const you = match.you;
  if (!outcome || you === null) {
    return { titre: "Partie terminée", detail: "", tone: "nul" };
  }

  if (outcome.winnerSeat === null) {
    return {
      titre: "Égalité",
      detail: "Chacun récupère sa mise.",
      tone: "nul",
    };
  }

  const gagnant = outcome.winnerSeat === you;
  const adversaire = match.seats.find((seat) => seat.seat !== you)?.pseudo ?? "ton adversaire";

  if (gagnant) {
    const raison =
      outcome.reason === "timeout"
        ? `${adversaire} a laissé filer son temps.`
        : outcome.reason === "abandon"
          ? `${adversaire} a quitté la table.`
          : "Quatre alignés, la partie est à toi.";
    return { titre: "Gagné", detail: raison, tone: "gain" };
  }

  const raison =
    outcome.reason === "timeout"
      ? "Ton temps est écoulé."
      : outcome.reason === "abandon"
        ? "Tu as quitté la table."
        : `${adversaire} a aligné avant toi.`;
  return { titre: "Perdu", detail: raison, tone: "perte" };
}

/**
 * Résultat de fin de partie.
 *
 * Le focus est déplacé sur le titre à l'ouverture : sans cela, un joueur au
 * clavier reste sur le plateau devenu inerte et doit chercher les boutons.
 */
export function ResultOverlay({
  match,
  onRejouer,
  onQuitter,
  rejouerLoading = false,
}: ResultOverlayProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { titre, detail, tone } = verdict(match);
  const delta = match.you !== null
    ? match.outcome?.deltas.find((entry) => entry.seat === match.you)?.delta
    : undefined;

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <div
      role="alert"
      className="animate-flip-up panel absolute inset-x-0 bottom-0 z-10 mx-auto max-w-md p-5 text-center shadow-2xl sm:relative sm:mt-6"
    >
      <h2
        ref={titleRef}
        tabIndex={-1}
        className={cn(
          "font-display text-2xl font-extrabold outline-none",
          tone === "gain" ? "text-brass-bright" : tone === "perte" ? "text-danger" : "text-cream",
        )}
      >
        {titre}
      </h2>

      {detail && <p className="mt-1 text-sm text-cream-dim">{detail}</p>}

      {delta !== undefined && (
        <p
          className={cn(
            "tabular mt-3 text-xl font-bold",
            delta > 0 ? "text-win" : delta < 0 ? "text-danger" : "text-cream-dim",
          )}
        >
          {delta === 0 ? formatCoins(match.stake) + " rendus" : formatCoinsDelta(delta)}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button onClick={onRejouer} loading={rejouerLoading} className="flex-1">
          Nouvelle table
        </Button>
        <Button variant="outline" onClick={onQuitter} className="flex-1">
          Retour aux tables
        </Button>
      </div>
    </div>
  );
}
