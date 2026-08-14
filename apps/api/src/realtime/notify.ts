/**
 * Pont entre la logique métier et la couche temps réel.
 *
 * Le service de porte-monnaie doit pouvoir prévenir un joueur que son solde a
 * bougé, sans pour autant importer Socket.IO : il resterait alors impossible de
 * le tester sans démarrer un serveur. La couche temps réel s'enregistre ici au
 * démarrage, et le service se contente d'appeler `notifyWallet`.
 *
 * Tant que rien n'est enregistré (tests unitaires, scripts), les notifications
 * sont silencieusement ignorées.
 */

/** Ce qui peut changer dans l'identité affichée d'un joueur en cours de session. */
export interface IdentityPatch {
  pseudo?: string;
  avatarSeed?: string;
}

type WalletNotifier = (userId: string, balance: number) => void;
type DisconnectNotifier = (userId: string) => void;
type IdentityNotifier = (userId: string, patch: IdentityPatch) => void;
type AchievementNotifier = (userId: string, codes: string[]) => void;

let walletNotifier: WalletNotifier | null = null;
let disconnectNotifier: DisconnectNotifier | null = null;
let identityNotifier: IdentityNotifier | null = null;
let achievementNotifier: AchievementNotifier | null = null;

export function setWalletNotifier(notifier: WalletNotifier): void {
  walletNotifier = notifier;
}

export function notifyWallet(userId: string, balance: number): void {
  walletNotifier?.(userId, balance);
}

export function setDisconnectNotifier(notifier: DisconnectNotifier): void {
  disconnectNotifier = notifier;
}

export function disconnectUser(userId: string): void {
  disconnectNotifier?.(userId);
}

export function setIdentityNotifier(notifier: IdentityNotifier): void {
  identityNotifier = notifier;
}

/**
 * Signale qu'un joueur a changé de pseudo ou d'avatar.
 *
 * L'identité est résolue **à la poignée de main** puis recopiée dans
 * `socket.data` : sans cette reprise, le prochain message de chat du joueur
 * repartirait sous son ancien nom, et il faudrait recharger la page pour s'en
 * sortir.
 */
export function notifyIdentity(userId: string, patch: IdentityPatch): void {
  identityNotifier?.(userId, patch);
}

export function setAchievementNotifier(notifier: AchievementNotifier): void {
  achievementNotifier = notifier;
}

/**
 * Annonce des succès fraîchement débloqués.
 *
 * Diffusé à toutes les sockets du joueur : le succès peut tomber sur une table
 * de poker ouverte dans un autre onglet que celui qu'il regarde.
 */
export function notifyAchievements(userId: string, codes: string[]): void {
  if (codes.length === 0) return;
  achievementNotifier?.(userId, codes);
}
