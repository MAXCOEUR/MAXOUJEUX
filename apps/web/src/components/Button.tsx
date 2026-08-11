import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "outline";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-linear-to-r from-accent-violet to-accent-cyan text-night font-semibold " +
    "shadow-[0_8px_24px_-8px_rgba(167,139,250,0.6)] hover:brightness-110",
  outline: "border border-line-strong text-ink hover:bg-surface-2 hover:border-accent-violet/60",
  ghost: "text-ink-muted hover:text-ink hover:bg-surface-2",
};

/**
 * `forwardRef` est nécessaire : le panneau MaxouCoin doit pouvoir donner le
 * focus à son bouton de fermeture à l'ouverture.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading = false, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      // Un bouton en cours de soumission reste focusable mais refuse les clics :
      // le désactiver ferait perdre le focus clavier au milieu du formulaire.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm",
        "transition-[filter,background-color,border-color,opacity] duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
