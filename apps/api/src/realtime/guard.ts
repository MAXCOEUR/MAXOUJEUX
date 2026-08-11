/**
 * Traitement uniforme des erreurs dans les gestionnaires Socket.IO.
 *
 * Fastify a `registerErrorHandler` ; Socket.IO n'a **rien** d'équivalent. Une
 * `AppError` levée dans un gestionnaire d'événement remonterait dans la
 * bibliothèque et se perdrait, laissant le joueur devant un bouton qui ne
 * répond pas. Ce module est le pendant temps réel : même hiérarchie de
 * traitement, même distinction entre cas métier et bug.
 */

import { IllegalMove, type IllegalMoveCode } from "@maxoujeux/engines";
import type { ActionReply } from "@maxoujeux/shared";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import type { GameSocket } from "./types.js";

type Ack<T> = (reply: ActionReply<T>) => void;

/** Journalisation injectée depuis Fastify, pour ne pas importer l'application ici. */
type Logger = (error: unknown, message: string) => void;

let logError: Logger = (error, message) => {
  console.error(message, error);
};

export function setRealtimeLogger(next: Logger): void {
  logError = next;
}

/**
 * Un client peut très bien ne pas envoyer d'accusé de réception : rien ne
 * l'y oblige côté protocole. On vérifie avant d'appeler.
 */
function isAck<T>(value: unknown): value is Ack<T> {
  return typeof value === "function";
}

/** Messages des coups refusés par un moteur, en français. */
const ILLEGAL_MOVE_MESSAGES: Record<IllegalMoveCode, string> = {
  NOT_YOUR_TURN: "Ce n'est pas ton tour.",
  OUT_OF_BOUNDS: "Ce coup n'est pas jouable.",
  COLUMN_FULL: "Cette colonne est pleine.",
  CELL_TAKEN: "Cette case est déjà prise.",
  GAME_OVER: "La partie est terminée.",
};

function toFailure(error: unknown, label: string): { code: string; message: string } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }

  // Coup refusé par les règles : cas métier, pas bug. Le moteur ne connaît pas
  // AppError, c'est ici qu'on traduit.
  if (error instanceof IllegalMove) {
    return { code: error.code, message: ILLEGAL_MOVE_MESSAGES[error.code] };
  }

  if (error instanceof ZodError) {
    return { code: "VALIDATION_ERROR", message: "Requête invalide." };
  }

  // Tout le reste est un bug : on journalise entièrement et on ne renvoie rien
  // d'exploitable au client.
  logError(error, `Erreur inattendue sur « ${label} »`);
  return { code: "INTERNAL_ERROR", message: "Une erreur est survenue. Réessaie." };
}

/**
 * Exécute une intention et répond au client.
 *
 * L'accusé de réception est privilégié sur `error:app` : le front doit savoir
 * *quelle* action a échoué pour afficher le message sous le bouton concerné.
 * `error:app` ne sert que de repli quand le client n'attend pas de réponse.
 */
export async function withAck<T>(
  socket: GameSocket,
  label: string,
  ack: unknown,
  work: () => Promise<T>,
): Promise<void> {
  try {
    const data = await work();
    if (isAck<T>(ack)) ack({ ok: true, data });
  } catch (error) {
    const failure = toFailure(error, label);
    if (isAck<T>(ack)) ack({ ok: false, ...failure });
    else socket.emit("error:app", failure);
  }
}
