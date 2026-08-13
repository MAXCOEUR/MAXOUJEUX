import { WHEEL_SEGMENTS, WHEEL_SPIN_MS } from "@maxoujeux/shared";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { serverNow } from "@/lib/clock";
import { useReducedMotion } from "@/lib/motion";

/**
 * La roue de la fortune.
 *
 * Verticale et vue de face, à l'inverse du cylindre de roulette qui est posé à
 * plat : deux roues vues du même angle se confondraient dans le casino.
 *
 * L'angle d'arrivée est **imposé par le serveur** — le secteur est tiré au
 * départ du lancer et voyage avec lui. Deux spectateurs arrivés à une seconde
 * d'écart voient donc la même roue s'arrêter sur la même case, ce qu'une
 * animation locale ne pourrait pas garantir.
 *
 * La rotation n'est jamais remise à zéro : on ajoute toujours des tours vers
 * l'avant. Une roue qui reviendrait en arrière entre deux lancers trahirait
 * immédiatement l'artifice.
 */

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 88;
const SEGMENT_ANGLE = 360 / WHEEL_SEGMENTS.length;
/** Tours complets avant l'arrêt : c'est ce qui donne le poids à la roue. */
const FULL_TURNS = 5;

interface FortuneWheelProps {
  /** Secteur sur lequel s'arrêter, ou `null` quand la roue est au repos. */
  target: number | null;
  /** Fin de l'animation, en ISO. Sert à rattraper un lancer déjà commencé. */
  endsAt: string | null;
  className?: string;
}

export function FortuneWheel({ target, endsAt, className }: FortuneWheelProps) {
  const reduced = useReducedMotion();
  const { rotation, duration } = useSpinAnimation(target, endsAt, reduced);

  return (
    <div className={cn("relative aspect-square", className)}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" aria-hidden>
        {/* Jante de laiton, posée sous les secteurs pour déborder d'un cheveu. */}
        <circle cx={CENTER} cy={CENTER} r={RADIUS + 5} className="fill-brass-deep" />
        <circle cx={CENTER} cy={CENTER} r={RADIUS + 2} className="fill-felt-deep" />

        <g
          style={{
            transform: `rotate(${rotation}deg)`,
            transformOrigin: "center",
            transition: duration > 0 ? `transform ${duration}ms cubic-bezier(0.12, 0.7, 0.1, 1)` : "none",
          }}
        >
          {WHEEL_SEGMENTS.map((segment, index) => (
            <Segment key={index} index={index} label={segment.label} tenths={segment.multiplierTenths} />
          ))}
        </g>

        {/* Moyeu : posé après la rotation, il ne tourne pas. */}
        <circle cx={CENTER} cy={CENTER} r="17" className="fill-felt-deep stroke-brass" strokeWidth="2" />
        <circle cx={CENTER} cy={CENTER} r="6" className="fill-brass" />

        {/* Repère fixe en haut : il **pointe vers le bas**, vers la case qu'il
            désigne. Pas d'ombre portée — à cette taille, elle ne faisait que
            rendre le contour flou. */}
        <path
          d={`M ${CENTER - 9} ${CENTER - RADIUS - 8} h 18 l -9 20 z`}
          className="fill-cream stroke-brass-deep"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function Segment({ index, label, tenths }: { index: number; label: string; tenths: number }) {
  const start = (index * SEGMENT_ANGLE - 90 - SEGMENT_ANGLE / 2) * (Math.PI / 180);
  const end = start + SEGMENT_ANGLE * (Math.PI / 180);
  const point = (angle: number) =>
    `${(CENTER + RADIUS * Math.cos(angle)).toFixed(2)} ${(CENTER + RADIUS * Math.sin(angle)).toFixed(2)}`;

  // Trois familles de cases, trois teintes : ce qui fait perdre, ce qui rend à
  // peu près la mise, ce qui paie vraiment. Un dégradé continu sur neuf valeurs
  // serait illisible.
  const remplissage =
    tenths === 0
      ? "fill-felt-high"
      : tenths >= 50
        ? "fill-brass"
        : tenths >= 20
          ? "fill-game-wheel"
          : "fill-felt-raised";

  const milieu = (start + end) / 2;
  const rayonTexte = RADIUS * 0.66;

  return (
    <g>
      <path
        d={`M ${CENTER} ${CENTER} L ${point(start)} A ${RADIUS} ${RADIUS} 0 0 1 ${point(end)} Z`}
        className={cn(remplissage, "stroke-brass-deep")}
        strokeWidth="0.8"
      />
      <text
        x={CENTER + rayonTexte * Math.cos(milieu)}
        y={CENTER + rayonTexte * Math.sin(milieu)}
        textAnchor="middle"
        dominantBaseline="central"
        className={cn("font-display", tenths >= 50 ? "fill-felt-deep" : "fill-cream")}
        style={{
          fontSize: "13px",
          fontWeight: 800,
          // Le texte suit le rayon : lu de biais, il donne la roue de foire.
          transform: `rotate(${(milieu * 180) / Math.PI + 90}deg)`,
          transformOrigin: `${CENTER + rayonTexte * Math.cos(milieu)}px ${CENTER + rayonTexte * Math.sin(milieu)}px`,
        }}
      >
        {label}
      </text>
    </g>
  );
}

/**
 * Angle courant de la roue.
 *
 * Trois cas : au repos elle ne bouge pas ; sur un lancer qui démarre elle prend
 * cinq tours plus l'angle du secteur ; sur un lancer déjà en cours — un
 * spectateur qui arrive en retard — elle se pose directement sur le résultat,
 * parce qu'animer les deux secondes restantes donnerait une roue qui ralentit
 * n'importe comment.
 */
function useSpinAnimation(target: number | null, endsAt: string | null, reduced: boolean) {
  const [rotation, setRotation] = useState(0);
  const [duration, setDuration] = useState(0);
  const lastSpin = useRef<string | null>(null);

  useEffect(() => {
    if (target === null || !endsAt) return;
    // Un même lancer ne s'anime qu'une fois : les états de la salle arrivent
    // plusieurs fois pendant qu'elle tourne (un spectateur entre, un autre sort).
    if (lastSpin.current === endsAt) return;
    lastSpin.current = endsAt;

    const restant = new Date(endsAt).getTime() - serverNow();
    const angleCible = -target * SEGMENT_ANGLE;

    setRotation((precedent) => {
      // Toujours vers l'avant : on repart du tour entier suivant.
      const base = Math.ceil(precedent / 360) * 360;
      const tours = reduced || restant < WHEEL_SPIN_MS / 2 ? 0 : FULL_TURNS;
      return base + tours * 360 + angleCible;
    });
    setDuration(reduced ? 0 : Math.max(0, Math.min(restant, WHEEL_SPIN_MS)));
  }, [target, endsAt, reduced]);

  return { rotation, duration };
}
