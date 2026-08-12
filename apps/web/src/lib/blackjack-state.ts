import type { BlackjackView } from "@maxoujeux/shared";

export function isNewerBlackjackView(current: BlackjackView | null, incoming: BlackjackView): boolean {
  return !current || current.id !== incoming.id || incoming.version > current.version;
}

/** Ce que le bandeau de reprise a besoin de savoir d'une table quittée du regard. */
export interface BlackjackResume {
  tableId: string;
  /** Assis à une place, par opposition à simplement regarder. */
  seated: boolean;
  /** Une décision est attendue : c'est ce qui rend le bandeau urgent. */
  myTurn: boolean;
  /** Jetons engagés sur la manche en cours, 0 si rien n'est en jeu. */
  wager: number;
  /** Échéance du tour, **uniquement** si c'est celui du joueur. */
  deadlineAt: string | null;
}

/**
 * Résume la table de blackjack encore ouverte derrière le joueur.
 *
 * Fonction pure, hors de React et hors du routeur : le bandeau se teste alors
 * sans rendu ni navigateur. `currentTableId` est la table affichée à l'écran —
 * on ne propose pas de reprendre celle qu'on regarde déjà.
 *
 * L'échéance n'est rendue que si le tour est celui du joueur : afficher le
 * compte à rebours d'un voisin ferait croire à un forfait imminent et
 * précipiterait un retour inutile.
 */
export function blackjackResume(
  view: BlackjackView | null,
  currentTableId: string | null,
): BlackjackResume | null {
  if (!view || view.id === currentTableId) return null;

  const mine = view.you === null ? null : view.seats.find((seat) => seat.seat === view.you) ?? null;
  const myTurn = mine !== null && view.turn?.seat === mine.seat;

  return {
    tableId: view.id,
    seated: mine !== null,
    myTurn,
    wager: mine?.totalWager ?? 0,
    deadlineAt: myTurn ? view.deadlineAt : null,
  };
}
