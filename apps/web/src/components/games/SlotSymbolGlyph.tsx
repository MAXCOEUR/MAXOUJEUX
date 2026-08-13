import { slotSymbol } from "@maxoujeux/shared";
import { cn } from "@/lib/cn";

/**
 * Les six symboles de la machine à sous.
 *
 * Dessinés à la main en SVG, comme les artefacts du lobby : ce sont eux qui
 * donnent son caractère à la machine, et une bibliothèque d'icônes rendrait un
 * bandit manchot génénique. Chacun est bâti sur la même grille de 40 × 40 pour
 * que les six occupent la même place dans leur fenêtre.
 *
 * Le laiton monte avec la valeur : la cerise est rouge, le MAXOU est en or
 * massif. C'est le code couleur du site — le laiton est réservé à ce qui
 * rapporte.
 */

interface SlotSymbolGlyphProps {
  index: number;
  className?: string;
}

export function SlotSymbolGlyph({ index, className }: SlotSymbolGlyphProps) {
  const symbol = slotSymbol(index);

  return (
    <svg
      viewBox="0 0 40 40"
      className={cn("h-full w-full", className)}
      role="img"
      aria-label={symbol.name}
    >
      {glyph(symbol.code)}
    </svg>
  );
}

function glyph(code: string) {
  switch (code) {
    case "cerise":
      return (
        <g>
          {/* Deux cerises et leur pédoncule. */}
          <path d="M20 9c-3 4-8 6-11 8" stroke="#3a5b47" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M20 9c2 5 5 8 8 10" stroke="#3a5b47" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="13" cy="26" r="7" fill="#b8453a" />
          <circle cx="28" cy="28" r="6" fill="#9d2f24" />
          <circle cx="11" cy="24" r="2" fill="#e8cd8a" opacity="0.55" />
        </g>
      );

    case "cloche":
      return (
        <g>
          {/* Dôme, socle et battant. */}
          <path d="M11 27c0-9 3-15 9-15s9 6 9 15z" fill="#c8a250" />
          <rect x="9" y="27" width="22" height="3.4" rx="1.7" fill="#8a6a28" />
          <circle cx="20" cy="33" r="2.6" fill="#8a6a28" />
          <circle cx="20" cy="10" r="2" fill="#8a6a28" />
          <path d="M15 20c0-5 1-7 3-8" stroke="#e8cd8a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
      );

    case "sac":
      return (
        <g>
          {/* Bourse fermée par un cordon, marquée MC. */}
          <path d="M13 15h14l4 12a9 9 0 0 1-9 9h-4a9 9 0 0 1-9-9z" fill="#8a6a28" />
          <path d="M12 14h16l-2-4H14z" fill="#c8a250" />
          <text
            x="20"
            y="30"
            textAnchor="middle"
            fontFamily="'Bricolage Grotesque Variable', sans-serif"
            fontSize="11"
            fontWeight="800"
            fill="#e8cd8a"
          >
            MC
          </text>
        </g>
      );

    case "couronne":
      return (
        <g>
          {/* Trois pointes et un bandeau serti. */}
          <path d="M8 30l-2-16 7 6 7-11 7 11 7-6-2 16z" fill="#c8a250" />
          <rect x="8" y="30" width="24" height="4.5" rx="2" fill="#8a6a28" />
          <circle cx="20" cy="22" r="2" fill="#b8453a" />
          <circle cx="13" cy="25" r="1.4" fill="#4aa3a8" />
          <circle cx="27" cy="25" r="1.4" fill="#4aa3a8" />
        </g>
      );

    case "diamant":
      return (
        <g>
          {/* Facettes : sans elles, le losange se lit comme une balise. */}
          <path d="M20 6l12 10-12 18L8 16z" fill="#4aa3a8" />
          <path d="M20 6l6 10-6 18-6-18z" fill="#7fd0d4" opacity="0.85" />
          <path d="M8 16h24" stroke="#0b1410" strokeWidth="1.1" opacity="0.4" />
          <path d="M14 12l2 4M26 12l-2 4" stroke="#e8f7f8" strokeWidth="1.2" opacity="0.7" />
        </g>
      );

    case "maxou":
      return (
        <g>
          {/* Le jackpot : le nom du site, en or, sur une plaque. */}
          <rect x="3" y="12" width="34" height="16" rx="3.5" fill="#8a6a28" />
          <rect x="4.6" y="13.6" width="30.8" height="12.8" rx="2.6" fill="#e8cd8a" />
          <text
            x="20"
            y="23"
            textAnchor="middle"
            fontFamily="'Bricolage Grotesque Variable', sans-serif"
            fontSize="8.4"
            fontWeight="800"
            letterSpacing="0.3"
            fill="#122019"
          >
            MAXOU
          </text>
          {/* Deux éclats, pour que la plaque brille. */}
          <path d="M20 4v5M9 7l2 3M31 7l-2 3" stroke="#e8cd8a" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      );

    default:
      return null;
  }
}
