import { formatCoinsDelta, type FortunePoint } from "@maxoujeux/shared";

interface CourbeFortuneProps {
  points: FortunePoint[];
}

const LARGEUR = 600;
const HAUTEUR = 160;
const MARGE = 8;

/**
 * Courbe du gain cumulé sur trente jours.
 *
 * SVG écrit à la main, sans bibliothèque : le site dessine déjà sa roue de la
 * fortune, son plateau de Plinko et son cylindre de roulette de cette façon, et
 * une bibliothèque de graphiques pèserait plus lourd que les trente points
 * qu'elle aurait à tracer.
 *
 * La ligne du zéro est tracée à part et **toujours visible** : sans elle, une
 * courbe entièrement négative ressemblerait à une courbe qui monte.
 */
export function CourbeFortune({ points }: CourbeFortuneProps) {
  if (points.length < 2) return null;

  const valeurs = points.map((point) => point.cumulative);
  const final = valeurs[valeurs.length - 1] ?? 0;

  // Le zéro fait toujours partie de l'échelle : une courbe qui ne descend jamais
  // sous 400 MaxouCoin ne doit pas donner l'illusion d'être partie de rien.
  const haut = Math.max(0, ...valeurs);
  const bas = Math.min(0, ...valeurs);
  const amplitude = haut - bas || 1;

  const x = (index: number) =>
    MARGE + (index / (points.length - 1)) * (LARGEUR - MARGE * 2);
  const y = (valeur: number) =>
    MARGE + ((haut - valeur) / amplitude) * (HAUTEUR - MARGE * 2);

  const ligne = points.map((point, index) => `${x(index)},${y(point.cumulative)}`).join(" ");
  const aire = `${x(0)},${y(bas)} ${ligne} ${x(points.length - 1)},${y(bas)}`;
  const zero = y(0);

  const gagnant = final >= 0;
  const trait = gagnant ? "var(--color-brass)" : "var(--color-danger)";

  const premier = points[0]?.day ?? "";
  const dernier = points[points.length - 1]?.day ?? "";

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Gain cumulé sur les trente derniers jours : ${formatCoinsDelta(final)} au total.`}
      >
        <defs>
          <linearGradient id="courbe-fortune" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={trait} stopOpacity="0.28" />
            <stop offset="100%" stopColor={trait} stopOpacity="0" />
          </linearGradient>
        </defs>

        <polygon points={aire} fill="url(#courbe-fortune)" />

        <line
          x1={MARGE}
          y1={zero}
          x2={LARGEUR - MARGE}
          y2={zero}
          stroke="var(--color-line-strong)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />

        <polyline
          points={ligne}
          fill="none"
          stroke={trait}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        <circle cx={x(points.length - 1)} cy={y(final)} r="3.5" fill={trait} />
      </svg>

      <figcaption className="mt-2 flex items-baseline justify-between text-xs text-cream-faint">
        <span className="tabular">{jourCourt(premier)}</span>
        <span className={gagnant ? "tabular text-brass-bright" : "tabular text-danger"}>
          {formatCoinsDelta(final)} sur 30 jours
        </span>
        <span className="tabular">{jourCourt(dernier)}</span>
      </figcaption>
    </figure>
  );
}

/** `2026-08-12` → `12/08`. La convention de date du site est JJ/MM. */
function jourCourt(day: string): string {
  const [, mois, jour] = day.split("-");
  return mois && jour ? `${jour}/${mois}` : day;
}
