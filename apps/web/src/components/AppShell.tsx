import { COIN_NAME, formatCoins, type CurrentUser } from "@maxoujeux/shared";
import { LogOut, MessageCircle, Shield } from "lucide-react";
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
import { useChat } from "@/lib/chat";
import { ChatPanel, formatUnreadBadge } from "./ChatPanel";

interface AppShellProps {
  user: CurrentUser;
  children: ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const logout = useLogout();
  const [walletOpen, setWalletOpen] = useState(false);
  const chatOpen = useChat((state) => state.isOpen);
  const unread = useChat((state) => state.unread);
  const openChat = useChat((state) => state.open);
  const closeChat = useChat((state) => state.close);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-felt-deep/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
          {/* `min-w-0` sur le logo et `shrink-0` sur les actions : c'est le titre
              qui doit céder de la place, pas le solde ni l'avatar. */}
          <Lien
            to={{ name: "lobby" }}
            aria-label="Retour au lobby"
            className="flex min-w-0 items-center py-2"
          >
            <Logo className="truncate text-lg sm:text-xl" />
          </Lien>
          <ConnectionBadge className="hidden sm:flex" />

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
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
            <button
              type="button"
              onClick={openChat}
              aria-label={unread > 0 ? `Ouvrir le chat, ${Math.min(unread, 999)} message${unread > 1 ? "s" : ""} non lu${unread > 1 ? "s" : ""}` : "Ouvrir le chat"}
              className="relative inline-flex shrink-0 items-center justify-center rounded-xl p-2 text-cream-dim transition-colors hover:bg-felt-raised hover:text-cream sm:p-2.5"
            >
              <MessageCircle className="size-4" aria-hidden />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-4 text-white">
                  {formatUnreadBadge(unread)}
                </span>
              )}
            </button>
            {/* Le solde est un bouton : c'est le point d'entrée du porte-monnaie,
                et l'endroit où l'œil va naturellement chercher son argent. */}
            <button
              type="button"
              onClick={() => setWalletOpen(true)}
              aria-label={`Ouvrir mon porte-monnaie ${COIN_NAME}`}
              className="group flex shrink-0 items-center gap-1.5 rounded-full border border-brass/30 bg-brass/10 px-2.5 py-2 transition-colors hover:border-brass/70 hover:bg-brass/15 sm:gap-2 sm:px-3"
            >
              {/* Jeton dessiné plutôt qu'icône générique : deux cercles suffisent. */}
              <span
                aria-hidden
                className="grid size-4 place-items-center rounded-full bg-brass"
              >
                <span className="size-1.5 rounded-full bg-brass-deep" />
              </span>
              <span className="tabular text-sm font-semibold text-brass-bright">
                {/* Le symbole « MC » saute sur téléphone : le jeton doré à côté
                    dit déjà de quelle monnaie il s'agit. */}
                <span className="sm:hidden">{formatCoins(user.balance).replace(/\s*MC$/, "")}</span>
                <span className="hidden sm:inline">{formatCoins(user.balance)}</span>
              </span>
            </button>

            {/* Le bloc identité est le point d'entrée de l'espace personnel :
                c'est là que l'œil cherche son propre compte. */}
            <Lien
              to={{ name: "compte" }}
              aria-label="Mon compte"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl px-1 py-2 transition-colors hover:bg-felt-raised sm:px-2"
            >
              <Avatar
                userId={user.id}
                seed={user.avatarSeed}
                pseudo={user.pseudo}
                className="size-8"
              />
              <span className="hidden text-sm font-medium text-cream md:inline">{user.pseudo}</span>
            </Lien>

            <Button
              variant="ghost"
              onClick={() => logout.mutate()}
              loading={logout.isPending}
              aria-label="Se déconnecter"
              className="shrink-0 px-2 sm:px-2.5"
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
      <ChatPanel open={chatOpen} onClose={closeChat} meId={user.id} />
      <Toaster />
    </div>
  );
}
