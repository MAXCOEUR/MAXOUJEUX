import { cn } from "@/lib/cn";

/**
 * Le nom se lit comme une plaque gravée : « Maxou » en laiton, « Jeux » en
 * crème. Pas de dégradé arc-en-ciel — le laiton est déjà la couleur de marque.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("font-display font-extrabold tracking-tight", className)}>
      <span className="text-brass">Maxou</span>
      <span className="text-cream">Jeux</span>
    </span>
  );
}
