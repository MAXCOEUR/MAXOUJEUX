/**
 * Correction de la dérive d'horloge entre le navigateur et le serveur.
 *
 * Un téléphone réglé trente secondes en avance calculerait un tour déjà expiré
 * alors que le serveur attend encore : l'anneau serait vide, le compteur à zéro,
 * et le joueur croirait à un bug. Le symptôme est invisible sur la machine du
 * développeur, dont l'horloge est juste.
 *
 * On ne corrige que l'**affichage** : c'est le serveur qui tranche l'expiration
 * d'un tour, l'horloge du client ne décide de rien.
 */

/** Écart mesuré : horloge serveur moins horloge locale, en millisecondes. */
let offset = 0;

/**
 * Recale l'écart depuis un instant serveur.
 *
 * Chaque état de partie et chaque instantané de salon en transporte un
 * (`now`), ce qui suffit à garder le décalage à jour sans requête dédiée.
 * Le trajet réseau est ignoré : il vaut quelques dizaines de millisecondes,
 * négligeable devant les 30 secondes d'un tour.
 */
export function syncServerClock(serverNowIso: string): void {
  const serverNow = new Date(serverNowIso).getTime();
  if (Number.isNaN(serverNow)) return;
  offset = serverNow - Date.now();
}

/** Instant courant selon le serveur. */
export function serverNow(): number {
  return Date.now() + offset;
}

/** Millisecondes restantes avant une échéance ISO, jamais négatif. */
export function msUntilServer(targetIso: string | null | undefined): number {
  if (!targetIso) return 0;
  const target = new Date(targetIso).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, target - serverNow());
}

/** Millisecondes écoulées depuis un instant ISO, jamais négatif. */
export function msSinceServer(startIso: string | null | undefined): number {
  if (!startIso) return 0;
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, serverNow() - start);
}
