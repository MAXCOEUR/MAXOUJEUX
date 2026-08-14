import type { CurrentUser } from "@maxoujeux/shared";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AuthPage } from "@/pages/AuthPage";
import { AdminPage } from "@/pages/AdminPage";
import { ClassementPage } from "@/pages/ClassementPage";
import { ComptePage } from "@/pages/ComptePage";
import { LobbyPage } from "@/pages/LobbyPage";
import { MotusPage } from "@/pages/MotusPage";
import { ProfilPage } from "@/pages/ProfilPage";
import { SuccesPage } from "@/pages/SuccesPage";
import { WheelPage } from "@/pages/WheelPage";
import { SalonPage } from "@/pages/SalonPage";
import { TablePage } from "@/pages/TablePage";
import { navigate, useRoute, type Route } from "@/lib/route";
import { useSession } from "@/lib/session";
import { useRealtimeConnection } from "@/lib/socket";
import { useEffect } from "react";

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
  const forbiddenAdmin = route.name === "admin" && !user.isAdmin;

  // La redirection est un effet pour que le rendu reste pur. Le serveur garde
  // de toute façon le dernier mot sur les appels d'administration.
  useEffect(() => {
    if (forbiddenAdmin) navigate({ name: "lobby" }, { replace: true });
  }, [forbiddenAdmin]);

  if (forbiddenAdmin) return <LobbyPage user={user} />;

  switch (route.name) {
    case "admin":
      return <AdminPage />;
    case "compte":
      return <ComptePage user={user} />;
    case "classement":
      return <ClassementPage user={user} />;
    case "succes":
      return <SuccesPage />;
    case "profil":
      return <ProfilPage pseudo={route.pseudo} user={user} />;
    case "salon":
      // Motus et la roue n'ont pas de salon : l'un est solo, l'autre est une
      // salle unique où l'on entre directement.
      if (route.game === "motus") return <MotusPage user={user} />;
      if (route.game === "wheel") return <WheelPage user={user} />;
      return <SalonPage user={user} game={route.game} />;
    case "table":
      return <TablePage user={user} tableId={route.tableId} />;
    case "lobby":
      return <LobbyPage user={user} />;
  }
}
