import { useEffect, useState } from "react";

/**
 * Compte à rebours vers un instant donné.
 *
 * Purement décoratif : c'est le serveur qui décide si un bonus est encaissable.
 * Une horloge locale décalée fera afficher un mauvais délai, jamais gagner un
 * MaxouCoin en avance.
 */
export function useCountdown(target: string | undefined): number {
  const [remaining, setRemaining] = useState(() => msUntil(target));

  useEffect(() => {
    if (!target) return;

    setRemaining(msUntil(target));
    const timer = setInterval(() => setRemaining(msUntil(target)), 1000);
    return () => clearInterval(timer);
  }, [target]);

  return remaining;
}

function msUntil(target: string | undefined): number {
  if (!target) return 0;
  return Math.max(0, new Date(target).getTime() - Date.now());
}

/** `3 h 12 min`, `12 min 40 s`, `40 s`. On n'affiche jamais trois unités. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}
