export type GameActivity =
  | { kind: "table"; id: string }
  | { kind: "motus"; id: string };

const activities = new Map<string, GameActivity>();

/**
 * Réservation synchrone et idempotente d'une activité de jeu.
 * Aucun appelant ne doit placer un `await` entre ce contrôle et sa réservation.
 */
export function reserveActivity(userId: string, activity: GameActivity): boolean {
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
