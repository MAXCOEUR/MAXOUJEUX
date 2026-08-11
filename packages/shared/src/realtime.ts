/**
 * Contrat des événements Socket.IO, typé des deux côtés.
 *
 * Convention : `namespace:verbe`.
 * - Les événements émis par le client sont des *intentions* — jamais un résultat.
 *   Le serveur valide, applique, puis diffuse l'état. Le client ne calcule rien.
 * - Les événements émis par le serveur transportent un état déjà filtré pour
 *   le destinataire (aucune information cachée d'un adversaire n'est envoyée).
 *
 * Les intentions qui peuvent être refusées portent un **accusé de réception
 * typé** plutôt que de compter sur `error:app` : le front doit savoir *quelle*
 * action a échoué pour afficher le message sous le bouton concerné, et non dans
 * une notification détachée du geste.
 */

import type {
  ActionReply,
  CreateTableInput,
  ActiveMatchView,
  MatchView,
  PlayInput,
  SalonSnapshot,
  TableCounts,
  TableRefInput,
} from "./tables.js";
import type { GameCode } from "./games.js";
import type { MotusGuessInput, MotusView } from "./motus.js";
import type { BlackjackActionInput, BlackjackBetInput, BlackjackInsuranceInput, BlackjackView } from "./blackjack.js";

export interface PresencePlayer {
  userId: string;
  pseudo: string;
  avatarSeed: string;
}

export interface PresenceSnapshot {
  online: number;
  players: PresencePlayer[];
}

/** Événements serveur → client. */
export interface ServerToClientEvents {
  "presence:update": (snapshot: PresenceSnapshot) => void;
  /**
   * Nouveau solde MaxouCoin, diffusé à toutes les sockets du joueur.
   *
   * Encaisser un bonus dans un onglet pendant qu'une table de poker est ouverte
   * dans un autre ne doit pas laisser un solde périmé à l'écran.
   */
  "wallet:update": (payload: { balance: number }) => void;
  /** Erreur applicative rattachée à une intention refusée. */
  "error:app": (payload: { code: string; message: string }) => void;

  /** Liste des tables d'un salon, diffusée à ses observateurs à chaque changement. */
  "tables:update": (snapshot: SalonSnapshot) => void;
  /** Comptage par jeu, pour les cartes du lobby. Diffusé à tout le monde. */
  "tables:counts": (counts: Partial<Record<GameCode, TableCounts>>) => void;

  /**
   * État de la partie du destinataire.
   *
   * Un **seul** canal d'état, sans événement de fait de jeu en parallèle :
   * `lastMove` et `version` suffisent à déclencher les animations, et deux
   * sources finiraient par se contredire après une reconnexion.
   */
  "match:state": (view: MatchView) => void;
  /** Le destinataire n'est à aucune table : réponse à `match:sync`. */
  "match:none": () => void;
  /** État Motus filtré : le mot du créneau n'appartient jamais à ce contrat. */
  "motus:state": (view: MotusView) => void;
  /** État Blackjack : cartes des joueurs publiques, carte fermée du croupier masquée. */
  "blackjack:state": (view: BlackjackView) => void;
}

/** Événements client → serveur. */
export interface ClientToServerEvents {
  /** Demande explicite de resynchronisation, utilisée après une reconnexion. */
  "presence:sync": () => void;

  /** Observer un salon : la réponse contient l'instantané initial. */
  "tables:watch": (
    payload: { game: GameCode },
    ack: (reply: ActionReply<SalonSnapshot>) => void,
  ) => void;
  "tables:unwatch": (payload: { game: GameCode }) => void;
  "tables:create": (
    payload: CreateTableInput,
    ack: (reply: ActionReply<{ tableId: string }>) => void,
  ) => void;
  "tables:join": (
    payload: TableRefInput,
    ack: (reply: ActionReply<{ tableId: string }>) => void,
  ) => void;

  /**
   * Où en suis-je ?
   *
   * À émettre à **chaque** connexion : une reconnexion Socket.IO fournit un
   * nouvel identifiant de socket, donc plus aucune room. Sans cette demande, un
   * joueur reconnecté ne reçoit plus rien de sa propre partie.
   */
  "match:sync": (ack: (reply: ActionReply<ActiveMatchView | null>) => void) => void;
  "match:play": (payload: PlayInput, ack: (reply: ActionReply) => void) => void;
  /** Quitter la table : abandon si la partie a commencé, remboursement sinon. */
  "match:leave": (payload: TableRefInput, ack: (reply: ActionReply) => void) => void;

  /** Observer Motus et récupérer immédiatement la tentative à reprendre. */
  "motus:watch": (ack: (reply: ActionReply<MotusView>) => void) => void;
  /** Quitter l'écran suspend la tentative sans la terminer. */
  "motus:unwatch": () => void;
  "motus:start": (ack: (reply: ActionReply) => void) => void;
  "motus:guess": (payload: MotusGuessInput, ack: (reply: ActionReply) => void) => void;
  "motus:abandon": (ack: (reply: ActionReply) => void) => void;

  "blackjack:bet": (payload: BlackjackBetInput, ack: (reply: ActionReply) => void) => void;
  "blackjack:insurance": (payload: BlackjackInsuranceInput, ack: (reply: ActionReply) => void) => void;
  "blackjack:act": (payload: BlackjackActionInput, ack: (reply: ActionReply) => void) => void;
}

/** Données attachées à la socket côté serveur, résolues au handshake. */
export interface SocketData {
  userId: string;
  pseudo: string;
  avatarSeed: string;
}
