import { cn } from "@/lib/cn";
import { useRealtime } from "@/lib/socket";

const LABELS = {
  idle: { text: "Hors ligne", dot: "bg-cream-faint" },
  connecting: { text: "Connexion…", dot: "bg-brass animate-pulse-soft" },
  connected: { text: "En ligne", dot: "bg-win" },
  disconnected: { text: "Reconnexion…", dot: "bg-danger animate-pulse-soft" },
} as const;

/**
 * État de la liaison temps réel, visible en permanence.
 * Sur une table de poker, savoir qu'on est déconnecté avant de perdre son tour
 * change tout — d'où l'affichage constant plutôt qu'une alerte ponctuelle.
 */
export function ConnectionBadge({ className }: { className?: string }) {
  const status = useRealtime((state) => state.status);
  const online = useRealtime((state) => state.presence.online);
  const label = LABELS[status];

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border border-line bg-felt-deep/50 px-2.5 py-1",
        className,
      )}
      role="status"
    >
      <span className={cn("size-1.5 rounded-full", label.dot)} aria-hidden />
      <span className="text-xs text-cream-dim">
        {status === "connected" ? (
          <>
            <span className="tabular">{online}</span> à table
          </>
        ) : (
          label.text
        )}
      </span>
    </div>
  );
}
