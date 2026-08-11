import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@maxoujeux/shared";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";
import { env, isProduction } from "../env.js";
import { SESSION_COOKIE, resolveSession } from "../modules/auth/session.js";
import { setWalletNotifier } from "./notify.js";
import { addConnection, presenceSnapshot, removeConnection } from "./presence.js";

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

/** Nom de la room privée d'un compte, partagée par tous ses appareils. */
function userRoom(userId: string): string {
  return `user:${userId}`;
}

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

  io.on("connection", (socket) => {
    const player = {
      userId: socket.data.userId,
      pseudo: socket.data.pseudo,
      avatarSeed: socket.data.avatarSeed,
    };

    // Room par compte : permet d'adresser un joueur sur tous ses appareils.
    // Servira aussi aux invitations et aux notifications de tour au lot 1.
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

    socket.on("disconnect", () => {
      if (removeConnection(player.userId)) {
        io.emit("presence:update", presenceSnapshot());
      }
    });
  });

  return io;
}
