import { GAMES } from "@maxoujeux/shared";
import { GameArtefact } from "./GameArtefact";

/**
 * La table de jeu — signature de l'écran d'accueil.
 *
 * Les six artefacts sont posés comme si quelqu'un avait quitté la table au
 * milieu d'une soirée : légèrement de biais, à des hauteurs différentes, sans
 * grille visible. C'est cette irrégularité qui donne l'impression d'objets
 * réels ; un alignement parfait produirait une planche d'icônes.
 *
 * Les inclinaisons et décalages sont écrits en dur et non tirés au hasard :
 * la composition doit être la même à chaque visite.
 */
const LAYOUT = [
  { rotate: -7, x: -2, y: 4, scale: 0.96, delay: 0 },
  { rotate: 5, x: 4, y: -5, scale: 0.88, delay: 90 },
  { rotate: -3, x: -4, y: 2, scale: 0.9, delay: 180 },
  { rotate: 7, x: 3, y: 5, scale: 0.86, delay: 270 },
  { rotate: -5, x: 2, y: -4, scale: 0.84, delay: 360 },
  { rotate: 4, x: -3, y: 3, scale: 0.88, delay: 450 },
] as const;

export function TableScene() {
  return (
    <div
      className="relative grid h-full min-h-0 w-full grid-cols-3 grid-rows-2 place-items-center gap-4 p-4 xl:gap-6 xl:p-8"
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
            data-table-scene-item
            className="w-full min-w-0"
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
