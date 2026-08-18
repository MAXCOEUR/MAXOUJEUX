/**
 * Types du serveur temps réel.
 *
 * Isolés de `realtime/index.ts` pour que les modules de gestionnaires puissent
 * les importer sans créer de cycle avec le fichier qui les enregistre.
 */

import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "@maxoujeux/shared";
import type { Server, Socket } from "socket.io";

/** Le quatrième paramètre est `never` : aucun échange entre instances Node. */
export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

/** Nom de la room privée d'un compte, partagée par tous ses appareils. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Nom de la room d'une session HTTP précise. */
export function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

/** Room des observateurs du salon d'un jeu. */
export function lobbyRoom(game: string): string {
  return `lobby:${game}`;
}
