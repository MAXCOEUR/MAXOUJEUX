import { AlertTriangle, Coins, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToasts, type ToastTone } from "@/lib/toast";

const TONES: Record<ToastTone, { style: string; icon: typeof Info }> = {
  info: { style: "border-line-strong text-cream", icon: Info },
  erreur: { style: "border-danger/50 text-danger", icon: AlertTriangle },
  gain: { style: "border-brass/50 text-brass-bright", icon: Coins },
};

/**
 * Pile de notifications.
 *
 * Montée une seule fois dans la coquille de l'application. En bas à droite sur
 * grand écran ; sur téléphone, **sous** l'en-tête collant et non au-dessus,
 * sinon la notification masque le solde et le bouton du porte-monnaie.
 */
export function Toaster() {
  const toasts = useToasts((state) => state.toasts);
  const dismiss = useToasts((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed z-[60] flex flex-col gap-2",
        "inset-x-4 top-[4.5rem]",
        "sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-auto sm:w-80",
      )}
    >
      {toasts.map((toast) => {
        const { style, icon: Icon } = TONES[toast.tone];
        return (
          <div
            key={toast.id}
            // `alert` interrompt la lecture en cours : réservé aux erreurs.
            role={toast.tone === "erreur" ? "alert" : "status"}
            className={cn(
              "panel animate-rise pointer-events-auto flex items-start gap-2.5 border px-3.5 py-3 text-sm",
              style,
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1 leading-snug">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Masquer"
              className="-mr-1 -mt-1 rounded p-1 text-cream-faint transition-colors hover:text-cream"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
