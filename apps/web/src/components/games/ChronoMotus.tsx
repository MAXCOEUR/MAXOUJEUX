import { formatChrono, type MotusView } from "@maxoujeux/shared";
import { Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { msSinceServer } from "@/lib/clock";

/**
 * Le temps passé sur la grille en cours.
 *
 * L'origine vient du **serveur** (`startedAt`) : l'horloge du navigateur ne fait
 * qu'afficher l'écart. Un téléphone réglé de travers verrait sinon un chrono
 * absurde, alors que c'est bien la mesure serveur qui départage les ex æquo au
 * classement du jour.
 *
 * Une seconde de granularité suffit : le classement Motus se joue d'abord au
 * nombre d'essais, le chrono n'est qu'un départage.
 */
export function ChronoMotus({ view }: { view: MotusView }) {
  const enCours = view.status === "playing";
  const [ecoule, setEcoule] = useState(() => msSinceServer(view.startedAt));

  useEffect(() => {
    if (!enCours || !view.startedAt) return;
    setEcoule(msSinceServer(view.startedAt));
    const timer = setInterval(() => setEcoule(msSinceServer(view.startedAt)), 1_000);
    return () => clearInterval(timer);
  }, [enCours, view.startedAt]);

  // Une fois la grille terminée, c'est la durée arrêtée par le serveur qui est
  // affichée : continuer à compter donnerait un temps qui n'est pas celui qui a
  // été enregistré.
  const valeur = enCours ? ecoule : view.durationMs;
  if (valeur === null || view.startedAt === null) return null;

  return (
    <div className="panel-plat flex items-center gap-3 p-4">
      <Timer className="size-4 shrink-0 text-cream-faint" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-cream-faint">
          {enCours ? "Temps écoulé" : "Temps final"}
        </p>
        {/* `tabular` évite que la ligne tremble à chaque seconde. */}
        <p className="tabular text-lg font-bold text-cream">{formatChrono(valeur)}</p>
      </div>
    </div>
  );
}
