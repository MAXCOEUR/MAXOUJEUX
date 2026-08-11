import { COIN_NAME, formatCoins, type CurrentUser } from "@maxoujeux/shared";
import { Coins, LogOut } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { ConnectionBadge } from "./ConnectionBadge";
import { Logo } from "./Logo";
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
      <header className="sticky top-0 z-20 border-b border-line bg-night/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4">
          <Logo />
          <ConnectionBadge className="hidden sm:flex" />

          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => setWalletOpen(true)}
              aria-label={`Ouvrir mon porte-monnaie ${COIN_NAME}`}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2/70 px-3 py-1.5 transition-colors hover:border-gold/50 hover:bg-surface-3"
            >
              <Coins className="size-4 text-gold" aria-hidden />
              <span className="font-display text-sm font-semibold tabular-nums text-ink">
                {formatCoins(user.balance)}
              </span>
            </button>

            <Avatar seed={user.avatarSeed} pseudo={user.pseudo} />
            <span className="hidden text-sm font-medium text-ink md:inline">{user.pseudo}</span>

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

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t border-line px-4 py-6 text-center text-xs text-ink-faint">
        MaxouJeux — {COIN_NAME} sans valeur monétaire, ni achat ni conversion possible.
      </footer>

      <WalletPanel open={walletOpen} onClose={() => setWalletOpen(false)} />
    </div>
  );
}
