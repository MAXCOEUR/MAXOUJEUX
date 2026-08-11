import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AuthPage } from "@/pages/AuthPage";
import { LobbyPage } from "@/pages/LobbyPage";
import { useSession } from "@/lib/session";
import { useRealtimeConnection } from "@/lib/socket";

export function App() {
  const session = useSession();

  // La socket suit l'état d'authentification : ouverte à la connexion,
  // fermée à la déconnexion, sans intervention des pages.
  useRealtimeConnection(session.data != null);

  // `undefined` = session pas encore vérifiée. Sans ce cas distinct du `null`,
  // on afficherait brièvement l'écran de connexion à un joueur déjà connecté.
  if (session.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-ink-faint" aria-label="Chargement" />
      </div>
    );
  }

  if (session.isError) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <div className="card-surface max-w-sm p-6 text-center">
          <p className="text-sm text-ink">Impossible de joindre le serveur.</p>
          <p className="mt-1 text-xs text-ink-faint">
            Vérifie que l'API tourne, puis recharge la page.
          </p>
        </div>
      </div>
    );
  }

  if (!session.data) {
    return <AuthPage />;
  }

  return (
    <AppShell user={session.data}>
      <LobbyPage />
    </AppShell>
  );
}
