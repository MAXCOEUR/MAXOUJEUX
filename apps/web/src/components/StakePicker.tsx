import { formatCoins } from "@maxoujeux/shared";
import { useId } from "react";
import { cn } from "@/lib/cn";

interface StakePickerProps {
  /** Paliers proposés d'un geste. Ce ne sont que des raccourcis. */
  options: number[];
  value: number;
  onChange: (value: number) => void;
  /** Mise minimale et pas autorisé, repris du catalogue des jeux. */
  min: number;
  step: number;
  /** Solde du joueur : c'est le seul plafond, et il est annoncé comme tel. */
  balance: number;
  disabled?: boolean;
  className?: string;
}

/** Plus grosse mise valide que le solde permet. */
export function maxStakeFor(balance: number, min: number, step: number): number {
  if (balance < min) return min;
  return min + Math.floor((balance - min) / step) * step;
}

/**
 * Choix de la mise.
 *
 * Deux façons de saisir, parce qu'il n'y a plus de plafond : des paliers pour le
 * geste courant, et un champ libre pour tout le reste. Les paliers sont de vrais
 * boutons radio masqués et non un curseur maison — la navigation aux flèches, la
 * sémantique de groupe et le focus clavier viennent gratuitement avec l'élément
 * natif, là où un curseur fait main demanderait à les réimplémenter, et le ferait
 * mal.
 *
 * Les paliers hors de portée restent visibles en grisé : les masquer laisserait
 * croire que la mise maximale est plus basse qu'elle ne l'est. Le seul vrai
 * plafond est le solde, d'où le raccourci « Tout » qui le dit sans détour.
 */
export function StakePicker({
  options,
  value,
  onChange,
  min,
  step,
  balance,
  disabled = false,
  className,
}: StakePickerProps) {
  const name = useId();
  const fieldId = useId();
  const maximum = maxStakeFor(balance, min, step);
  const abordable = balance >= min;

  return (
    <fieldset className={cn("min-w-0", className)} disabled={disabled}>
      <legend className="sr-only">Choisir sa mise</legend>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const unaffordable = option > balance;

          return (
            <label
              key={option}
              className={cn(
                "group relative grid min-h-11 min-w-14 flex-1 cursor-pointer place-items-center rounded-full px-2",
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
                checked={option === value}
                disabled={unaffordable}
                onChange={() => onChange(option)}
                className="sr-only"
              />
              <span className="tabular">{option}</span>
            </label>
          );
        })}
      </div>

      <div className="mt-2 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={fieldId} className="text-xs text-cream-faint">
            Ou un autre montant
          </label>
          <input
            id={fieldId}
            type="number"
            inputMode="numeric"
            min={min}
            step={step}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className={cn(
              "tabular mt-1 h-11 w-full rounded-xl border border-line bg-felt-deep px-3 text-sm text-cream",
              "outline-none focus:border-brass/70",
            )}
          />
        </div>
        <button
          type="button"
          onClick={() => onChange(maximum)}
          disabled={!abordable}
          className={cn(
            "h-11 shrink-0 rounded-xl border border-line-strong px-3 text-sm font-semibold",
            "text-cream-dim transition-colors hover:border-brass/60 hover:text-cream",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          Tout
        </button>
      </div>

      <p className="mt-2 text-xs text-cream-faint">
        Ton solde : <span className="tabular text-cream-dim">{formatCoins(balance)}</span> — c'est
        la seule limite.
      </p>
    </fieldset>
  );
}
