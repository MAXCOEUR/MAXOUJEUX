/**
 * Transport des tables et des parties.
 *
 * Ce fichier ne contient **aucune règle de jeu** : il valide la forme du
 * message, appelle le gestionnaire, et diffuse l'état. Les règles vivent dans
 * `packages/engines`, le cycle de vie dans `modules/tables/manager.ts`.
 *
 * Aucune room par table n'est créée : la room `user:<id>`, qui existe déjà pour
 * le porte-monnaie, adresse le joueur sur **tous** ses appareils. Une room par
 * table obligerait à la rejoindre et à la quitter à chaque reconnexion, pour le
 * même résultat.
 */

import {
  createTableSchema,
  playSchema,
  tableRefSchema,
  watchSchema,
  type ActiveMatchView,
  type SalonSnapshot,
} from "@maxoujeux/shared";
import type { TableNotifier } from "../modules/tables/manager.js";
import {
  createTable,
  activeViewFor,
  joinTable,
  leave,
  play,
  playersOf,
  salonSnapshot,
  tableOf,
} from "../modules/tables/manager.js";
import { gameCounts } from "./counts.js";
import { withAck } from "./guard.js";
import { lobbyRoom, userRoom, type GameServer, type GameSocket } from "./types.js";

/**
 * Pont gestionnaire → socket.
 *
 * Le gestionnaire n'importe pas Socket.IO : il appelle ce notifieur, exactement
 * comme le service de porte-monnaie passe par `notify.ts`.
 */
export function createTableNotifier(io: GameServer): TableNotifier {
  return {
    salon(game) {
      io.to(lobbyRoom(game)).emit("tables:update", salonSnapshot(game));
    },

    match(tableId) {
      // Un message par joueur : la vue est filtrée par destinataire. Les deux
      // jeux du lot 1 n'ont rien à cacher, mais la mécanique doit déjà être
      // celle du poker, sinon elle sera récrite sous pression au lot 4.
      for (const userId of playersOf(tableId)) {
        const view = activeViewFor(tableId, userId);
        if (!view) continue;
        if (view.game === "blackjack") io.to(userRoom(userId)).emit("blackjack:state", view);
        else io.to(userRoom(userId)).emit("match:state", view);
      }
    },

    counts() {
      io.emit("tables:counts", gameCounts());
    },
  };
}

/** Identité du joueur, résolue au handshake — jamais envoyée par le client. */
function identity(socket: GameSocket) {
  return {
    userId: socket.data.userId,
    pseudo: socket.data.pseudo,
    avatarSeed: socket.data.avatarSeed,
  };
}

export function registerTableHandlers(socket: GameSocket): void {
  const me = identity(socket);

  socket.on("tables:watch", (payload, ack) => {
    void withAck<SalonSnapshot>(socket, "tables:watch", ack, async () => {
      const { game } = watchSchema.parse(payload);
      await socket.join(lobbyRoom(game));
      // L'instantané initial voyage dans l'accusé de réception : le salon
      // s'affiche en un aller-retour, sans écran vide entre-temps.
      return salonSnapshot(game);
    });
  });

  socket.on("tables:unwatch", (payload) => {
    const parsed = watchSchema.safeParse(payload);
    if (!parsed.success) return;
    void socket.leave(lobbyRoom(parsed.data.game));
  });

  socket.on("tables:create", (payload, ack) => {
    void withAck<{ tableId: string }>(socket, "tables:create", ack, async () => {
      const input = createTableSchema.parse(payload);
      const tableId = await createTable(me, input.game, "stake" in input ? input.stake : undefined);
      return { tableId };
    });
  });

  socket.on("tables:join", (payload, ack) => {
    void withAck<{ tableId: string }>(socket, "tables:join", ack, async () => {
      const { tableId } = tableRefSchema.parse(payload);
      await joinTable(me, tableId);
      return { tableId };
    });
  });

  socket.on("match:play", (payload, ack) => {
    void withAck<null>(socket, "match:play", ack, async () => {
      const parsed = playSchema.parse(payload);
      await play(me.userId, parsed.tableId, parsed.move, parsed.version);
      return null;
    });
  });

  socket.on("match:leave", (payload, ack) => {
    void withAck<null>(socket, "match:leave", ack, async () => {
      const { tableId } = tableRefSchema.parse(payload);
      await leave(me.userId, tableId);
      return null;
    });
  });

  socket.on("match:sync", (ack) => {
    void withAck<ActiveMatchView | null>(socket, "match:sync", ack, async () => {
      const tableId = tableOf(me.userId);
      return tableId ? activeViewFor(tableId, me.userId) : null;
    });
  });

  // Les comptages du lobby sont utiles dès l'arrivée : les cartes des jeux
  // affichent « 2 tables ouvertes » sans attendre le premier changement.
  socket.emit("tables:counts", gameCounts());
}
