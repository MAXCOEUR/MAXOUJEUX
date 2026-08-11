import { formatCoins } from "@maxoujeux/shared";
import { useId } from "react";
import { cn } from "@/lib/cn";

interface StakePickerProps {
  options: number[];
  value: number;
  onChange: (value: number) => void;
  /** Solde du joueur : les paliers hors de portée sont désactivés, pas masqués. */
  balance: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Choix de la mise, en jetons.
 *
 * Ce sont de vrais boutons radio masqués, pas un curseur maison. Le bénéfice
 * n'est pas cosmétique : la navigation aux flèches, la sémantique de groupe et
 * le focus clavier viennent gratuitement avec l'élément natif, là où un curseur
 * fait main demanderait à les réimplémenter — et le ferait mal.
 *
 * Les paliers trop chers restent visibles en grisé : les masquer laisserait
 * croire que la mise maximale est plus basse qu'elle ne l'est.
 */
export function StakePicker({
  options,
  value,
  onChange,
  balance,
  disabled = false,
  className,
}: StakePickerProps) {
  const name = useId();

  return (
    <fieldset className={cn("min-w-0", className)} disabled={disabled}>
      <legend className="sr-only">Choisir sa mise</legend>

      <div className="grid grid-cols-5 gap-2">
        {options.map((option) => {
          const unaffordable = option > balance;
          const checked = option === value;

          return (
            <label
              key={option}
              className={cn(
                "group relative grid min-h-11 cursor-pointer place-items-center rounded-full",
                "border-2 border-line-strong bg-felt-deep/60 text-sm font-semibold text-cream-dim",
                "transition-[background-color,border-color,color,transform]",
                "has-[:checked]:border-brass has-[:checked]:bg-brass has-[:checked]:text-felt-deep",
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brass",
                unaffordable
                  ? "cursor-not-allowed opacity-40"
                  : "hover:border-brass/60 active:translate-y-px",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option}
                checked={checked}
                disabled={unaffordable}
                onChange={() => onChange(option)}
                className="sr-only"
              />
              <span className="tabular">{option}</span>
            </label>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-cream-faint">
        Ton solde : <span className="tabular text-cream-dim">{formatCoins(balance)}</span>
      </p>
    </fieldset>
  );
}
