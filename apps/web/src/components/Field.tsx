import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

export function Field({ label, error, hint, className, type = "text", ...props }: FieldProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);

  const isPassword = type === "password";
  const effectiveType = isPassword && revealed ? "text" : type;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-xs font-semibold uppercase tracking-[0.08em] text-cream-faint"
      >
        {label}
      </label>

      <div className="relative">
        <input
          {...props}
          id={id}
          type={effectiveType}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "w-full rounded-xl border bg-felt-deep/60 px-3.5 py-2.5 text-sm text-cream",
            "placeholder:text-cream-faint transition-colors",
            "focus:border-brass focus:outline-none",
            isPassword && "pr-11",
            error ? "border-danger" : "border-line-strong",
            className,
          )}
        />

        {/* Un mot de passe de dix caractères minimum se tape mal en aveugle :
            la bascule évite l'échec de saisie plutôt que de le signaler après. */}
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-cream-faint transition-colors hover:text-cream"
          >
            {revealed ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        )}
      </div>

      {/* `role="alert"` : les lecteurs d'écran annoncent l'erreur dès qu'elle
          apparaît, sans que l'utilisateur ait à revenir sur le champ. */}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${id}-hint`} className="text-xs text-cream-faint">
          {hint}
        </p>
      )}
    </div>
  );
}
