import { cn } from "@/lib/cn";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-xl font-bold tracking-tight", className)}>
      <span className="bg-linear-to-r from-accent-violet to-accent-cyan bg-clip-text text-transparent">
        Maxou
      </span>
      <span className="text-ink">Jeux</span>
    </span>
  );
}
