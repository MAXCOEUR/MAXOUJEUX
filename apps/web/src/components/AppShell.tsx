import { COIN_NAME, formatCoins, type CurrentUser } from "@maxoujeux/shared";
import { LogOut, Shield } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { ConnectionBadge } from "./ConnectionBadge";
import { Lien } from "./Lien";
import { Logo } from "./Logo";
import { ResumeBanner } from "./ResumeBanner";
import { Toaster } from "./Toaster";
import { WalletPanel } from "./WalletPanel";
import { useLogout } from "@/lib/session";

interface AppShellProps {
  user: CurrentUser;
  children: ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const logout = useLogout();
  const [walletOpen, setWalletOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-felt-deep/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Lien to={{ name: "lobby" }} aria-label="Retour au lobby">
            <Logo className="text-xl" />
          </Lien>
          <ConnectionBadge className="hidden sm:flex" />

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {user.isAdmin && (
              <Lien
                to={{ name: "admin" }}
                aria-label="Administration"
                className="inline-flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-cream-dim transition-colors hover:bg-felt-raised hover:text-cream"
              >
                <Shield className="size-4" aria-hidden />
                <span className="hidden lg:inline">Administration</span>
              </Lien>
            )}
            {/* Le solde est un bouton : c'est le point d'entrée du porte-monnaie,
                et l'endroit où l'œil va naturellement chercher son argent. */}
            <button
              type="button"
              onClick={() => setWalletOpen(true)}
              aria-label={`Ouvrir mon porte-monnaie ${COIN_NAME}`}
              className="group flex items-center gap-2 rounded-full border border-brass/30 bg-brass/10 px-3 py-1.5 transition-colors hover:border-brass/70 hover:bg-brass/15"
            >
              {/* Jeton dessiné plutôt qu'icône générique : deux cercles suffisent. */}
              <span
                aria-hidden
                className="grid size-4 place-items-center rounded-full bg-brass"
              >
                <span className="size-1.5 rounded-full bg-brass-deep" />
              </span>
              <span className="tabular text-sm font-semibold text-brass-bright">
                {formatCoins(user.balance)}
              </span>
            </button>

            <span className="hidden items-center gap-2 md:flex">
              <Avatar seed={user.avatarSeed} pseudo={user.pseudo} className="size-8" />
              <span className="text-sm font-medium text-cream">{user.pseudo}</span>
            </span>
            <Avatar
              seed={user.avatarSeed}
              pseudo={user.pseudo}
              className="size-8 md:hidden"
            />

            <Button
              variant="ghost"
              onClick={() => logout.mutate()}
              loading={logout.isPending}
              aria-label="Se déconnecter"
              className="px-2.5"
            >
              <LogOut className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      <ResumeBanner />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">{children}</main>

      <footer className="border-t border-line px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center text-xs text-cream-faint">
        MaxouJeux — les {COIN_NAME} sont des jetons de jeu, sans valeur monétaire.
      </footer>

      <WalletPanel open={walletOpen} onClose={() => setWalletOpen(false)} />
      <Toaster />
    </div>
  );
}
