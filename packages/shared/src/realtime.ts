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
import type { MotusGuessInput, MotusStartInput, MotusView } from "./motus.js";
import type {
  BlackjackActionInput,
  BlackjackBetInput,
  BlackjackInsuranceInput,
  BlackjackSitInput,
  BlackjackTableRefInput,
  BlackjackView,
} from "./blackjack.js";
import type {
  RouletteBetInput,
  RouletteSitInput,
  RouletteTableRefInput,
  RouletteView,
} from "./roulette.js";
import type { PlinkoDropInput, PlinkoRiskInput, PlinkoTableView } from "./plinko.js";
import type { WheelSpinInput, WheelView } from "./wheel.js";
import type { SlotsSpinInput, SlotsTableView } from "./slots.js";
import type {
  PokerActInput,
  PokerBlindsInput,
  PokerFollowInput,
  PokerRebuyInput,
  PokerSitInput,
  PokerRevealInput,
  PokerSitOutInput,
  PokerTableRefInput,
  PokerView,
} from "./poker.js";
import type { ChatMessage, ChatSendInput } from "./chat.js";

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
  "roulette:state": (view: RouletteView) => void;
  /**
   * État d'une planche de Plinko, diffusé au propriétaire et à ses spectateurs.
   *
   * Les billes voyagent dans cet état plutôt que dans un événement séparé : un
   * spectateur qui arrive en cours de route reçoit les billes déjà en vol et
   * peut les placer, là où un événement « une bille est partie » lui aurait
   * échappé.
   */
  "plinko:state": (view: PlinkoTableView) => void;
  /** La planche a fermé — son propriétaire est parti. */
  "plinko:closed": (payload: { tableId: string }) => void;
  /**
   * État de la salle de la roue.
   *
   * Personnalisé par destinataire : la roue et les spectateurs sont les mêmes
   * pour tous, mais le délai de 24 h ne l'est pas.
   */
  "wheel:state": (view: WheelView) => void;
  /**
   * État d'une machine à sous, diffusé au propriétaire et à ses spectateurs.
   *
   * Le tirage en cours voyage dans cet état, résultat compris : un spectateur
   * qui arrive pendant la rotation voit donc les mêmes rouleaux s'arrêter aux
   * mêmes symboles que le joueur.
   */
  "slots:state": (view: SlotsTableView) => void;
  /**
   * État d'une table de poker, **filtré par destinataire**.
   *
   * C'est le seul jeu où deux joueurs de la même table ne reçoivent pas le même
   * message : les cartes privées d'un adversaire n'y figurent tout simplement
   * pas.
   */
  "poker:state": (view: PokerView) => void;
  /** La machine a fermé — son propriétaire est parti. */
  "slots:closed": (payload: { tableId: string }) => void;
  "chat:message": (message: ChatMessage) => void;
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
  "motus:start": (payload: MotusStartInput, ack: (reply: ActionReply) => void) => void;
  "motus:guess": (payload: MotusGuessInput, ack: (reply: ActionReply) => void) => void;
  "motus:abandon": (ack: (reply: ActionReply) => void) => void;

  "blackjack:bet": (payload: BlackjackBetInput, ack: (reply: ActionReply) => void) => void;
  "blackjack:insurance": (payload: BlackjackInsuranceInput, ack: (reply: ActionReply) => void) => void;
  "blackjack:act": (payload: BlackjackActionInput, ack: (reply: ActionReply) => void) => void;
  /**
   * Prendre une place précise. On entre à la table par `tables:join`, qui n'y
   * donne qu'un statut de spectateur : s'asseoir est un geste distinct, et le
   * numéro de place en est l'objet — au blackjack, l'ordre de jeu compte.
   */
  "blackjack:sit": (payload: BlackjackSitInput, ack: (reply: ActionReply) => void) => void;
  /** Rendre sa place et redevenir spectateur, sans quitter la table. */
  "blackjack:stand": (payload: BlackjackTableRefInput, ack: (reply: ActionReply) => void) => void;

  /**
   * Confirmer une mise de roulette : plusieurs cases d'un coup, un seul débit.
   * Le joueur compose sur le tapis avant d'envoyer, et peut confirmer plusieurs
   * fois tant que la fenêtre est ouverte.
   */
  "roulette:bet": (payload: RouletteBetInput, ack: (reply: ActionReply) => void) => void;
  /** Reprendre l'intégralité de ses jetons, tant que la bille n'est pas partie. */
  "roulette:clear": (payload: RouletteTableRefInput, ack: (reply: ActionReply) => void) => void;
  /**
   * Prendre place au tapis. On entre à la roulette pour regarder ; s'asseoir est
   * le geste qui ouvre le droit de miser, comme au blackjack.
   */
  "roulette:sit": (payload: RouletteSitInput, ack: (reply: ActionReply) => void) => void;
  /** Rendre sa place et redevenir spectateur, sans quitter la table. */
  "roulette:stand": (payload: RouletteSitInput, ack: (reply: ActionReply) => void) => void;

  /** Entrer dans la salle de la roue : l'accusé porte l'état initial. */
  "wheel:enter": (ack: (reply: ActionReply<WheelView>) => void) => void;
  /** Sortir de la salle. Le compte n'en sort qu'à son dernier onglet. */
  "wheel:leave": () => void;
  /** Miser et lancer. Une fois par 24 h, et seulement si la roue est libre. */
  "wheel:spin": (payload: WheelSpinInput, ack: (reply: ActionReply) => void) => void;

  /** Prendre une place au tapis et se caver. */
  "poker:sit": (payload: PokerSitInput, ack: (reply: ActionReply) => void) => void;
  /** Rendre sa place, récupérer ses jetons, rester spectateur. */
  "poker:stand": (payload: PokerTableRefInput, ack: (reply: ActionReply) => void) => void;
  /** Se recaver, entre deux mains seulement. */
  "poker:rebuy": (payload: PokerRebuyInput, ack: (reply: ActionReply) => void) => void;
  /** Parler : se coucher, checker, suivre, miser, relancer, tapis. */
  "poker:act": (payload: PokerActInput, ack: (reply: ActionReply) => void) => void;
  /** Régler les blindes. Réservé au créateur, effet à la main suivante. */
  "poker:blinds": (payload: PokerBlindsInput, ack: (reply: ActionReply) => void) => void;
  /** Se mettre en pause, ou revenir. */
  "poker:sitout": (payload: PokerSitOutInput, ack: (reply: ActionReply) => void) => void;
  /** Choisir le joueur dont la main sera visible au récapitulatif, jamais en direct. */
  "poker:follow": (payload: PokerFollowInput, ack: (reply: ActionReply) => void) => void;
  /** Montrer son jeu après s'être couché. Sans retour en arrière. */
  "poker:reveal": (payload: PokerRevealInput, ack: (reply: ActionReply) => void) => void;

  /** Tirer les rouleaux. Réservé au propriétaire de la machine. */
  "slots:spin": (payload: SlotsSpinInput, ack: (reply: ActionReply) => void) => void;

  /** Lâcher une bille. Réservé au propriétaire de la table. */
  "plinko:drop": (payload: PlinkoDropInput, ack: (reply: ActionReply) => void) => void;
  /** Changer de niveau de risque entre deux billes. */
  "plinko:risk": (payload: PlinkoRiskInput, ack: (reply: ActionReply) => void) => void;
  "chat:send": (payload: ChatSendInput, ack: (reply: ActionReply) => void) => void;
}

/** Données attachées à la socket côté serveur, résolues au handshake. */
export interface SocketData {
  userId: string;
  pseudo: string;
  avatarSeed: string;
}
