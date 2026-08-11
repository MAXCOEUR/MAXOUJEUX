import type { PresencePlayer, PresenceSnapshot } from "@maxoujeux/shared";

/**
 * Registre des joueurs connectés, en mémoire.
 *
 * Un même compte peut ouvrir plusieurs onglets : on compte les sockets par
 * utilisateur et on ne le retire du lobby qu'à la fermeture de la dernière.
 * Sans ce comptage, fermer un onglet ferait disparaître le joueur alors qu'il
 * est toujours là.
 *
 * L'état est volontairement non persistant : au redémarrage de l'API, plus
 * personne n'est connecté, ce qui est exact.
 */

interface Entry {
  player: PresencePlayer;
  sockets: number;
}

const entries = new Map<string, Entry>();

/** @returns true si le joueur vient d'apparaître dans le lobby. */
export function addConnection(player: PresencePlayer): boolean {
  const existing = entries.get(player.userId);
  if (existing) {
    existing.sockets += 1;
    return false;
  }
  entries.set(player.userId, { player, sockets: 1 });
  return true;
}

/** @returns true si le joueur vient de quitter le lobby. */
export function removeConnection(userId: string): boolean {
  const existing = entries.get(userId);
  if (!existing) return false;

  existing.sockets -= 1;
  if (existing.sockets > 0) return false;

  entries.delete(userId);
  return true;
}

export function presenceSnapshot(): PresenceSnapshot {
  const players = [...entries.values()]
    .map((entry) => entry.player)
    .sort((a, b) => a.pseudo.localeCompare(b.pseudo, "fr"));

  return { online: players.length, players };
}
