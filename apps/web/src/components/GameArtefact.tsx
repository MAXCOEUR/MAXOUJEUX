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

    case "roulette":
      return (
        <svg {...shared}>
          {/* Le cylindre, vu de trois quarts : une ellipse et non un cercle,
              sinon l'artefact se lit comme une cible et non comme une roue
              posée sur une table. */}
          <ellipse cx="60" cy="50" rx="42" ry="30" fill="#1a2e23" stroke="#8a6a28" strokeWidth="2" />
          {/* Huit cases alternées, assez pour donner le motif sans le compter. */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => {
            const debut = (index * Math.PI) / 4;
            const fin = debut + Math.PI / 4;
            const point = (angle: number, rx: number, ry: number) =>
              `${(60 + rx * Math.cos(angle)).toFixed(1)} ${(50 + ry * Math.sin(angle)).toFixed(1)}`;
            return (
              <path
                key={index}
                d={`M ${point(debut, 18, 13)} L ${point(debut, 40, 28)} A 40 28 0 0 1 ${point(fin, 40, 28)} L ${point(fin, 18, 13)} Z`}
                fill={index % 2 === 0 ? "#8f2a20" : "#14100f"}
                stroke="#8a6a28"
                strokeWidth="0.6"
              />
            );
          })}
          {/* Moyeu de laiton, et la bille sur la piste. */}
          <ellipse cx="60" cy="50" rx="17" ry="12" fill="#122019" stroke="#c8a250" strokeWidth="1.5" />
          <ellipse cx="60" cy="50" rx="6" ry="4" fill="#c8a250" />
          <circle cx="88" cy="38" r="4" fill={CREAM} />
          {/* Deux jetons posés au bord, pour l'échelle. */}
          <ellipse cx="22" cy="76" rx="13" ry="4.5" fill="#8a6a28" />
          <ellipse cx="22" cy="72" rx="13" ry="4.5" fill="#c8a250" />
        </svg>
      );

    case "wheel":
      return (
        <svg {...shared}>
          {/* Roue verticale, vue de face — l'inverse du cylindre de roulette,
              qui est posé à plat : deux roues vues pareil se confondraient. */}
          {Array.from({ length: 9 }, (_, index) => {
            // Neuf cases, comme les neuf multiplicateurs du barème.
            const debut = (-90 + index * 40) * (Math.PI / 180);
            const fin = debut + (40 * Math.PI) / 180;
            const point = (angle: number) =>
              `${(56 + 32 * Math.cos(angle)).toFixed(1)} ${(48 + 32 * Math.sin(angle)).toFixed(1)}`;
            return (
              <path
                key={index}
                d={`M 56 48 L ${point(debut)} A 32 32 0 0 1 ${point(fin)} Z`}
                // La case du haut est celle que le repère désigne : elle porte
                // le laiton, les autres alternent cuivre et feutre.
                fill={index === 0 ? "#e8cd8a" : index % 2 === 0 ? "#e08a2e" : "#1a2e23"}
                stroke="#8a6a28"
                strokeWidth="0.8"
              />
            );
          })}
          <circle cx="56" cy="48" r="32" stroke="#c8a250" strokeWidth="2" />
          <circle cx="56" cy="48" r="7" fill="#122019" stroke="#c8a250" strokeWidth="2" />
          {/* Repère fixe en haut : il **pointe vers la roue**, sinon il ne
              désigne rien. Il mord légèrement sur la jante, comme une vraie
              languette qui vient claquer entre les secteurs. */}
          <path d="M48 6h16l-8 14z" fill={CREAM} stroke="#8a6a28" strokeWidth="1" strokeLinejoin="round" />
          {/* Deux jetons posés à côté : la roue se lance avec une mise. */}
          <ellipse cx="103" cy="76" rx="12" ry="4.5" fill="#8a6a28" />
          <ellipse cx="103" cy="72" rx="12" ry="4.5" fill="#c8a250" />
        </svg>
      );

    case "plinko":
      return (
        <svg {...shared}>
          {/* Le triangle de picots, resserré vers le haut comme la vraie planche. */}
          {[0, 1, 2, 3].map((rangee) =>
            Array.from({ length: rangee + 3 }, (_, colonne) => (
              <circle
                key={`${rangee}-${colonne}`}
                cx={60 - (rangee + 2) * 8 + colonne * 16}
                cy={22 + rangee * 13}
                r="2.6"
                fill="#4aa3a8"
                opacity={0.55 + rangee * 0.15}
              />
            )),
          )}
          {/* La bille entre dans la planche, légèrement hors de l'axe : posée
              sur l'axe central, elle donnerait une chute symétrique et perdrait
              l'idée du rebond. Elle est tenue au-dessus de la première rangée
              plutôt qu'entre les picots, où elle en masquerait un. */}
          <circle cx="52" cy="11" r="5.5" fill={CREAM} />
          <circle cx="50" cy="9" r="1.8" fill="#fff" opacity="0.6" />
          {/* Les fentes d'arrivée : la case du bord est la plus payante. */}
          {[0, 1, 2, 3, 4, 5, 6].map((fente) => (
            <rect
              key={fente}
              x={12 + fente * 14}
              y="76"
              width="11"
              height="10"
              rx="2"
              fill={fente === 0 || fente === 6 ? "#c8a250" : "#1a2e23"}
              stroke="#3a5b47"
              strokeWidth="0.8"
            />
          ))}
        </svg>
      );

    case "slots":
      return (
        <svg {...shared}>
          {/* Caisse de la machine, avec son levier sur le flanc droit. */}
          <rect x="10" y="18" width="84" height="54" rx="7" fill="#1a2e23" stroke="#8a6a28" strokeWidth="2" />
          <path d="M100 62V36" stroke="#8a6a28" strokeWidth="3" strokeLinecap="round" />
          <circle cx="100" cy="31" r="6" fill="#b8453a" stroke="#8a6a28" strokeWidth="1.5" />
          {/* Trois rouleaux. La ligne de gain traverse les trois fenêtres. */}
          {[0, 1, 2].map((rouleau) => (
            <rect
              key={rouleau}
              x={18 + rouleau * 26}
              y="26"
              width="22"
              height="38"
              rx="3"
              fill="#0b1410"
              stroke="#3a5b47"
            />
          ))}
          {/* Une cerise, une couronne, un diamant : trois symboles distincts du
              barème, pas trois fois le même — la machine est en train de tourner. */}
          <circle cx="26" cy="47" r="5" fill="#b8453a" />
          <circle cx="33" cy="50" r="4" fill="#b8453a" />
          <path d="M26 42q4-8 9-9" stroke="#3a5b47" strokeWidth="1.6" fill="none" />
          <path d="M44 54l3-14 5 6 4-6 5 6 3-6 2 14z" fill="#c8a250" />
          <path d="M81 36l8 10-8 10-8-10z" fill="#a06bd6" />
          <path d="M12 45h80" stroke="#e8cd8a" strokeWidth="1" opacity="0.35" />
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
