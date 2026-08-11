import type { CurrentUser } from "@maxoujeux/shared";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AuthPage } from "@/pages/AuthPage";
import { LobbyPage } from "@/pages/LobbyPage";
import { MotusPage } from "@/pages/MotusPage";
import { SalonPage } from "@/pages/SalonPage";
import { TablePage } from "@/pages/TablePage";
import { useRoute, type Route } from "@/lib/route";
import { useSession } from "@/lib/session";
import { useRealtimeConnection } from "@/lib/socket";

export function App() {
  const session = useSession();
  const route = useRoute();

  // La socket suit l'état d'authentification : ouverte à la connexion,
  // fermée à la déconnexion, sans intervention des pages.
  useRealtimeConnection(session.data != null);

  // `undefined` = session pas encore vérifiée. Sans ce cas distinct du `null`,
  // on afficherait brièvement l'écran de connexion à un joueur déjà connecté.
  if (session.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-cream-faint" aria-label="Chargement" />
      </div>
    );
  }

  if (session.isError) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <div className="panel max-w-sm p-6 text-center">
          <p className="text-sm text-cream">Impossible de joindre le serveur.</p>
          <p className="mt-1 text-xs text-cream-faint">
            Vérifie que l'API tourne, puis recharge la page.
          </p>
        </div>
      </div>
    );
  }

  // Le portier de session passe avant le routeur : sans compte, aucune adresse
  // ne mène ailleurs qu'à l'écran de connexion. L'adresse est conservée, le
  // joueur retombe donc sur la page visée après s'être identifié.
  if (!session.data) {
    return <AuthPage />;
  }

  return (
    <AppShell user={session.data}>
      <Screen route={route} user={session.data} />
    </AppShell>
  );
}

function Screen({ route, user }: { route: Route; user: CurrentUser }) {
  switch (route.name) {
    case "salon":
      return route.game === "motus"
        ? <MotusPage user={user} />
        : <SalonPage user={user} game={route.game} />;
    case "table":
      return <TablePage user={user} tableId={route.tableId} />;
    case "lobby":
      return <LobbyPage user={user} />;
  }
}
