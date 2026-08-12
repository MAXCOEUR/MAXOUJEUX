import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";
import { env, isProduction } from "../env.js";
import { SESSION_COOKIE, resolveSession } from "../modules/auth/session.js";
import {
  attach,
  activeViewFor,
  detach,
  setTableLogger,
  setTableNotifier,
  updateTableIdentity,
} from "../modules/tables/manager.js";
import { updateBlackjackIdentity } from "../modules/blackjack/service.js";
import { updateRouletteIdentity } from "../modules/roulette/service.js";
import { setRealtimeLogger } from "./guard.js";
import { createMotusNotifier, registerMotusHandlers } from "./motus.js";
import { setDisconnectNotifier, setIdentityNotifier, setWalletNotifier } from "./notify.js";
import {
  addConnection,
  presenceSnapshot,
  removeConnection,
  renameConnection,
} from "./presence.js";
import { createTableNotifier, registerTableHandlers } from "./tables.js";
import { registerBlackjackHandlers } from "./blackjack.js";
import { registerRouletteHandlers } from "./roulette.js";
import { registerChatHandlers } from "./chat.js";
import { userRoom, type GameServer } from "./types.js";
import { setMotusNotifier, unwatch as unwatchMotus } from "../modules/motus/service.js";

export type { GameServer } from "./types.js";

/**
 * Monte Socket.IO sur le serveur HTTP de Fastify.
 *
 * L'identité est établie **au handshake**, à partir du même cookie de session
 * que l'API REST : le client n'envoie jamais son `userId`, il ne peut donc pas
 * en usurper un. Une socket non authentifiée est refusée avant d'entrer dans
 * la moindre room.
 */
export function attachRealtime(app: FastifyInstance): GameServer {
  const io: GameServer = new Server(app.server, {
    path: "/socket.io",
    // En production, front et API sortent de la même origine (le nginx du
    // conteneur `web`) : aucun en-tête CORS n'est nécessaire, on n'en configure
    // donc aucun. En développement, Vite tourne sur un port distinct.
    ...(isProduction ? {} : { cors: { origin: env.PUBLIC_ORIGIN, credentials: true } }),
    // Un NAS n'a pas de bande passante à gaspiller en trames de contrôle.
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.use(async (socket, next) => {
    try {
      const header = socket.handshake.headers.cookie;
      if (!header) return next(new Error("UNAUTHENTICATED"));

      const raw = fastifyCookie.parse(header)[SESSION_COOKIE];
      if (!raw) return next(new Error("UNAUTHENTICATED"));

      const unsigned = app.unsignCookie(raw);
      if (!unsigned.valid || !unsigned.value) return next(new Error("UNAUTHENTICATED"));

      const user = await resolveSession(unsigned.value);
      if (!user) return next(new Error("UNAUTHENTICATED"));

      socket.data.userId = user.id;
      socket.data.pseudo = user.pseudo;
      socket.data.avatarSeed = user.avatarSeed;
      return next();
    } catch (error) {
      app.log.error({ err: error }, "Échec du handshake Socket.IO");
      return next(new Error("HANDSHAKE_FAILED"));
    }
  });

  // Diffusion du solde vers toutes les sockets d'un même joueur. Enregistré ici
  // pour que le service de porte-monnaie n'ait pas à connaître Socket.IO.
  setWalletNotifier((userId, balance) => {
    io.to(userRoom(userId)).emit("wallet:update", { balance });
  });

  setDisconnectNotifier((userId) => {
    io.in(userRoom(userId)).disconnectSockets(true);
  });

  /**
   * Changement de pseudo ou d'avatar en cours de session.
   *
   * L'identité est résolue à la poignée de main puis recopiée un peu partout :
   * dans `socket.data`, dans le registre de présence, et dans chaque état de jeu
   * en mémoire. Sans cette reprise, un joueur renommé devrait recharger sa page.
   *
   * On parcourt `io.sockets.sockets` et non `fetchSockets()` : ce dernier rend
   * des `RemoteSocket` dont les écritures sur `.data` ne sont pas répercutées.
   * Le déploiement est mono-processus, l'itération locale est donc exhaustive.
   */
  setIdentityNotifier((userId, patch) => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.userId !== userId) continue;
      if (patch.pseudo) socket.data.pseudo = patch.pseudo;
      if (patch.avatarSeed) socket.data.avatarSeed = patch.avatarSeed;
    }

    // Le lobby est la vitrine du site : lui, on le rediffuse tout de suite.
    if (renameConnection(userId, patch)) {
      io.emit("presence:update", presenceSnapshot());
    }

    // Les états de jeu sont corrigés en place, sans diffusion forcée : la
    // prochaine action de la table emporte la correction.
    updateTableIdentity(userId, patch);
    updateBlackjackIdentity(userId, patch);
    updateRouletteIdentity(userId, patch);
  });

  // Même principe pour les tables. Les deux journaliseurs sont injectés parce
  // que ni le gestionnaire ni le garde-fou ne doivent dépendre de Fastify.
  setTableNotifier(createTableNotifier(io));
  setMotusNotifier(createMotusNotifier(io));
  setTableLogger((error, message) => app.log.error({ err: error }, message));
  setRealtimeLogger((error, message) => app.log.error({ err: error }, message));

  io.on("connection", (socket) => {
    const player = {
      userId: socket.data.userId,
      pseudo: socket.data.pseudo,
      avatarSeed: socket.data.avatarSeed,
    };

    // Room par compte : permet d'adresser un joueur sur tous ses appareils.
    // C'est aussi par elle que passe l'état des parties.
    void socket.join(userRoom(player.userId));

    // On enregistre d'abord, pour que l'arrivant se voie lui-même dans la liste.
    // Les autres ne sont notifiés que si la liste change réellement : un
    // deuxième onglet du même joueur ne génère aucun bruit réseau.
    const isNewcomer = addConnection(player);
    socket.emit("presence:update", presenceSnapshot());
    if (isNewcomer) {
      socket.broadcast.emit("presence:update", presenceSnapshot());
    }

    socket.on("presence:sync", () => {
      socket.emit("presence:update", presenceSnapshot());
    });

    registerTableHandlers(socket);
    registerBlackjackHandlers(socket);
    registerRouletteHandlers(socket);
    registerMotusHandlers(socket);
    registerChatHandlers(io, socket);

    /**
     * Rattachement à la partie en cours.
     *
     * Une reconnexion Socket.IO fournit un nouvel identifiant de socket, donc
     * plus aucune room : sans ce rattachement, un joueur qui recharge sa page en
     * pleine partie ne recevrait plus rien et perdrait sa mise au bout du
     * sursis. C'est aussi ce qui annule le sursis déjà armé.
     */
    const resumed = attach(player.userId);
    if (resumed) {
      const view = activeViewFor(resumed, player.userId);
      if (view?.game === "blackjack") socket.emit("blackjack:state", view);
      else if (view?.game === "roulette") socket.emit("roulette:state", view);
      else if (view) socket.emit("match:state", view);
    }

    socket.on("disconnect", () => {
      // L'ordre importe : le sursis d'abandon est armé sur la perte de la
      // dernière socket, il faut donc décompter avant de tester la présence.
      detach(player.userId);
      unwatchMotus(player.userId, socket.id);

      if (removeConnection(player.userId)) {
        io.emit("presence:update", presenceSnapshot());
      }
    });
  });

  return io;
}
