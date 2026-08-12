export type GameActivity =
  | { kind: "table"; id: string }
  | { kind: "motus"; id: string };

const activities = new Map<string, GameActivity>();
const blockedUsers = new Set<string>();

/**
 * Réservation synchrone et idempotente d'une activité de jeu.
 * Aucun appelant ne doit placer un `await` entre ce contrôle et sa réservation.
 */
export function reserveActivity(userId: string, activity: GameActivity): boolean {
  if (blockedUsers.has(userId)) return false;
  const current = activities.get(userId);
  if (current) return current.kind === activity.kind && current.id === activity.id;
  activities.set(userId, activity);
  return true;
}

/** Une libération périmée ne doit jamais effacer l'activité qui l'a remplacée. */
export function releaseActivity(userId: string, activity: GameActivity): void {
  const current = activities.get(userId);
  if (current?.kind === activity.kind && current.id === activity.id) {
    activities.delete(userId);
  }
}

export function activityOf(userId: string): GameActivity | null {
  return activities.get(userId) ?? null;
}

/**
 * Réserve synchroniquement le compte pour une suppression.
 *
 * L'absence d'`await` est la garantie : aucune nouvelle partie ne peut se
 * glisser entre le contrôle d'activité et le blocage du compte.
 */
export function blockActivity(userId: string): boolean {
  if (activities.has(userId) || blockedUsers.has(userId)) return false;
  blockedUsers.add(userId);
  return true;
}

/** Libère toujours la réservation, succès ou échec de la suppression. */
export function unblockActivity(userId: string): void {
  blockedUsers.delete(userId);
}
