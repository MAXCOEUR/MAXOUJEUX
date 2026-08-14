/**
 * Pastille de messages non lus, jusque dans l'onglet du navigateur.
 *
 * Le logo est **reconstruit en chaîne** plutôt que dessiné sur un canvas : un
 * SVG reste net à toutes les tailles, du 16 × 16 d'un onglet encombré au 64 × 64
 * d'un raccourci, et la pastille se place dans les coordonnées du dessin
 * d'origine sans calcul de mise à l'échelle.
 *
 * Le titre porte le même compte : c'est ce qui reste lisible quand l'onglet est
 * réduit à sa seule icône dans une fenêtre chargée.
 *
 * Les deux fonctions de fabrication sont **pures**, donc testables sans DOM.
 */

const BASE_TITLE = "MaxouJeux";

/**
 * Le logo, repris de `public/favicon.svg`.
 *
 * Recopié volontairement : le fichier reste le favicon servi au premier
 * chargement, avant que JavaScript ne prenne la main. Les deux doivent donc
 * représenter le même dessin — un test le rappellera si l'un des deux bouge.
 */
const LOGO_PATH = "M16 46V18h7l9 14 9-14h7v28h-7V30l-9 13-9-13v16z";

/** Fabrique le SVG du favicon, avec ou sans pastille. */
export function faviconSvg(unread: number): string {
  // La pastille mange le coin du M : elle doit se voir à 16 pixels de côté, ce
  // qui interdit de la loger dans une marge. Le liseré sombre la détache du
  // dessin en dessous.
  const pastille =
    unread > 0
      ? '<circle cx="48" cy="16" r="15" fill="#0b1410" /><circle cx="48" cy="16" r="11" fill="#e8756a" />'
      : "";

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0" stop-color="#a78bfa" /><stop offset="1" stop-color="#22d3ee" />',
    "</linearGradient></defs>",
    '<rect width="64" height="64" rx="14" fill="#0f1115" />',
    `<path d="${LOGO_PATH}" fill="url(#g)" />`,
    pastille,
    "</svg>",
  ].join("");
}

/**
 * Le titre de l'onglet.
 *
 * Au-delà de 99, on écrit `99+` : le compte exact n'apprend plus rien, et un
 * nombre à quatre chiffres pousse le nom du site hors du champ visible.
 */
export function faviconTitle(unread: number): string {
  if (unread <= 0) return BASE_TITLE;
  return `(${unread > 99 ? "99+" : unread}) ${BASE_TITLE}`;
}

// ---------------------------------------------------------------------------
// Application au document
// ---------------------------------------------------------------------------

let lastUnread = -1;

/** Pose le favicon et le titre. Sans effet si le compte n'a pas bougé. */
export function applyUnreadBadge(unread: number): void {
  if (typeof document === "undefined") return;
  if (unread === lastUnread) return;
  lastUnread = unread;

  document.title = faviconTitle(unread);

  const link =
    document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
    document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));

  link.type = "image/svg+xml";
  // `encodeURIComponent` et non base64 : plus court, et le SVG reste lisible
  // dans l'inspecteur pour qui voudrait comprendre d'où sort cette icône.
  link.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(unread))}`;
}

/** Remise à zéro. Réservé aux tests. */
export function resetFaviconForTests(): void {
  lastUnread = -1;
}
