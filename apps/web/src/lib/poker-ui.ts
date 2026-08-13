import {
  POKER_ACTION_LABELS,
  formatCoins,
  type PokerActionKind,
  type PokerSeatView,
  type PokerView,
} from "@maxoujeux/shared";

/**
 * Mise en scène du poker.
 *
 * Fonctions **pures** : aucune règle de jeu ici, uniquement de quoi placer les
 * sièges et écrire ce qui se passe. Le serveur reste seul arbitre.
 */

/**
 * Ordre d'affichage des sièges : le destinataire toujours en bas au centre.
 *
 * On fait tourner la table plutôt que de déplacer le joueur : c'est ce qu'on
 * attend d'une table de casino, où l'on se voit toujours devant soi.
 */
export function pokerSeatOrder(you: number | null, maxSeats: number): number[] {
  const places = Array.from({ length: maxSeats }, (_, place) => place);
  if (you === null) return places;
  return places.map((place) => (place + you) % maxSeats);
}

export interface OvalPose {
  /** Position en pourcentage de la largeur et de la hauteur du tapis. */
  x: number;
  y: number;
  scale: number;
}

/**
 * Place un siège sur l'ovale.
 *
 * Le premier siège est en bas au centre — c'est celui du destinataire — et les
 * autres se répartissent dans le sens horaire. L'ellipse est plus large que
 * haute, comme une vraie table : un cercle parfait donnerait des sièges collés
 * en haut et en bas.
 */
export function ovalPose(place: number, maxSeats: number): OvalPose {
  const angle = Math.PI / 2 + (place / maxSeats) * Math.PI * 2;
  const x = 50 + Math.cos(angle) * 42;
  const y = 50 + Math.sin(angle) * 38;
  // Les sièges du fond rapetissent légèrement : sans cela, ils paraissent
  // flotter au lieu d'être de l'autre côté du tapis.
  const profondeur = (Math.sin(angle) + 1) / 2;
  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    scale: Number((0.86 + profondeur * 0.14).toFixed(3)),
  };
}

/** Abscisse de départ d'une carte distribuée, en pourcentage de sa largeur. */
export function dealOriginX(place: number, maxSeats: number): number {
  const pose = ovalPose(place, maxSeats);
  // Les cartes partent du centre du tapis, où se tient le donneur.
  return Math.round((50 - pose.x) * 6);
}

/** Ce qu'un siège vient de faire, en une ligne. */
export function seatActionLabel(seat: PokerSeatView): string | null {
  if (seat.status === "folded") return "Couché";
  if (!seat.lastAction) return null;
  const { kind, amount } = seat.lastAction;
  if (kind === "fold") return "Couché";
  if (kind === "check") return POKER_ACTION_LABELS.check;
  if (kind === "allin") return "Tapis";
  return `${POKER_ACTION_LABELS[kind]} ${formatCoins(amount)}`;
}

/** Libellé du bouton d'action, montant compris — le joueur doit savoir avant de cliquer. */
export function actionButtonLabel(
  kind: PokerActionKind,
  allowed: NonNullable<PokerView["allowed"]>,
): string {
  switch (kind) {
    case "fold":
      return "Se coucher";
    case "check":
      return "Parole";
    case "call":
      return `Suivre ${formatCoins(allowed.callAmount)}`;
    case "bet":
      return "Miser";
    case "raise":
      return "Relancer";
    case "allin":
      return `Tapis ${formatCoins(allowed.maxRaiseTo)}`;
  }
}

/**
 * Annonce lue par les lecteurs d'écran.
 *
 * Une seule phrase par état, jamais de compte à rebours : un lecteur d'écran
 * énoncerait chaque seconde et couvrirait tout le reste.
 */
export function pokerAnnounce(view: PokerView): string {
  if (view.phase === "waiting") return "En attente d'un deuxième joueur.";
  if (view.phase === "payout") {
    const gagnants = view.seats.filter((seat) => (seat.won ?? 0) > 0);
    if (gagnants.length === 0) return "Coup terminé.";
    return gagnants
      .map((seat) => `${seat.pseudo} remporte ${formatCoins(seat.won ?? 0)}${seat.handLabel ? ` avec ${seat.handLabel.toLowerCase()}` : ""}.`)
      .join(" ");
  }
  if (view.turn === null) return "Distribution en cours.";
  const auTrait = view.seats.find((seat) => seat.seat === view.turn);
  if (view.you !== null && view.turn === view.you) return "À toi de parler.";
  return auTrait ? `Au tour de ${auTrait.pseudo}.` : "";
}

/** Sièges libres où l'on peut s'asseoir. */
export function freeSeats(view: PokerView): number[] {
  const pris = new Set(view.seats.map((seat) => seat.seat));
  return Array.from({ length: view.maxSeats }, (_, place) => place).filter(
    (place) => !pris.has(place),
  );
}
