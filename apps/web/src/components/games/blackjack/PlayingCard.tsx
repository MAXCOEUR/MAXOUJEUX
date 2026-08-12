import type { BlackjackCard } from "@maxoujeux/shared";
import { cardLabel, isRedSuit, SUIT_GLYPHS } from "@/lib/blackjack-ui";
import { cn } from "@/lib/cn";

interface PlayingCardProps {
  /** `null` : carte fermée. Aucune donnée de la carte n'a alors traversé le réseau. */
  card: BlackjackCard | null;
  /** Rang dans la donne : décale l'arrivée pour que les cartes sortent une à une. */
  dealIndex?: number;
  /** Abscisse du sabot, en pourcentage de la largeur de carte. */
  dealFromX?: number;
  className?: string;
}

/**
 * Une carte à jouer.
 *
 * Deux faces empilées dans un conteneur en trois dimensions : la face visible
 * et le dos, chacune masquée quand elle tourne le dos à l'écran. Le
 * retournement est piloté par l'attribut `data-face`, donc par une transition
 * CSS et non par une image-clé — voir le commentaire de `.carte-3d` dans
 * `index.css`, c'est ce qui permet à la carte fermée du croupier de se
 * retourner sans être remontée.
 *
 * L'animation de distribution, elle, est bien une image-clé posée en ligne.
 * Elle se joue **une seule fois**, au montage du nœud : un rendu React
 * provoqué par autre chose ne la relance pas, puisqu'une animation CSS ne
 * redémarre pas sans remontage. C'est ce qui évite de tenir une liste des
 * cartes déjà animées.
 */
export function PlayingCard({ card, dealIndex = 0, dealFromX = 260, className }: PlayingCardProps) {
  return (
    <span
      role="img"
      aria-label={cardLabel(card)}
      className={cn(
        "relative block aspect-[5/7] w-[var(--carte-l)] shrink-0 [perspective:900px]",
        className,
      )}
      style={{
        // Tout l'intérieur de la carte est dimensionné en `em` : une seule
        // variable de largeur suffit alors à faire grandir la carte entière,
        // index et glyphes compris. Deux jeux de tailles à tenir en accord
        // finiraient par diverger au premier ajustement.
        fontSize: "calc(var(--carte-l) / 2.6)",
        animation: "var(--animate-donne)",
        animationDelay: `${dealIndex * 95}ms`,
        ["--donne-x" as string]: `${dealFromX}%`,
      }}
    >
      <span aria-hidden className="carte-3d relative block size-full" data-face={card ? "up" : "down"}>
        <span className="absolute inset-0">{card ? <Face card={card} /> : null}</span>
        <span className="carte-dos absolute inset-0">
          <Back />
        </span>
      </span>
    </span>
  );
}

/**
 * Face visible.
 *
 * Les deux index en diagonale ne sont pas un détail décoratif : c'est ce qui
 * permet de lire une main en éventail, où seul le coin supérieur gauche de
 * chaque carte dépasse. Sans eux, il faudrait écarter les cartes pour compter.
 */
function Face({ card }: { card: BlackjackCard }) {
  const rouge = isRedSuit(card.suit);
  const encre = rouge ? "var(--color-carte-rouge)" : "var(--color-carte-noir)";
  const glyphe = SUIT_GLYPHS[card.suit];
  const figure = card.rank === "J" || card.rank === "Q" || card.rank === "K";

  return (
    <span
      className="relative grid size-full place-items-center overflow-hidden rounded-[0.28em] shadow-[0_2px_5px_rgb(0_0_0/0.45),0_0_0_1px_var(--color-carte-ombre)]"
      style={{
        backgroundImage:
          "linear-gradient(160deg, var(--color-carte) 0%, var(--color-carte) 62%, var(--color-carte-ombre) 130%)",
        color: encre,
      }}
    >
      <Index rank={card.rank} glyphe={glyphe} />
      <Index rank={card.rank} glyphe={glyphe} retourne />

      {figure ? (
        // Une figure : un cartouche gravé plutôt qu'un dessin. Dessiner un roi
        // lisible à 40 px de large n'est pas possible ; un monogramme encadré
        // se lit, et garde la carte crédible.
        <span
          className="grid aspect-[3/4] w-[46%] place-items-center rounded-[0.15em] font-display text-[1.35em] font-black leading-none"
          style={{ border: "0.06em solid currentColor", opacity: 0.9 }}
        >
          {card.rank}
        </span>
      ) : (
        <span className="font-display text-[1.9em] leading-none" style={{ opacity: 0.92 }}>
          {glyphe}
        </span>
      )}
    </span>
  );
}

function Index({ rank, glyphe, retourne = false }: { rank: string; glyphe: string; retourne?: boolean }) {
  return (
    <span
      className={cn(
        "absolute flex flex-col items-center leading-none",
        retourne ? "bottom-[6%] right-[7%] rotate-180" : "left-[7%] top-[6%]",
      )}
    >
      <span className="font-display text-[0.72em] font-black tracking-tight">{rank}</span>
      <span className="text-[0.6em]">{glyphe}</span>
    </span>
  );
}

/**
 * Dos de carte.
 *
 * Bordeaux et laiton : c'est la seule surface du site hors palette, et c'est
 * délibéré. Un dos couleur feutre disparaîtrait sur le tapis ; un dos de carte
 * doit s'en détacher, sinon la main du croupier n'a plus de contour.
 */
function Back() {
  return (
    <span
      className="relative grid size-full place-items-center overflow-hidden rounded-[0.28em] shadow-[0_2px_5px_rgb(0_0_0/0.45)]"
      style={{
        backgroundColor: "var(--color-dos-profond)",
        boxShadow: "0 2px 5px rgb(0 0 0 / 0.45), inset 0 0 0 0.07em var(--color-brass-deep)",
      }}
    >
      <span
        aria-hidden
        className="absolute inset-[0.12em] rounded-[0.18em]"
        style={{
          backgroundColor: "var(--color-dos)",
          backgroundImage:
            "repeating-linear-gradient(45deg, rgb(0 0 0 / 0.32) 0 0.12em, transparent 0.12em 0.26em), repeating-linear-gradient(-45deg, rgb(0 0 0 / 0.32) 0 0.12em, transparent 0.12em 0.26em)",
        }}
      />
      <span
        aria-hidden
        className="relative aspect-square w-[34%] rotate-45"
        style={{ border: "0.055em solid var(--color-brass)", opacity: 0.75 }}
      />
    </span>
  );
}
