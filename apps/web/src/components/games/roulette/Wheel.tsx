import { ROULETTE_WHEEL, rouletteColor } from "@maxoujeux/engines";
import { msUntilServer } from "@/lib/clock";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/motion";
import { POCKET_ARC, ballRotation, pocketAngle, wheelRotation } from "@/lib/roulette-ui";

interface WheelProps {
  /** Numéro sorti. `null` : la roue est au repos. */
  result: number | null;
  /** La bille est-elle en train de tourner ? */
  spinning: boolean;
  /** Fin du lancer, telle que le serveur l'a fixée. */
  deadlineAt: string | null;
  /** Durée du lancer, imposée par le serveur. */
  spinMs: number;
}

const POCKET_FILL: Record<ReturnType<typeof rouletteColor>, string> = {
  red: "var(--color-roulette-rouge)",
  black: "var(--color-roulette-noir)",
  green: "var(--color-roulette-vert)",
};

/**
 * Le cylindre.
 *
 * **Animé entièrement en CSS**, sans un seul rendu React par image : une roue
 * pilotée par l'état ferait quatre cents rendus en sept secondes et saccaderait
 * sur un téléphone. Le GPU compose deux rotations, React ne touche plus à rien.
 *
 * Le `animation-delay` **négatif** est ce qui fait qu'un joueur arrivant à trois
 * secondes d'un lancer de sept voit la bille déjà bien avancée. Sans lui, elle
 * repartirait de zéro et s'arrêterait quatre secondes après tout le monde.
 *
 * La `key` sur les deux nœuds animés est indispensable : changer une propriété
 * ne relance pas une animation CSS, il faut que l'élément soit remonté.
 */
export function Wheel({ result, spinning, deadlineAt, spinMs }: WheelProps) {
  const reduced = useReducedMotion();
  // Le temps déjà écoulé se déduit de l'échéance, jamais de l'horloge locale :
  // `msUntilServer` corrige la dérive du navigateur.
  const ecoule = spinning && deadlineAt
    ? Math.max(0, Math.min(spinMs, spinMs - msUntilServer(deadlineAt)))
    : 0;

  /**
   * En mode « animations réduites », la règle globale de `index.css` impose
   * `animation-duration: 0.01ms !important` — un `!important` de feuille de
   * style bat un style en ligne. La roue s'arrêterait donc instantanément, sur
   * une case tirée au hasard par la mise en page plutôt que par le serveur. On
   * annonce le numéro plutôt que de mentir avec une rotation fausse.
   */
  if (reduced) {
    return (
      <div className="grid aspect-square w-full max-w-[min(74vw,17rem)] place-items-center rounded-full border-2 border-brass/40 bg-felt-deep">
        <div className="text-center">
          <p className="text-[0.6rem] uppercase tracking-[0.24em] text-cream-faint">
            {spinning ? "La bille tourne" : "Dernier numéro"}
          </p>
          <p
            className="tabular font-display text-5xl font-black"
            style={{ color: result === null ? "var(--color-cream-faint)" : POCKET_FILL[rouletteColor(result)] }}
          >
            {result ?? "—"}
          </p>
        </div>
      </div>
    );
  }

  const rotation = result === null ? 0 : wheelRotation(result);

  return (
    <div
      className="relative aspect-square w-full max-w-[min(74vw,17rem)] select-none"
      role="img"
      aria-label={
        result === null
          ? "Cylindre de roulette au repos"
          : spinning
            ? "La bille tourne"
            : `Le ${result} est sorti`
      }
    >
      {/* Repère fixe : c'est sous lui que la case gagnante s'immobilise. */}
      <span
        aria-hidden
        className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2 text-brass-bright"
        style={{ fontSize: "0.9rem", lineHeight: 1 }}
      >
        ▼
      </span>

      {/* Le cylindre tourne ; le moyeu et le repère ne bougent pas. */}
      <div
        key={`cylindre-${result ?? "repos"}-${deadlineAt ?? "fixe"}`}
        className="absolute inset-0"
        style={
          spinning
            ? {
                animation: `roue-tourne ${spinMs}ms cubic-bezier(0.16, 0.9, 0.24, 1) forwards`,
                animationDelay: `-${Math.round(ecoule)}ms`,
                ["--roue-fin" as string]: `${rotation}deg`,
              }
            : { transform: `rotate(${result === null ? 0 : -pocketAngle(result)}deg)` }
        }
      >
        <Cylinder />
      </div>

      {/* La bille tourne en sens inverse, puis retombe dans sa case. */}
      {spinning && (
        <div
          key={`bille-${deadlineAt ?? "fixe"}`}
          className="absolute inset-0"
          style={{
            animation: `bille-tourne ${spinMs}ms cubic-bezier(0.16, 0.9, 0.24, 1) forwards`,
            animationDelay: `-${Math.round(ecoule)}ms`,
            ["--bille-fin" as string]: `${ballRotation()}deg`,
          }}
        >
          <Ball />
        </div>
      )}
      {!spinning && result !== null && (
        <div className="absolute inset-0">
          <Ball />
        </div>
      )}

      {/* Moyeu : masque le centre du disque et donne l'épaisseur du bol. */}
      <div
        aria-hidden
        className="absolute inset-[26%] rounded-full border border-brass/30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 38% 30%, var(--color-felt-high), var(--color-felt-deep) 72%)",
          boxShadow: "inset 0 2px 6px rgb(0 0 0 / 0.6), 0 1px 0 rgb(255 255 255 / 0.06)",
        }}
      />
    </div>
  );
}

/** Le disque à trente-sept cases, dessiné en secteurs SVG. */
function Cylinder() {
  return (
    <svg viewBox="-50 -50 100 100" className="size-full drop-shadow-[0_8px_18px_rgb(0_0_0/0.55)]" aria-hidden>
      <circle r="49" fill="var(--color-brass-deep)" />
      <circle r="46.5" fill="var(--color-felt-deep)" />
      {ROULETTE_WHEEL.map((pocket, index) => (
        <Pocket key={pocket} value={pocket} index={index} />
      ))}
      <circle r="27" fill="none" stroke="var(--color-brass)" strokeWidth="0.6" opacity="0.55" />
    </svg>
  );
}

/**
 * Une case du cylindre.
 *
 * Le secteur est tracé à la main plutôt qu'avec un arc de cercle épais : c'est
 * la seule façon d'avoir des séparateurs radiaux nets, ceux qui font lire un
 * cylindre plutôt qu'un camembert.
 */
function Pocket({ value, index }: { value: number; index: number }) {
  const debut = index * POCKET_ARC - POCKET_ARC / 2 - 90;
  const fin = debut + POCKET_ARC;
  const exterieur = 46.5;
  const interieur = 27;

  const point = (rayon: number, degres: number) => {
    const rad = (degres * Math.PI) / 180;
    return `${(rayon * Math.cos(rad)).toFixed(3)} ${(rayon * Math.sin(rad)).toFixed(3)}`;
  };

  const chemin = [
    `M ${point(interieur, debut)}`,
    `L ${point(exterieur, debut)}`,
    `A ${exterieur} ${exterieur} 0 0 1 ${point(exterieur, fin)}`,
    `L ${point(interieur, fin)}`,
    `A ${interieur} ${interieur} 0 0 0 ${point(interieur, debut)}`,
    "Z",
  ].join(" ");

  const milieu = index * POCKET_ARC;
  const rayonTexte = 36.5;
  const rad = ((milieu - 90) * Math.PI) / 180;

  return (
    <g>
      <path
        d={chemin}
        fill={POCKET_FILL[rouletteColor(value)]}
        stroke="var(--color-brass-deep)"
        strokeWidth="0.35"
      />
      <text
        x={(rayonTexte * Math.cos(rad)).toFixed(3)}
        y={(rayonTexte * Math.sin(rad)).toFixed(3)}
        // Les chiffres pointent vers le centre, comme sur un vrai cylindre.
        transform={`rotate(${milieu} ${(rayonTexte * Math.cos(rad)).toFixed(3)} ${(rayonTexte * Math.sin(rad)).toFixed(3)})`}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--color-cream)"
        fontSize="5.2"
        fontWeight="700"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {value}
      </text>
    </g>
  );
}

/** La bille, posée sur la piste extérieure. */
function Ball() {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute left-1/2 top-[3.5%] block size-[5.5%] -translate-x-1/2 rounded-full",
        "bg-cream shadow-[0_1px_3px_rgb(0_0_0/0.7),inset_0_-1px_2px_rgb(0_0_0/0.25)]",
      )}
    />
  );
}
