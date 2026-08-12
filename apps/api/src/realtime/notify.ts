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

type WalletNotifier = (userId: string, balance: number) => void;
type DisconnectNotifier = (userId: string) => void;

let walletNotifier: WalletNotifier | null = null;
let disconnectNotifier: DisconnectNotifier | null = null;

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
