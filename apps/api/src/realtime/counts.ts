import { getGame, type GameCode, type TableCounts } from "@maxoujeux/shared";
import { activeCount } from "../modules/motus/service.js";
import { tableCounts } from "../modules/tables/manager.js";

/**
 * Comptages de tous les jeux actifs, quel que soit leur modèle de cycle de vie.
 *
 * Motus n'a pas de table, mais sa capacité doit apparaître dans le même contrat
 * de lobby. Centraliser la fusion évite qu'une notification de duel efface son
 * compteur, ou l'inverse.
 */
export function gameCounts(): Partial<Record<GameCode, TableCounts>> {
  const motus = getGame("motus");
  return {
    ...tableCounts(),
    motus: {
      waiting: 0,
      playing: activeCount(),
      max: motus?.maxTables ?? 10,
    },
  };
}
