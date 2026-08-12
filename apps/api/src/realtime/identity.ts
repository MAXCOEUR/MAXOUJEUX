import type { PlayerIdentity } from "../modules/tables/manager.js";
import type { GameSocket } from "./types.js";

/**
 * Identité authentifiée courante du joueur.
 *
 * Elle est relue à chaque action : le changement de pseudo ou d’avatar met
 * `socket.data` à jour sans reconnecter la socket.
 */
export function socketIdentity(socket: GameSocket): PlayerIdentity {
  return {
    userId: socket.data.userId,
    pseudo: socket.data.pseudo,
    avatarSeed: socket.data.avatarSeed,
  };
}
