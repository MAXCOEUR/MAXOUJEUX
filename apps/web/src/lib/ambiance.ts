/**
 * Ce qui se déclenche tout seul : sons, confettis, pastille d'onglet.
 *
 * Tout est réuni ici plutôt que dispersé dans cinq gestionnaires de socket.
 * Chaque déclencheur compare l'état précédent au nouveau — le même motif que
 * `bindGameEvents` avec son `previous` — mais via `subscribe`, ce qui évite de
 * greffer des préoccupations d'ambiance dans la logique de jeu.
 *
 * **Règle absolue : un son par événement, jamais par rendu.** Chaque
 * déclencheur teste une *transition*, pas un état. Un `useEffect` sans garde
 * rejouerait le carillon du gain à chaque `setState`, et une table de poker en
 * émet plusieurs par seconde.
 *
 * Les moments **calés sur une animation** ne sont pas ici : le carillon de la
 * roue doit tomber quand elle s'arrête, pas quand le serveur répond six
 * secondes plus tôt. Ceux-là vivent dans les composants, avec leur minuterie.
 */

import type { GameCode } from "@maxoujeux/shared";
import { create } from "zustand";
import { useAudio } from "./audio";
import { useBlackjack } from "./blackjack";
import { useChat } from "./chat";
import { applyUnreadBadge } from "./favicon";
import { useGame } from "./game";
import { bindMusic } from "./musique";
import { usePoker } from "./poker";
import { useRoulette } from "./roulette";
import { playSound } from "./sounds";

// ---------------------------------------------------------------------------
// Fête d'un gain
// ---------------------------------------------------------------------------

interface CelebrationState {
  /**
   * Change à chaque gain à fêter.
   *
   * Une clé et non un booléen : deux gains d'affilée doivent relancer la pluie,
   * ce qu'un `true` déjà vrai ne ferait pas.
   */
  cle: number | null;
  intense: boolean;
}

export const useCelebration = create<CelebrationState>(() => ({ cle: null, intense: false }));

/** Seuil du gros gain : au-delà, arpège plus long et pluie plus dense. */
const GROS_GAIN = 5_000;

let cleSuivante = 0;

/**
 * Marque un gain : confettis et carillon.
 *
 * Point de passage unique, appelé aussi bien d'ici que des composants qui
 * attendent la fin de leur animation.
 */
export function celebrerGain(net: number): void {
  if (net <= 0) return;
  cleSuivante += 1;
  const intense = net >= GROS_GAIN;
  useCelebration.setState({ cle: cleSuivante, intense });
  playSound(intense ? "gros-gain" : "gain");
}

/** Marque une perte : son sourd, sans animation plein écran. */
export function marquerPerte(): void {
  playSound("perte");
}

/** Gain, perte ou rien, selon le net d'une manche. */
export function marquerResultat(net: number | null | undefined): void {
  if (net === null || net === undefined) return;
  if (net > 0) celebrerGain(net);
  else if (net < 0) marquerPerte();
}

// ---------------------------------------------------------------------------
// Abonnements
// ---------------------------------------------------------------------------

/** Le jeu de la table en cours, pour choisir la piste de musique. */
function jeuCourant(): GameCode | null {
  if (useBlackjack.getState().view) return "blackjack";
  if (useRoulette.getState().view) return "roulette";
  if (usePoker.getState().view) return "poker";
  const match = useGame.getState().match;
  return match ? (match.game as GameCode) : null;
}

/**
 * Branche toute l'ambiance. À appeler **une seule fois** au démarrage.
 *
 * @returns de quoi tout débrancher, pour les tests
 */
export function bindAmbiance(): () => void {
  const desabonnements: (() => void)[] = [];

  // --- Chat : son, pastille d'onglet et titre --------------------------------
  applyUnreadBadge(useChat.getState().unread);
  desabonnements.push(
    useChat.subscribe((state, previous) => {
      // Uniquement à la hausse : la remise à zéro de l'ouverture du panneau ne
      // doit évidemment pas sonner.
      if (state.unread > previous.unread) playSound("notification");
      applyUnreadBadge(state.unread);
    }),
  );

  // --- Duels : tour de parole et fin de partie -------------------------------
  desabonnements.push(
    useGame.subscribe((state, previous) => {
      const match = state.match;
      const avant = previous.match;
      if (!match || match.you === null) return;

      // La main passe au joueur : c'est le seul moment où il doit lever les yeux.
      if (match.turn === match.you && avant?.turn !== match.you && match.status === "playing") {
        playSound("tour");
      }

      if (match.status === "finished" && avant?.status !== "finished") {
        const outcome = match.outcome;
        if (!outcome) return;
        if (outcome.winnerSeat === match.you) {
          const gain = outcome.deltas.find((delta) => delta.seat === match.you)?.delta ?? 0;
          celebrerGain(gain);
        } else if (outcome.winnerSeat !== null) {
          marquerPerte();
        }
      }
    }),
  );

  // --- Blackjack -------------------------------------------------------------
  desabonnements.push(
    useBlackjack.subscribe((state, previous) => {
      const view = state.view;
      const avant = previous.view;
      if (!view || view.you === null) return;

      if (view.turn?.seat === view.you && avant?.turn?.seat !== view.you) {
        playSound("tour");
      }

      // Le règlement est annoncé par le passage en phase de résultat : le net du
      // siège n'est renseigné qu'à ce moment-là.
      if (view.phase === "result" && avant?.phase !== "result") {
        const moi = view.seats.find((seat) => seat.seat === view.you);
        marquerResultat(moi?.roundNet);
      }
    }),
  );

  // --- Roulette --------------------------------------------------------------
  desabonnements.push(
    useRoulette.subscribe((state, previous) => {
      const view = state.view;
      const avant = previous.view;
      if (!view || view.you === null) return;

      if (view.phase === "result" && avant?.phase !== "result") {
        const moi = view.players.find((player) => player.userId === view.you);
        marquerResultat(moi?.roundNet);
      }
    }),
  );

  // --- Poker -----------------------------------------------------------------
  desabonnements.push(
    usePoker.subscribe((state, previous) => {
      const view = state.view;
      const avant = previous.view;
      if (!view || view.you === null) return;

      if (view.turn === view.you && avant?.turn !== view.you) {
        playSound("tour");
      }

      // Fin de main : le pot est attribué, `won` est renseigné.
      if (view.phase === "payout" && avant?.phase !== "payout") {
        const moi = view.seats.find((seat) => seat.seat === view.you);
        const gagne = moi?.won ?? 0;
        // Au poker on compare au tapis engagé, pas au net d'une session : ce qui
        // se fête, c'est le pot ramassé.
        if (gagne > 0) celebrerGain(gagne);
      }
    }),
  );

  // --- Musique ---------------------------------------------------------------
  desabonnements.push(bindMusic(jeuCourant));

  return () => {
    for (const desabonner of desabonnements) desabonner();
  };
}

/** Le son du premier geste : confirme au joueur que l'audio est bien vivant. */
export function bindUnlockFeedback(): () => void {
  return useAudio.subscribe((state, previous) => {
    if (state.ready && !previous.ready) playSound("bouton");
  });
}
