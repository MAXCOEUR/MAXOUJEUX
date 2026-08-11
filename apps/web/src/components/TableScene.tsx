import { GAMES } from "@maxoujeux/shared";
import { GameArtefact } from "./GameArtefact";

/**
 * La table de jeu — signature de l'écran d'accueil.
 *
 * Les cinq artefacts sont posés comme si quelqu'un avait quitté la table au
 * milieu d'une soirée : légèrement de biais, à des hauteurs différentes, sans
 * grille visible. C'est cette irrégularité qui donne l'impression d'objets
 * réels ; un alignement parfait produirait une planche d'icônes.
 *
 * Les inclinaisons et décalages sont écrits en dur et non tirés au hasard :
 * la composition doit être la même à chaque visite.
 */
const LAYOUT = [
  { rotate: -7, x: -2, y: 4, scale: 1.12, delay: 0 },
  { rotate: 5, x: 6, y: -6, scale: 0.92, delay: 90 },
  { rotate: -3, x: -8, y: 2, scale: 0.86, delay: 180 },
  { rotate: 8, x: 4, y: 6, scale: 0.9, delay: 270 },
  { rotate: -5, x: 2, y: -4, scale: 0.8, delay: 360 },
] as const;

export function TableScene() {
  return (
    <div
      className="relative grid h-full w-full grid-cols-2 place-items-center gap-6 p-8 sm:gap-10 sm:p-12"
      aria-hidden
    >
      {/* Halo du plafonnier au-dessus de la table. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(28rem 20rem at 50% 35%, oklch(0.78 0.1 88 / 0.18), transparent 70%)",
        }}
      />

      {GAMES.map((game, index) => {
        const pose = LAYOUT[index] ?? LAYOUT[0];
        return (
          <div
            key={game.code}
            // Le troisième artefact prend toute la largeur : la composition
            // reste asymétrique au lieu de retomber sur deux colonnes égales.
            className={index === 2 ? "col-span-2 w-1/2" : "w-full"}
            style={{
              transform: `translate(${pose.x}%, ${pose.y}%) rotate(${pose.rotate}deg) scale(${pose.scale})`,
              animation: `var(--animate-deal)`,
              animationDelay: `${pose.delay}ms`,
            }}
          >
            <div className="drop-shadow-[0_16px_24px_rgb(0_0_0/0.5)]">
              <GameArtefact code={game.code} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
