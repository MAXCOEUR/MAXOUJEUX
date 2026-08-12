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
import { TableScene } from "@/components/TableScene";
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
    <div className="grid min-h-dvh lg:h-dvh lg:grid-cols-[1.15fr_1fr] lg:overflow-hidden">
      {/* --- Panneau de gauche : la table --------------------------------- */}
      {/* Masqué sous lg : sur un téléphone, la table volerait la place du
          formulaire, qui est la seule chose à faire sur cet écran. */}
      <aside className="relative hidden min-h-0 overflow-hidden border-r border-line lg:flex lg:flex-col lg:justify-between lg:p-8 xl:p-12">
        <Logo className="relative text-2xl" />

        <div className="relative -my-4 min-h-0 flex-1 xl:-my-8">
          <TableScene />
        </div>

        <div className="relative max-w-md">
          <h1 className="font-display text-3xl leading-[1.05] font-extrabold text-cream xl:text-4xl">
            La salle de jeux
            <br />
            <span className="text-brass">de la maison.</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-cream-dim">
            Poker, blackjack, Motus, Puissance&nbsp;4 et morpion. Entre vous, à vos horaires,
            sur un serveur qui vous appartient.
          </p>
        </div>
      </aside>

      {/* --- Panneau de droite : le formulaire ---------------------------- */}
      <main className="flex items-center justify-center px-5 py-8 sm:px-10 xl:py-12">
        <div className="w-full max-w-sm animate-rise">
          {/* Sur mobile, le logo revient ici : sans lui, la page démarre sur
              un champ email sans dire de quel site il s'agit. */}
          <div className="mb-8 lg:hidden">
            <Logo className="text-3xl" />
            <p className="mt-2 text-sm text-cream-dim">
              Poker, blackjack, Motus et Puissance 4 entre amis.
            </p>
          </div>

          <h2 className="font-display text-2xl font-bold text-cream">
            {mode === "login" ? "Reprends ta place" : "Prends une place"}
          </h2>
          <p className="mt-1 mb-6 text-sm text-cream-dim">
            {mode === "login"
              ? "Ton tapis t'attend là où tu l'as laissé."
              : `${formatCoins(SIGNUP_BONUS)} sur la table pour commencer.`}
          </p>

          <div
            role="tablist"
            aria-label="Mode d'accès"
            className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-line bg-felt-deep/60 p-1"
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
                    ? "bg-felt-high text-cream shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
                    : "text-cream-faint hover:text-cream",
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
              autoComplete={mode === "login" ? "username" : "email"}
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
                hint="C'est le nom que verront les autres joueurs."
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
              <p
                role="alert"
                className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                {globalError}
              </p>
            )}

            <Button type="submit" loading={pending} className="w-full">
              {mode === "login" ? "Se connecter" : "Créer mon compte"}
            </Button>
          </form>

          <p className="mt-8 border-t border-line pt-5 text-xs leading-relaxed text-cream-faint">
            Les MaxouCoin sont des jetons de jeu. Ils ne s'achètent pas, ne se convertissent pas
            et ne se transfèrent pas entre comptes.
          </p>
        </div>
      </main>
    </div>
  );
}
