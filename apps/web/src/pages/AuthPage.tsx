import {
  formatCoins,
  loginSchema,
  PASSWORD_MIN,
  registerSchema,
  SIGNUP_BONUS,
} from "@maxoujeux/shared";
import { useState, type FormEvent } from "react";
import type { ZodError } from "zod";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Logo } from "@/components/Logo";
import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useLogin, useRegister } from "@/lib/session";

type Mode = "login" | "register";

/** Aplatit une erreur Zod en `{ champ: message }`, comme le fait l'API. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    errors[key] ??= issue.message;
  }
  return errors;
}

export function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);

  const login = useLogin();
  const register = useRegister();
  const pending = login.isPending || register.isPending;

  function switchMode(next: Mode) {
    setMode(next);
    setFieldErrors({});
    setGlobalError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setGlobalError(null);

    const raw = Object.fromEntries(new FormData(event.currentTarget));

    try {
      // Validation locale avec les mêmes schémas que l'API : l'utilisateur voit
      // ses erreurs de saisie sans aller-retour réseau. L'API revalide de toute
      // façon — un contrôle côté client n'est jamais une garantie.
      if (mode === "login") {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return setFieldErrors(toFieldErrors(parsed.error));
        await login.mutateAsync(parsed.data);
      } else {
        const parsed = registerSchema.safeParse(raw);
        if (!parsed.success) return setFieldErrors(toFieldErrors(parsed.error));
        await register.mutateAsync(parsed.data);
      }
      // Le succès met à jour le cache de session : le routeur bascule seul
      // vers le lobby, aucune navigation manuelle n'est nécessaire.
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFieldErrors(error.fields);
        if (Object.keys(error.fields).length === 0) setGlobalError(error.message);
        return;
      }
      setGlobalError("Une erreur inattendue est survenue.");
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md animate-rise">
        <div className="mb-8 text-center">
          <Logo className="text-3xl" />
          <p className="mt-2 text-sm text-ink-muted">
            Poker, Blackjack, Motus et Puissance 4 entre amis.
          </p>
        </div>

        <div className="card-surface p-6 sm:p-8">
          {/* Bascule connexion / inscription */}
          <div
            role="tablist"
            aria-label="Mode d'accès"
            className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-surface-2/60 p-1"
          >
            {(["login", "register"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => switchMode(value)}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  mode === value
                    ? "bg-surface-3 text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {value === "login" ? "Connexion" : "Créer un compte"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="toi@exemple.fr"
              required
              error={fieldErrors.email}
            />

            {mode === "register" && (
              <Field
                label="Pseudo"
                name="pseudo"
                type="text"
                autoComplete="nickname"
                placeholder="Maxou"
                required
                error={fieldErrors.pseudo}
                hint="Visible par les autres joueurs. Lettres, chiffres, tiret, underscore."
              />
            )}

            <Field
              label="Mot de passe"
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="••••••••••"
              required
              error={fieldErrors.password}
              hint={mode === "register" ? `${PASSWORD_MIN} caractères minimum.` : undefined}
            />

            {globalError && (
              <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                {globalError}
              </p>
            )}

            <Button type="submit" loading={pending} className="w-full">
              {mode === "login" ? "Se connecter" : "Créer mon compte"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-ink-faint">
          {formatCoins(SIGNUP_BONUS)} offerts à l'inscription. Aucun achat, aucune conversion en
          argent réel.
        </p>
      </div>
    </div>
  );
}
