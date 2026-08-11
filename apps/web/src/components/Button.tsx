import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "outline" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
}

/**
 * Le laiton est réservé à l'action principale et aux MaxouCoin. Deux boutons
 * en laiton sur un même écran feraient perdre au premier sa fonction de repère.
 */
const VARIANTS: Record<Variant, string> = {
  primary: cn(
    "bg-linear-to-b from-brass-bright to-brass text-felt-deep font-semibold",
    "shadow-[inset_0_1px_0_rgb(255_255_255/0.45),0_10px_24px_-12px_rgb(200_162_80/0.7)]",
    "hover:from-brass-bright hover:to-brass-bright",
  ),
  outline: cn(
    "border border-line-strong bg-felt-raised/50 text-cream",
    "hover:border-brass/60 hover:bg-felt-high",
  ),
  ghost: "text-cream-dim hover:bg-felt-raised hover:text-cream",
};

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
        "transition-[background,border-color,color,opacity,transform] duration-150",
        "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0",
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
