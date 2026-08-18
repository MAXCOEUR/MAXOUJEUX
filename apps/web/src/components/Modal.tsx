import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

type Variant = "lateral" | "feuille";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Étiquette accessible quand le titre n'est pas du texte simple. */
  label?: string;
  /**
   * `lateral` : panneau collé à droite, pleine hauteur (porte-monnaie).
   * `feuille` : feuille basse sur téléphone, boîte centrée sur grand écran.
   */
  variant?: Variant;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Boîte de dialogue.
 *
 * Extraite du panneau de porte-monnaie, qui portait déjà tout le motif —
 * `role="dialog"`, fond flouté cliquable, fermeture à l'échappement. Deux
 * manques du panneau d'origine sont corrigés ici parce qu'ils se paient
 * immédiatement au clavier :
 *
 * - le focus était laissé filer derrière la boîte ; il y est maintenant piégé ;
 * - il n'était pas rendu à l'élément déclencheur à la fermeture, ce qui perd
 *   complètement un utilisateur au clavier.
 */
export function Modal({
  open,
  onClose,
  title,
  label,
  variant = "feuille",
  children,
  footer,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    // Élément qui avait le focus avant l'ouverture : on le lui rendra.
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      // Piège de focus : sans lui, la tabulation sort de la boîte et parcourt la
      // page qu'elle est censée masquer.
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const lateral = variant === "lateral";

  const dialog = (
    <div
      className={cn(
        "fixed inset-0 z-[70] flex",
        lateral ? "justify-end" : "items-end justify-center sm:items-center",
      )}
    >
      {/* Fond cliquable pour fermer. `aria-hidden` : le bouton de fermeture
          dédié suffit aux technologies d'assistance. */}
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/65 backdrop-blur-sm" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label ? undefined : titleId}
        aria-label={label}
        className={cn(
          "animate-rise relative flex flex-col bg-felt shadow-2xl",
          lateral
            // Le panneau latéral ne défile pas lui-même : c'est son contenu qui
            // scrolle. Sans cela, un contenu haut — le chat — pousse sa zone de
            // saisie hors de l'écran au lieu de la garder collée en bas.
            ? "h-full w-full max-w-md overflow-hidden border-l border-line"
            : cn(
                "max-h-[calc(100dvh-0.5rem)] w-full overflow-hidden rounded-t-2xl border border-line",
                "sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:rounded-2xl",
                // Zone sûre iOS : sans ce complément, la barre d'action d'une
                // feuille basse passe sous la barre de gestes.
                "pb-[env(safe-area-inset-bottom)] sm:pb-0",
              ),
          className,
        )}
      >
        <header className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-line bg-felt/95 px-5 py-4 backdrop-blur">
          <h2 id={titleId} className="font-display text-lg font-semibold text-cream">
            {title}
          </h2>
          <Button
            ref={closeRef}
            variant="ghost"
            onClick={onClose}
            aria-label="Fermer"
            className="px-2.5"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </header>

        <div data-modal-body="true" className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {children}
        </div>

        {footer && (
          <footer className="shrink-0 border-t border-line bg-felt/95 px-5 py-4 backdrop-blur">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );

  // Une modale rendue sous un parent animé (`transform`) n'est plus réellement
  // fixe par rapport à la fenêtre et peut passer sous la navigation. Le portail
  // l'isole de ces contextes d'empilement. Le retour direct conserve le rendu
  // côté serveur utilisé par les tests et le pré-rendu.
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
