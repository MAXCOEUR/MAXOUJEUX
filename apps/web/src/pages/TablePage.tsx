import {
  formatCoins,
  getGame,
  type CurrentUser,
  type ActiveMatchView,
  type MatchView,
  type Seat,
} from "@maxoujeux/shared";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Countdown } from "@/components/Countdown";
import { Lien } from "@/components/Lien";
import { PlayerSeat } from "@/components/PlayerSeat";
import { Connect4Board } from "@/components/games/Connect4Board";
import { ResultOverlay } from "@/components/games/ResultOverlay";
import { TicTacToeBoard } from "@/components/games/TicTacToeBoard";
import { cn } from "@/lib/cn";
import { useGame } from "@/lib/game";
import { useBlackjack } from "@/lib/blackjack";
import { useRoulette } from "@/lib/roulette";
import { navigate } from "@/lib/route";
import { request, useRealtime } from "@/lib/socket";
import { pushToast } from "@/lib/toast";
import { BlackjackTablePage } from "@/pages/BlackjackTablePage";
import { RouletteTablePage } from "@/pages/RouletteTablePage";

/**
 * Table de jeu.
 *
 * L'état vient **exclusivement** du serveur. Le plateau se contente de rendre
 * ce qu'il reçoit et de verrouiller l'entrée le temps d'un aller-retour : aucun
 * coup n'est appliqué localement, aucune règle n'est évaluée ici.
 */
export function TablePage({ user, tableId }: { user: CurrentUser; tableId: string }) {
  const match = useGame((state) => state.match);
  const blackjack = useBlackjack((state) => state.view);
  const roulette = useRoulette((state) => state.view);
  const status = useRealtime((state) => state.status);

  // Demande de resynchronisation à l'arrivée : le joueur a pu ouvrir cette
  // adresse directement, ou recharger sa page en pleine partie.
  useEffect(() => {
    if (match?.id === tableId || blackjack?.id === tableId || roulette?.id === tableId) return;
    void request<ActiveMatchView | null>((socket, ack) => socket.emit("match:sync", ack)).then((reply) => {
      if (!reply.ok || !reply.data) return;
      if (reply.data.game === "blackjack") useBlackjack.getState().apply(reply.data);
      else if (reply.data.game === "roulette") useRoulette.getState().apply(reply.data);
      else useGame.getState().apply(reply.data);
    });
  }, [tableId, match?.id, blackjack?.id, roulette?.id]);

  if (blackjack?.id === tableId) return <BlackjackTablePage user={user} view={blackjack} />;
  if (roulette?.id === tableId) return <RouletteTablePage user={user} view={roulette} />;

  // Garde séparé du contenu : tout ce qui suit a besoin d'une partie chargée, et
  // la passer en propriété évite de la revérifier dans chaque gestionnaire.
  if (!match || match.id !== tableId) {
    return (
      <div className="grid place-items-center py-20">
        {status === "connected" ? (
          <div className="text-center">
            <p className="text-sm text-cream-dim">Cette table n'est plus accessible.</p>
            <Lien to={{ name: "lobby" }} className="mt-4 inline-block">
              <Button variant="outline">Retour au lobby</Button>
            </Lien>
          </div>
        ) : (
          <Loader2 className="size-6 animate-spin text-cream-faint" aria-label="Chargement" />
        )}
      </div>
    );
  }

  return <TableContent user={user} match={match} />;
}

function TableContent({ user, match }: { user: CurrentUser; match: MatchView }) {
  const tableId = match.id;
  const pending = useGame((state) => state.pending);
  const resultSeen = useGame((state) => state.resultSeen);
  const markPending = useGame((state) => state.markPending);
  const clearPending = useGame((state) => state.clearPending);
  const acknowledgeResult = useGame((state) => state.acknowledgeResult);
  const [leaving, setLeaving] = useState(false);

  const definition = getGame(match.game);
  const you = match.you;
  const monTour = match.status === "playing" && you !== null && match.turn === you;
  const jouable = monTour && pending === null;

  async function jouer(move: number) {
    markPending(move);
    const reply = await request<null>((socket, ack) =>
      socket.emit("match:play", { tableId, move, version: match.version }, ack),
    );
    if (!reply.ok) {
      clearPending();
      pushToast("erreur", reply.message);
    }
    // En cas de succès, c'est l'arrivée du nouvel état qui déverrouille le
    // plateau : le déverrouiller ici laisserait une fenêtre où le joueur peut
    // rejouer avant de voir son propre coup.
  }

  async function quitter() {
    setLeaving(true);
    const reply = await request<null>((socket, ack) =>
      socket.emit("match:leave", { tableId }, ack),
    );
    setLeaving(false);
    if (!reply.ok && reply.code !== "TABLE_GONE") {
      pushToast("erreur", reply.message);
      return;
    }
    navigate({ name: "salon", game: match.game });
  }

  const retourSalon = () => {
    useGame.getState().clear();
    navigate({ name: "salon", game: match.game });
  };

  const termine = match.status === "finished" || match.status === "cancelled";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Lien
          to={{ name: "salon", game: match.game }}
          className="inline-flex items-center gap-1.5 text-sm text-cream-dim transition-colors hover:text-cream"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {definition?.name ?? "Les tables"}
        </Lien>

        {!termine && match.status === "playing" && (
          <Button variant="ghost" onClick={quitter} loading={leaving} className="text-xs">
            Abandonner
          </Button>
        )}
      </div>

      {/* En-tête de table. En paysage sur téléphone, les sièges se placent de
          part et d'autre du plateau : sinon le plateau sort de l'écran. */}
      <section className="panel p-4">
        <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <PlayerSeat
            occupant={match.seats.find((seat) => seat.seat === 0) ?? null}
            seat={0}
            self={you === 0}
            active={match.turn === 0}
            match={match}
          />

          <div className="order-last col-span-2 flex items-center justify-center gap-4 border-t border-line pt-3 sm:order-none sm:col-span-1 sm:flex-col sm:gap-1 sm:border-0 sm:pt-0">
            <div className="text-center">
              <p className="text-xs text-cream-faint">Pot</p>
              <p className="tabular text-lg font-bold text-brass-bright">
                {formatCoins(match.pot)}
              </p>
            </div>
            {match.status === "playing" && match.deadlineAt && (
              <div className="text-center">
                <p className="text-xs text-cream-faint">Temps</p>
                <Countdown
                  to={match.deadlineAt}
                  format="horloge"
                  urgentBelowMs={6_000}
                  className="text-lg font-bold text-cream"
                  fallback={<span className="tabular text-lg font-bold text-danger">0:00</span>}
                />
              </div>
            )}
          </div>

          <PlayerSeat
            occupant={match.seats.find((seat) => seat.seat === 1) ?? null}
            seat={1}
            self={you === 1}
            active={match.turn === 1}
            match={match}
          />
        </div>
      </section>

      {match.status === "waiting" && <WaitingNotice stake={match.stake} onCancel={quitter} leaving={leaving} />}

      <div className={cn("relative", match.status === "waiting" && "opacity-50")}>
        {match.game === "connect4" ? (
          <Connect4Board
            match={match}
            you={you}
            playable={jouable}
            pending={pending}
            onPlay={jouer}
          />
        ) : (
          <TicTacToeBoard
            match={match}
            you={you}
            playable={jouable}
            pending={pending}
            onPlay={jouer}
          />
        )}
      </div>

      {/* Une seule région annoncée, dont on ne change que le texte : remplacer
          le nœud empêcherait certains lecteurs d'écran d'annoncer quoi que ce
          soit. Le compte à rebours n'y figure pas — annoncer chaque seconde
          rendrait la page inutilisable. */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage(match, you)}
      </p>

      {termine && !resultSeen && (
        <ResultOverlay
          match={match}
          onRejouer={() => {
            acknowledgeResult();
            retourSalon();
          }}
          onQuitter={() => {
            acknowledgeResult();
            retourSalon();
          }}
        />
      )}

      {termine && resultSeen && (
        <div className="text-center">
          <Button variant="outline" onClick={retourSalon}>
            Retour aux tables
          </Button>
        </div>
      )}

      <p className="text-center text-xs text-cream-faint">
        Connecté en tant que {user.pseudo}. Le serveur arbitre chaque coup.
      </p>
    </div>
  );
}

function WaitingNotice({
  stake,
  onCancel,
  leaving,
}: {
  stake: number;
  onCancel: () => void;
  leaving: boolean;
}) {
  return (
    <div className="panel flex flex-col items-center gap-3 p-5 text-center">
      <Loader2 className="size-5 animate-spin text-brass" aria-hidden />
      <div>
        <p className="text-sm text-cream">En attente d'un adversaire</p>
        <p className="mt-1 text-xs text-cream-faint">
          Ta mise de {formatCoins(stake)} est engagée. Elle te sera rendue si personne ne vient.
        </p>
      </div>
      <Button variant="outline" onClick={onCancel} loading={leaving} className="text-xs">
        Annuler la table
      </Button>
    </div>
  );
}

/** Message annoncé aux lecteurs d'écran. */
function liveMessage(match: MatchView, you: Seat | null): string {
  if (match.status === "waiting") return "En attente d'un adversaire.";

  if (match.outcome) {
    if (match.outcome.winnerSeat === null) return "Égalité. Les mises sont rendues.";
    const gagnant = match.seats.find((seat) => seat.seat === match.outcome?.winnerSeat);
    return match.outcome.winnerSeat === you
      ? "Tu as gagné la partie."
      : `${gagnant?.pseudo ?? "Ton adversaire"} a gagné la partie.`;
  }

  if (match.turn === you) return "À toi de jouer.";
  const adversaire = match.seats.find((seat) => seat.seat === match.turn);
  return `Au tour de ${adversaire?.pseudo ?? "ton adversaire"}.`;
}
