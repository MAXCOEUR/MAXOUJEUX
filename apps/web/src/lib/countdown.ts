import { useEffect, useState } from "react";
import { msUntilServer } from "./clock.js";

// Les formateurs vivent dans `@maxoujeux/shared` (`formatDuration`,
// `formatClock`) : ce sont des fonctions pures, elles y sont couvertes par les
// tests du paquet sans imposer de harnais de test au front. Réexportés ici pour
// que les composants n'aient qu'un seul import à faire.
export { formatClock, formatDuration } from "@maxoujeux/shared";

/**
 * Compte à rebours vers un instant donné.
 *
 * Purement décoratif : c'est le serveur qui décide si un bonus est encaissable
 * ou si un tour est expiré. Une horloge locale décalée fera afficher un mauvais
 * délai, jamais gagner un MaxouCoin en avance — et `msUntilServer` corrige même
 * cet écart d'affichage.
 */
export function useCountdown(target: string | undefined | null): number {
  const [remaining, setRemaining] = useState(() => msUntilServer(target));

  useEffect(() => {
    if (!target) {
      setRemaining(0);
      return;
    }

    let timer: number;

    const tick = () => {
      const left = msUntilServer(target);
      setRemaining(left);
      if (left <= 0) return;

      /**
       * Réveil aligné sur la frontière de seconde, plutôt qu'un `setInterval`
       * de 1 000 ms.
       *
       * Tant qu'on n'affichait que les minutes, la dérive était invisible ;
       * avec les secondes à l'écran, un intervalle fixe finit par sauter une
       * valeur ou bégayer. Recalculer depuis l'horloge à chaque tour rattrape
       * aussi le bridage des minuteries d'onglet en arrière-plan.
       */
      timer = window.setTimeout(tick, left % 1_000 || 1_000);
    };

    tick();
    return () => window.clearTimeout(timer);
  }, [target]);

  return remaining;
}
