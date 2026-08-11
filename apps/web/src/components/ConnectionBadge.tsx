import { cn } from "@/lib/cn";
import { useRealtime } from "@/lib/socket";

const LABELS = {
  idle: { text: "Hors ligne", dot: "bg-ink-faint" },
  connecting: { text: "Connexion…", dot: "bg-accent-amber animate-pulse-soft" },
  connected: { text: "En ligne", dot: "bg-success" },
  disconnected: { text: "Reconnexion…", dot: "bg-danger animate-pulse-soft" },
} as const;

/**
 * État de la liaison temps réel, visible en permanence.
 * Sur une table de poker, savoir qu'on est déconnecté avant de perdre son tour
 * change tout — d'où l'affichage permanent plutôt qu'une alerte ponctuelle.
 */
export function ConnectionBadge({ className }: { className?: string }) {
  const status = useRealtime((state) => state.status);
  const online = useRealtime((state) => state.presence.online);
  const label = LABELS[status];

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border border-line bg-surface-2/60 px-3 py-1",
        className,
      )}
      role="status"
    >
      <span className={cn("size-2 rounded-full", label.dot)} aria-hidden />
      <span className="text-xs text-ink-muted">
        {status === "connected" ? `${online} en ligne` : label.text}
      </span>
    </div>
  );
}
