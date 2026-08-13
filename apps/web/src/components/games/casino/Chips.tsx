import { formatCoins } from "@maxoujeux/shared";
import { CHIP_COLORS, CHIP_INK, CHIP_VALUES, chipStack, type ChipValue } from "@/lib/chips";
import { cn } from "@/lib/cn";

/**
 * Un jeton.
 *
 * Trois couches font la lecture : le dégradé sphérique qui donne l'épaisseur,
 * les encoches de tranche en dégradé conique — masquées au centre pour ne
 * rester que sur le bord, comme sur un vrai jeton — et le liseré intérieur. La
 * valeur est imprimée dessus : la couleur seule ne suffit pas, ni pour un
 * daltonisme, ni pour un joueur qui découvre le code des couleurs.
 */
export function Chip({ value, className }: { value: ChipValue; className?: string }) {
  const couleur = CHIP_COLORS[value];

  return (
    <span
      aria-hidden
      className={cn(
        "relative grid aspect-square w-[var(--jeton-l)] shrink-0 place-items-center rounded-full",
        "shadow-[0_2px_4px_rgb(0_0_0/0.45),inset_0_-2px_3px_rgb(0_0_0/0.3),inset_0_2px_2px_rgb(255_255_255/0.28)]",
        className,
      )}
      style={{
        backgroundImage: `radial-gradient(circle at 50% 32%, color-mix(in oklab, ${couleur} 74%, white), ${couleur} 68%)`,
        fontSize: "calc(var(--jeton-l) / 3.4)",
        color: CHIP_INK[value],
      }}
    >
      <span
        className="absolute inset-0 rounded-full"
        style={{
          backgroundImage:
            "repeating-conic-gradient(from 0deg, rgb(255 255 255 / 0.72) 0deg 11deg, transparent 11deg 34deg)",
          maskImage: "radial-gradient(circle, transparent 63%, black 64%)",
          WebkitMaskImage: "radial-gradient(circle, transparent 63%, black 64%)",
        }}
      />
      <span
        className="absolute inset-[19%] rounded-full"
        style={{ border: "0.08em solid rgb(255 255 255 / 0.32)" }}
      />
      <span className="relative font-display font-black leading-none tracking-tight">{value}</span>
    </span>
  );
}

/**
 * Pile de jetons posée dans une case de mise.
 *
 * Empilée vers le haut avec un léger désalignement : une pile parfaitement
 * alignée se lit comme un seul jeton épais, le décalage est ce qui fait compter
 * les jetons. L'animation de lancer se joue au montage de chaque jeton, donc
 * une seule fois — ajouter un jeton à la pile n'anime que le nouveau.
 */
export function ChipStack({
  amount,
  values,
  max = 5,
  className,
  animate = true,
}: {
  amount: number;
  /**
   * Jetons réellement posés, dans l'ordre. Quand le joueur compose sa mise
   * lui-même, la pile doit montrer **ses** jetons : décomposer 60 en 50 + 10
   * après qu'il a posé six jetons de 10 lui ferait croire à une erreur.
   */
  values?: ChipValue[];
  max?: number;
  className?: string;
  animate?: boolean;
}) {
  const stack = values ?? chipStack(amount, max);
  if (stack.length === 0) return null;

  return (
    <span className={cn("relative inline-block w-[var(--jeton-l)]", className)} aria-hidden>
      {/* Réserve la hauteur de la pile : sans elle, les jetons décalés en
          position absolue déborderaient sur les cartes du dessus. */}
      <span
        className="block w-[var(--jeton-l)]"
        style={{ height: `calc(var(--jeton-l) * ${1 + (stack.length - 1) * 0.22})` }}
      />
      {stack.map((value, index) => (
        // La clé est l'index et non la valeur : deux jetons de 10 doivent être
        // deux nœuds distincts, et un jeton ajouté en haut de pile doit être le
        // seul à se monter — donc le seul à jouer le lancer.
        <span
          key={index}
          className="absolute bottom-0 left-0 block w-[var(--jeton-l)]"
          // Deux nœuds imbriqués, et non un seul : la dernière image-clé du
          // lancer remet `transform` à zéro. Portés par le même élément, le
          // décalage de pile serait effacé pendant le vol puis rétabli d'un
          // coup à l'atterrissage — le jeton sauterait de côté à la fin.
          style={{ transform: `translate(${(index % 2 === 0 ? -1 : 1) * 3}%, ${-index * 22}%)` }}
        >
          <span
            className="block"
            style={
              animate
                ? { animation: "var(--animate-jeton)", animationDelay: `${index * 55}ms` }
                : undefined
            }
          >
            <Chip value={value} />
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Râtelier de mise.
 *
 * Un vrai joueur ne tape pas un montant, il pousse des jetons dans la case.
 * Chaque appui ajoute la valeur du jeton à la mise en cours ; c'est aussi ce
 * qui rend la mise atteignable au doigt, là où un champ numérique ouvre un
 * clavier par-dessus la table.
 *
 * Les valeurs hors de portée du solde restent visibles en grisé : les masquer
 * laisserait croire que la mise maximale est plus basse qu'elle ne l'est.
 */
export function ChipRack({
  balance,
  current,
  max,
  disabled = false,
  selected,
  onAdd,
}: {
  balance: number;
  current: number;
  max: number;
  disabled?: boolean;
  /**
   * Jeton actuellement choisi, quand le râtelier sert à **sélectionner** plutôt
   * qu'à ajouter — c'est le cas de la roulette, où l'on choisit sa valeur puis
   * on clique les cases du tapis. Sans cette marque, rien ne dirait ce qu'un
   * clic sur le tapis va poser.
   */
  selected?: ChipValue;
  onAdd: (value: ChipValue) => void;
}) {
  return (
    <div
      // Une seule ligne qui defile sur telephone : sept jetons sur deux lignes
      // faisaient du panneau de mise la moitie de l'ecran, et le tapis
      // disparaissait dessous. `pan-x` laisse le geste vertical remonter a la
      // page, sinon on se retrouve bloque des qu'on pose le doigt ici.
      className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [touch-action:pan-x_pan-y] sm:flex-wrap sm:justify-center sm:overflow-visible"
      role="group"
      aria-label="Poser un jeton"
    >
      {[...CHIP_VALUES].reverse().map((value) => {
        const trop = current + value > max || current + value > balance;
        const choisi = selected === value;
        return (
          <button
            key={value}
            type="button"
            disabled={disabled || trop}
            onClick={() => onAdd(value)}
            aria-pressed={selected === undefined ? undefined : choisi}
            aria-label={`${selected === undefined ? "Poser" : "Choisir le jeton de"} ${formatCoins(value)}`}
            className={cn(
              "rounded-full transition-transform duration-150",
              "[--jeton-l:2.75rem] sm:[--jeton-l:3rem]",
              trop
                ? "cursor-not-allowed opacity-30"
                : "hover:-translate-y-1 active:translate-y-0 active:scale-95",
              choisi && "-translate-y-1 ring-2 ring-brass ring-offset-2 ring-offset-felt",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass",
            )}
          >
            <Chip value={value} />
          </button>
        );
      })}
    </div>
  );
}
