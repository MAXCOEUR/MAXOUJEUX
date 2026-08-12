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
 * sur un téléphone. Le GPU compose les rotations, React ne touche plus à rien.
 *
 * Trois mouvements indépendants, et c'est leur superposition qui fait le
 * réalisme : le cylindre tourne dans un sens sans viser quoi que ce soit, la
 * bille orbite dans l'autre en décélérant fortement, et elle **descend** de la
 * piste extérieure vers les cases en rebondissant sur la fin.
 *
 * Aucun repère fixe : le cylindre s'arrête sur un multiple de 360°, donc chaque
 * case garde son angle de dessin, et la bille s'immobilise pile sur celle que le
 * serveur a tirée. C'est elle qui annonce le numéro, comme sur une vraie table.
 *
 * Le `animation-delay` **négatif** est ce qui fait qu'un joueur arrivant à trois
 * secondes d'un lancer de sept voit la bille déjà bien avancée. Sans lui, elle
 * repartirait de zéro et s'arrêterait quatre secondes après tout le monde.
 *
 * La `key` sur les nœuds animés est indispensable : changer une propriété ne
 * relance pas une animation CSS, il faut que l'élément soit remonté.
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

  const retard = `-${Math.round(ecoule)}ms`;

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
      {/* Le cylindre tourne sans viser : seul le moyeu reste fixe. */}
      <div
        key={`cylindre-${deadlineAt ?? "fixe"}`}
        className="absolute inset-0"
        style={
          spinning
            ? {
                // Décélération douce : une vraie roue ralentit à peine sur sept
                // secondes, et une roue qui pile se lit comme un coup de frein.
                animation: `roue-tourne ${spinMs}ms cubic-bezier(0.22, 0.55, 0.3, 1) forwards`,
                animationDelay: retard,
                ["--roue-fin" as string]: `${wheelRotation()}deg`,
              }
            : undefined
        }
      >
        {/* La case gagnante est cerclée une fois la bille posée, comme le
            marqueur que le croupier pose sur le tapis. */}
        <Cylinder gagnant={spinning ? null : result} />
      </div>

      {/* La bille : orbite en sens inverse, et chute vers les cases. */}
      {result !== null && (
        <div
          key={`bille-${deadlineAt ?? "fixe"}-${result}`}
          className="absolute inset-0"
          style={
            spinning
              ? {
                  // Décélération bien plus marquée que celle du cylindre : c'est
                  // la bille qui perd sa vitesse, le contraste entre les deux
                  // fait tout le mouvement.
                  animation: `bille-orbite ${spinMs}ms cubic-bezier(0.1, 0.72, 0.18, 1) forwards`,
                  animationDelay: retard,
                  ["--bille-fin" as string]: `${ballRotation(result)}deg`,
                }
              : { transform: `rotate(${pocketAngle(result)}deg)` }
          }
        >
          <Ball spinning={spinning} spinMs={spinMs} retard={retard} />
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
function Cylinder({ gagnant }: { gagnant: number | null }) {
  return (
    <svg viewBox="-50 -50 100 100" className="size-full drop-shadow-[0_8px_18px_rgb(0_0_0/0.55)]" aria-hidden>
      <circle r="49" fill="var(--color-brass-deep)" />
      <circle r="46.5" fill="var(--color-felt-deep)" />
      {ROULETTE_WHEEL.map((pocket, index) => (
        <Pocket key={pocket} value={pocket} index={index} gagnante={pocket === gagnant} />
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
function Pocket({
  value,
  index,
  gagnante,
}: {
  value: number;
  index: number;
  gagnante: boolean;
}) {
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
        stroke={gagnante ? "var(--color-brass-bright)" : "var(--color-brass-deep)"}
        strokeWidth={gagnante ? "1.1" : "0.35"}
        style={gagnante ? { filter: "brightness(1.25)" } : undefined}
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

/**
 * La bille.
 *
 * Deux éléments imbriqués et non un seul : le centrage horizontal est un
 * `transform`, et l'animation de chute en est un autre. Les cumuler sur le même
 * nœud ferait que l'animation écrase le centrage, et la bille partirait sur le
 * côté du cylindre.
 *
 * Le déplacement vaut 127 % de son propre diamètre, ce qui l'amène du rail
 * extérieur au milieu de la couronne des cases — et la valeur suit
 * automatiquement la taille du cylindre, puisque la bille est dimensionnée en
 * pourcentage de celui-ci.
 */
const CHUTE = "127%";

function Ball({
  spinning,
  spinMs,
  retard,
}: {
  spinning: boolean;
  spinMs: number;
  retard: string;
}) {
  return (
    <span
      aria-hidden
      className="absolute left-1/2 top-[3.5%] block size-[5.5%] -translate-x-1/2"
    >
      <span
        className={cn(
          "block size-full rounded-full",
          "bg-cream shadow-[0_1px_3px_rgb(0_0_0/0.7),inset_0_-1px_2px_rgb(0_0_0/0.25)]",
        )}
        style={
          spinning
            ? {
                animation: `bille-chute ${spinMs}ms linear forwards`,
                animationDelay: retard,
                ["--bille-chute" as string]: CHUTE,
              }
            : { transform: `translateY(${CHUTE})` }
        }
      />
    </span>
  );
}
