import {
  PLINKO_FALL_MS,
  PLINKO_ROWS,
  PLINKO_SLOTS,
  plinkoTable,
  type PlinkoBallView,
  type PlinkoRisk,
} from "@maxoujeux/shared";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { serverNow } from "@/lib/clock";
import { useReducedMotion } from "@/lib/motion";

/**
 * La planche de Plinko.
 *
 * Chaque bille rejoue le trajet **tiré par le serveur** : les douze rebonds
 * arrivent avec elle, et sa position se calcule à partir du temps écoulé depuis
 * son lâcher. C'est ce qui permet à un spectateur d'ouvrir la page en cours de
 * chute et de voir la bille au bon endroit, plutôt qu'une animation repartie de
 * zéro qui finirait dans la mauvaise case.
 *
 * **Rien n'annonce où la bille va tomber.** La case ne s'allume qu'au moment de
 * l'impact : le suspense est tout ce que ce jeu a à offrir, le gâcher en
 * surlignant la destination à l'avance viderait la chute de son intérêt.
 *
 * Le dessin est en coordonnées SVG fixes et non en pixels : la planche se met à
 * l'échelle du conteneur sans qu'aucune position n'ait à être recalculée.
 */

const WIDTH = 100;
const HEIGHT = 122;
/** Bord supérieur de la rangée de cases. */
const SLOTS_TOP = 94;
/** Hauteur de la zone de chute libre, au-dessus du premier picot. */
const DROP_Y = 8;
const FIRST_ROW_Y = 20;
const ROW_HEIGHT = (SLOTS_TOP - FIRST_ROW_Y) / PLINKO_ROWS;
/** Écart horizontal entre deux picots voisins. */
const PEG_GAP = 6.8;
const SLOT_WIDTH = WIDTH / PLINKO_SLOTS;
/** Durée du coup de projecteur sur une case touchée. */
const IMPACT_MS = 700;

/**
 * Abscisse après `row` rangées franchies dont `right` vers la droite.
 *
 * La bille entre au centre et s'écarte d'un demi-intervalle à chaque rebond :
 * c'est la même formule pour les picots et pour la bille, ce qui garantit
 * qu'elle passe **entre** les picots et non à travers.
 */
function xAt(row: number, right: number): number {
  return WIDTH / 2 + (right - row / 2) * PEG_GAP;
}

interface PlinkoBoardProps {
  risk: PlinkoRisk;
  balls: PlinkoBallView[];
  className?: string;
}

export function PlinkoBoard({ risk, balls, className }: PlinkoBoardProps) {
  const table = plinkoTable(risk);
  const reduced = useReducedMotion();
  // Les billes retenues un peu au-delà de leur chute : le serveur les retire
  // dès qu'elles ont atterri, alors que la case doit rester allumée le temps
  // qu'on voie l'impact.
  const vivantes = useRecentBalls(balls);
  const now = useAnimationClock(vivantes.length > 0 && !reduced);

  // Cases venant d'être touchées, avec l'ancienneté de l'impact : c'est ce qui
  // fait grossir le chiffre au passage de la bille, et seulement à ce
  // moment-là.
  const impacts = new Map<number, number>();
  for (const ball of vivantes) {
    const age = now - new Date(ball.droppedAt).getTime() - PLINKO_FALL_MS;
    if (age >= 0 && age < IMPACT_MS) {
      impacts.set(ball.slot, Math.min(impacts.get(ball.slot) ?? Infinity, age));
    }
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("h-full w-full", className)}
      role="img"
      aria-label={`Planche de Plinko, ${PLINKO_ROWS} rangées, risque ${risk}`}
    >
      {/* Les picots, rangée par rangée : trois en haut, quatorze en bas. */}
      {Array.from({ length: PLINKO_ROWS }, (_, row) =>
        Array.from({ length: row + 3 }, (_, peg) => (
          <circle
            key={`${row}-${peg}`}
            cx={xAt(row + 2, peg)}
            cy={FIRST_ROW_Y + row * ROW_HEIGHT}
            r="1.05"
            className="fill-plinko-picot"
          />
        )),
      )}

      {/* Les cases. Leur teinte suit le multiplicateur : le laiton est réservé
          à ce qui rapporte, le feutre à ce qui coûte. */}
      {table.map((tenths, slot) => {
        const impact = impacts.get(slot);
        const touche = impact !== undefined;
        // Le coup de projecteur s'éteint progressivement.
        const eclat = touche ? 1 - (impact ?? 0) / IMPACT_MS : 0;
        const gagnante = tenths >= 10;

        return (
          <g key={slot}>
            <rect
              x={slot * SLOT_WIDTH + 0.35}
              y={SLOTS_TOP + 3}
              width={SLOT_WIDTH - 0.7}
              height="15"
              rx="1.8"
              className={touche ? "fill-brass" : gagnante ? "fill-brass-deep" : "fill-felt-high"}
              opacity={touche ? 0.45 + 0.55 * eclat : gagnante ? 0.3 + Math.min(tenths, 250) / 420 : 0.55}
            />
            <text
              x={slot * SLOT_WIDTH + SLOT_WIDTH / 2}
              y={SLOTS_TOP + 12.4}
              textAnchor="middle"
              // `textLength` force l'étiquette à tenir dans sa case : « ×1,5 »
              // est deux fois plus large que « ×8 », et sans contrainte les
              // valeurs du centre se chevauchaient.
              textLength={SLOT_WIDTH - 1.6}
              lengthAdjust="spacingAndGlyphs"
              className={cn("font-display", touche ? "fill-felt-deep" : "fill-cream")}
              style={{
                fontSize: "4.6px",
                fontWeight: 800,
                // Le chiffre grossit sous l'impact, puis retombe.
                transform: touche ? `scale(${1 + 0.35 * eclat})` : undefined,
                transformOrigin: `${slot * SLOT_WIDTH + SLOT_WIDTH / 2}px ${SLOTS_TOP + 10.5}px`,
              }}
            >
              {formatMultiplier(tenths)}
            </text>
          </g>
        );
      })}

      {/* Les billes en vol. Plusieurs peuvent tomber ensemble : chacune a son
          propre trajet et son propre départ. */}
      {vivantes.map((ball) => {
        const position = ballPosition(ball, now, reduced);
        if (!position) return null;
        return (
          <g key={ball.id}>
            <circle cx={position.x} cy={position.y} r="2.1" className="fill-cream" />
            <circle cx={position.x - 0.65} cy={position.y - 0.65} r="0.65" fill="#fff" opacity={0.55} />
          </g>
        );
      })}
    </svg>
  );
}

/** « ×1,5 » plutôt que « 15 » — l'unité interne ne regarde pas le joueur. */
export function formatMultiplier(tenths: number): string {
  const value = tenths / 10;
  return `×${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")}`;
}

interface BallPosition {
  x: number;
  y: number;
}

/**
 * Position d'une bille à un instant donné.
 *
 * La chute se joue en deux temps : une entrée verticale au-dessus du premier
 * picot, puis douze rebonds. À chaque rangée, la bille passe d'un intervalle au
 * suivant en décrivant une petite cloche — un déplacement en ligne droite
 * donnerait une bille qui glisse, pas une bille qui tombe.
 *
 * Une vraie simulation physique serait un moteur de plus à tenir alors que le
 * trajet est déjà connu : c'est le serveur qui l'a tiré.
 */
function ballPosition(ball: PlinkoBallView, now: number, reduced: boolean): BallPosition | null {
  const elapsed = now - new Date(ball.droppedAt).getTime();

  // Réglage « réduire les animations » : la bille est posée dans sa case, sans
  // chute. Le résultat reste lisible, c'est le mouvement qui disparaît.
  if (reduced) {
    return { x: xAt(PLINKO_ROWS, ball.slot), y: SLOTS_TOP - 1 };
  }

  if (elapsed < 0 || elapsed > PLINKO_FALL_MS) return null;

  // Le premier dixième du temps sert à l'entrée : la bille arrive d'au-dessus
  // de la planche, au centre, plutôt que d'apparaître sur le premier picot.
  const ENTREE = 0.1;
  const progress = elapsed / PLINKO_FALL_MS;
  if (progress < ENTREE) {
    const part = progress / ENTREE;
    return { x: WIDTH / 2, y: DROP_Y + (FIRST_ROW_Y - DROP_Y) * part };
  }

  const exact = ((progress - ENTREE) / (1 - ENTREE)) * PLINKO_ROWS;
  const row = Math.min(PLINKO_ROWS - 1, Math.floor(exact));
  const within = exact - row;

  // Rebonds vers la droite déjà effectués : c'est ce qui donne l'abscisse.
  let right = 0;
  for (let i = 0; i < row; i += 1) {
    if (ball.path[i] === "right") right += 1;
  }
  const suivant = ball.path[row] === "right" ? right + 1 : right;

  const depart = xAt(row, right);
  const arrivee = xAt(row + 1, suivant);
  const x = depart + (arrivee - depart) * within;
  const y = FIRST_ROW_Y + (row + within) * ROW_HEIGHT;
  // Petit sursaut au-dessus de chaque picot : c'est ce qui fait le rebond.
  const rebond = Math.sin(within * Math.PI) * 1.1;

  return { x, y: y - rebond };
}

/**
 * Retient chaque bille jusqu'à la fin de son impact.
 *
 * Le serveur purge une bille dès qu'elle a atterri — c'est ce qui empêche son
 * état de grossir indéfiniment. Sans cette mémoire locale, la case s'éteindrait
 * dans la même image que l'arrivée de la bille, et le coup de projecteur ne se
 * verrait jamais.
 */
function useRecentBalls(balls: PlinkoBallView[]): PlinkoBallView[] {
  const memoire = useRef(new Map<string, PlinkoBallView>());
  const [, forcer] = useState(0);

  for (const ball of balls) memoire.current.set(ball.id, ball);

  const maintenant = serverNow();
  let expiree = false;
  for (const [id, ball] of memoire.current) {
    const age = maintenant - new Date(ball.droppedAt).getTime();
    if (age > PLINKO_FALL_MS + IMPACT_MS) {
      memoire.current.delete(id);
      expiree = true;
    }
  }
  void expiree;

  // Un dernier rendu après la dernière expiration, sinon la case resterait
  // allumée jusqu'au prochain événement de la table.
  useEffect(() => {
    if (memoire.current.size === 0) return;
    const timer = setTimeout(() => forcer((n) => n + 1), PLINKO_FALL_MS + IMPACT_MS + 50);
    return () => clearTimeout(timer);
  }, [balls]);

  return [...memoire.current.values()].sort(
    (a, b) => new Date(a.droppedAt).getTime() - new Date(b.droppedAt).getTime(),
  );
}

/**
 * Horloge d'animation.
 *
 * Une boucle `requestAnimationFrame` tant qu'il y a des billes, rien du tout
 * ensuite : une planche au repos ne doit pas réveiller le processeur soixante
 * fois par seconde, surtout sur un téléphone.
 */
function useAnimationClock(running: boolean): number {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      setNow(serverNow());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  return now;
}
