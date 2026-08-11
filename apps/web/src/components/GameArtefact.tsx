import type { GameCode } from "@maxoujeux/shared";
import { cn } from "@/lib/cn";

/**
 * Artefacts de jeu — l'élément signature de l'interface.
 *
 * Chaque jeu est représenté par son matériel réel plutôt que par une icône
 * générique : deux cartes fermées pour le poker, un sabot et un 21 pour le
 * blackjack, une ligne de tuiles pour Motus, des disques empilés pour le
 * Puissance 4, une grille tracée pour le morpion.
 *
 * Dessinés à la main en SVG et non importés : ce sont eux qui donnent au lobby
 * son identité, et une bibliothèque d'icônes ne saurait pas les produire.
 * Aucun texte dedans — tout est décoratif, d'où `aria-hidden`.
 */

interface GameArtefactProps {
  code: GameCode;
  className?: string;
}

const CREAM = "#f2ede0";
const CARD_FACE = "#efe8d8";
const CARD_EDGE = "#c9c0aa";

export function GameArtefact({ code, className }: GameArtefactProps) {
  const shared = {
    className: cn("h-full w-full", className),
    viewBox: "0 0 120 90",
    fill: "none" as const,
    "aria-hidden": true,
  };

  switch (code) {
    case "poker":
      return (
        <svg {...shared}>
          {/* Deux cartes fermées, légèrement écartées comme tenues en main. */}
          <g transform="rotate(-9 42 52)">
            <rect x="24" y="26" width="34" height="48" rx="4" fill={CARD_FACE} />
            <rect x="24" y="26" width="34" height="48" rx="4" stroke={CARD_EDGE} />
            {/* Dos de carte : quadrillage fin, comme un motif imprimé. */}
            <path
              d="M29 31h24M29 38h24M29 45h24M29 52h24M29 59h24M29 66h24"
              stroke="#b8453a"
              strokeWidth="1.5"
              opacity="0.45"
            />
          </g>
          <g transform="rotate(7 74 54)">
            <rect x="58" y="30" width="34" height="48" rx="4" fill={CARD_FACE} />
            <rect x="58" y="30" width="34" height="48" rx="4" stroke={CARD_EDGE} />
            {/* Un cœur, dessiné plutôt que posé en glyphe. */}
            <path
              d="M75 66c-6-5-11-9-11-14a5.5 5.5 0 0 1 11-2 5.5 5.5 0 0 1 11 2c0 5-5 9-11 14z"
              fill="#b8453a"
            />
          </g>
          {/* Trois jetons empilés au bord du tapis. */}
          <ellipse cx="99" cy="72" rx="15" ry="5" fill="#8a6a28" />
          <ellipse cx="99" cy="68" rx="15" ry="5" fill="#c8a250" />
          <ellipse cx="99" cy="64" rx="15" ry="5" fill="#e8cd8a" />
          <ellipse cx="99" cy="64" rx="7" ry="2.2" fill="#8a6a28" opacity="0.5" />
        </svg>
      );

    case "blackjack":
      return (
        <svg {...shared}>
          {/* Main du joueur : une carte ouverte, une fermée en dessous. */}
          <rect x="18" y="30" width="32" height="46" rx="4" fill="#c9c0aa" />
          <g transform="rotate(-6 40 50)">
            <rect x="28" y="24" width="32" height="46" rx="4" fill={CARD_FACE} />
            <rect x="28" y="24" width="32" height="46" rx="4" stroke={CARD_EDGE} />
            {/* Le 21, écrit comme sur une carte. */}
            <text
              x="44"
              y="53"
              textAnchor="middle"
              fontFamily="'Bricolage Grotesque Variable', sans-serif"
              fontSize="22"
              fontWeight="700"
              fill="#122019"
            >
              21
            </text>
          </g>
          {/* Sabot du croupier, incliné. */}
          <path d="M72 34h34l-6 34H78z" fill="#1a2e23" stroke="#3a5b47" />
          <path d="M76 40h26" stroke="#c8a250" strokeWidth="2" opacity="0.7" />
          <path d="M77 48h24" stroke="#c8a250" strokeWidth="2" opacity="0.45" />
          <path d="M78 56h22" stroke="#c8a250" strokeWidth="2" opacity="0.25" />
        </svg>
      );

    case "motus":
      return (
        <svg {...shared}>
          {/* Une ligne de tuiles : deux trouvées, une mal placée, deux vides. */}
          {[0, 1, 2, 3, 4].map((i) => {
            const fill = i < 2 ? "#f0c02c" : i === 2 ? "#3a5b47" : "#1a2e23";
            return (
              <rect
                key={i}
                x={9 + i * 21}
                y="30"
                width="18"
                height="18"
                rx="3"
                fill={fill}
                stroke="#263d2f"
              />
            );
          })}
          {/* La boule noire cerclée de rouge : la marque de fabrique du jeu. */}
          <circle cx="51" cy="66" r="9" fill="#0b1410" stroke="#b8453a" strokeWidth="2.5" />
          {/* Deux tuiles de la ligne suivante, encore vides. */}
          <rect x="9" y="56" width="18" height="18" rx="3" fill="#122019" stroke="#263d2f" />
          <rect x="72" y="56" width="18" height="18" rx="3" fill="#122019" stroke="#263d2f" />
          <rect x="93" y="56" width="18" height="18" rx="3" fill="#122019" stroke="#263d2f" />
          <rect x="93" y="30" width="18" height="18" rx="3" fill="#1a2e23" stroke="#263d2f" />
        </svg>
      );

    case "connect4":
      return (
        <svg {...shared}>
          {/* Fragment de plateau : trois colonnes percées, vu de face. */}
          <rect x="24" y="18" width="72" height="60" rx="6" fill="#1a2e23" stroke="#3a5b47" />
          {[0, 1, 2].map((col) =>
            [0, 1, 2].map((row) => {
              // Deux disques rouges alignés en diagonale, un jaune : une menace
              // en cours, pas un damier décoratif.
              const filled =
                (col === 0 && row === 2) || (col === 1 && row === 1) || (col === 1 && row === 2);
              const yellow = col === 1 && row === 2;
              return (
                <circle
                  key={`${col}-${row}`}
                  cx={42 + col * 18}
                  cy={32 + row * 18}
                  r="7.5"
                  fill={filled ? (yellow ? "#f0c02c" : "#e05a45") : "#0b1410"}
                />
              );
            }),
          )}
          {/* Le disque suivant, suspendu au-dessus de sa colonne. */}
          <circle cx="78" cy="10" r="7.5" fill="#e05a45" opacity="0.85" />
        </svg>
      );

    case "tictactoe":
      return (
        <svg {...shared}>
          {/* Grille tracée à la main : deux traits qui dépassent, comme au stylo. */}
          <path
            d="M52 18v58M76 16v60M32 38h64M30 58h66"
            stroke="#3a5b47"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          {/* Une croix gagnante et deux ronds. */}
          <path
            d="M37 24l10 10M47 24l-10 10"
            stroke={CREAM}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M61 44l10 10M71 44l-10 10"
            stroke={CREAM}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="85" cy="29" r="6.5" stroke="#b8453a" strokeWidth="3" />
          <circle cx="42" cy="48" r="6.5" stroke="#b8453a" strokeWidth="3" />
          <path
            d="M85 63l10 10M95 63l-10 10"
            stroke={CREAM}
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.35"
          />
        </svg>
      );
  }
}
