import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/motion";

interface ConfettisProps {
  /**
   * Change de valeur à chaque gain à fêter.
   *
   * Une clé et non un booléen : deux gains d'affilée doivent relancer la pluie,
   * ce qu'un `true` déjà vrai ne ferait pas.
   */
  cle: number | string | null;
  /** Pluie plus dense et plus longue pour un gros gain. */
  intense?: boolean;
}

/** Palette du site : laiton pour les jetons, crème et vert de feutre. */
const COULEURS = ["#c8a250", "#e8cd8a", "#f2ede0", "#58c98a", "#8a6a28"];

interface Particule {
  x: number;
  y: number;
  vx: number;
  vy: number;
  taille: number;
  rotation: number;
  vitesseRotation: number;
  couleur: string;
}

/**
 * Pluie de confettis sur un gain.
 *
 * Canvas dessiné à la main, sans bibliothèque : le projet trace déjà sa roue de
 * la fortune et son plateau de Plinko de cette façon, et une dépendance pèserait
 * plus lourd que les quatre-vingts lignes qu'elle remplacerait.
 *
 * Rien n'est rendu sous « réduire les animations » — mais **le son reste** :
 * ce réglage parle du mouvement, pas de l'audio, et le confondre priverait de
 * tout retour quelqu'un qui n'a demandé qu'à ne plus voir bouger son écran.
 */
export function Confettis({ cle, intense = false }: ConfettisProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (cle === null) return;
    if (prefersReducedMotion()) return;

    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const largeur = element.clientWidth;
    const hauteur = element.clientHeight;
    element.width = largeur * ratio;
    element.height = hauteur * ratio;
    ctx.scale(ratio, ratio);

    const total = intense ? 160 : 90;
    const duree = intense ? 3_400 : 2_400;

    // Deux gerbes parties des coins bas plutôt qu'une chute depuis le haut : le
    // regard est au centre de la table, c'est là que les confettis doivent
    // culminer.
    const particules: Particule[] = Array.from({ length: total }, (_, index) => {
      const gauche = index % 2 === 0;
      const angle = (gauche ? -60 : -120) + (Math.random() * 40 - 20);
      const vitesse = 9 + Math.random() * 9;
      const radians = (angle * Math.PI) / 180;
      return {
        x: gauche ? 0 : largeur,
        y: hauteur,
        vx: Math.cos(radians) * vitesse * (gauche ? 1 : -1),
        vy: Math.sin(radians) * vitesse,
        taille: 5 + Math.random() * 6,
        rotation: Math.random() * Math.PI * 2,
        vitesseRotation: (Math.random() - 0.5) * 0.35,
        couleur: COULEURS[index % COULEURS.length] ?? COULEURS[0]!,
      };
    });

    let debut: number | null = null;
    let frame = 0;

    function dessine(temps: number) {
      if (!ctx) return;
      if (debut === null) debut = temps;
      const ecoule = temps - debut;

      ctx.clearRect(0, 0, largeur, hauteur);

      // La disparition se fait sur le dernier tiers : couper net laisserait des
      // confettis suspendus en l'air.
      const reste = 1 - Math.max(0, (ecoule - duree * 0.65) / (duree * 0.35));
      ctx.globalAlpha = Math.max(0, Math.min(1, reste));

      for (const p of particules) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.32; // gravité
        p.vx *= 0.99; // frottement de l'air
        p.rotation += p.vitesseRotation;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.couleur;
        // Rectangles et non disques : un confetti est un morceau de papier, et
        // sa rotation ne se verrait pas sur un cercle.
        ctx.fillRect(-p.taille / 2, -p.taille / 4, p.taille, p.taille / 2);
        ctx.restore();
      }

      if (ecoule < duree) frame = requestAnimationFrame(dessine);
      else ctx.clearRect(0, 0, largeur, hauteur);
    }

    frame = requestAnimationFrame(dessine);
    return () => cancelAnimationFrame(frame);
  }, [cle, intense]);

  if (cle === null) return null;

  return (
    <canvas
      ref={canvas}
      aria-hidden
      // `pointer-events-none` est ce qui rend la surimpression inoffensive : le
      // joueur doit pouvoir relancer une manche pendant que ça tombe.
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
    />
  );
}
