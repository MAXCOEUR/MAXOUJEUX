/**
 * Contrat des événements Socket.IO, typé des deux côtés.
 *
 * Convention : `namespace:verbe`.
 * - Les événements émis par le client sont des *intentions* — jamais un résultat.
 *   Le serveur valide, applique, puis diffuse l'état. Le client ne calcule rien.
 * - Les événements émis par le serveur transportent un état déjà filtré pour
 *   le destinataire (aucune information cachée d'un adversaire n'est envoyée).
 *
 * Le lot 0 ne couvre que la présence dans le lobby ; les namespaces de jeu
 * viendront s'ajouter ici au lot 1.
 */

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
}

/** Événements client → serveur. */
export interface ClientToServerEvents {
  /** Demande explicite de resynchronisation, utilisée après une reconnexion. */
  "presence:sync": () => void;
}

/** Données attachées à la socket côté serveur, résolues au handshake. */
export interface SocketData {
  userId: string;
  pseudo: string;
  avatarSeed: string;
}
