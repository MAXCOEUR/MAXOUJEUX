/**
 * Type de la socket, isolé pour casser le cycle d'imports.
 *
 * `socket.ts` importe les modules de gestionnaires (`game.ts`, `tables.ts`) pour
 * les enregistrer ; ceux-ci ont besoin du type de la socket. Le placer ici
 * garde la dépendance à sens unique.
 */

import type { ClientToServerEvents, ServerToClientEvents } from "@maxoujeux/shared";
import type { Socket } from "socket.io-client";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
