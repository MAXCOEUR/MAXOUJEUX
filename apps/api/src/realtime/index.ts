import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";
import { env, isProduction } from "../env.js";
import {
  SESSION_COOKIE,
  resolveSession,
  resolveSessionById,
} from "../modules/auth/session.js";
import { hashDeviceFingerprint, normalizeIp } from "../lib/access-context.js";
import { assertAccessAllowed } from "../modules/moderation/service.js";
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
import { setPlinkoNotifier, updatePlinkoIdentity, viewPlinko } from "../modules/plinko/service.js";
import { setSlotsNotifier, updateSlotsIdentity, viewSlots } from "../modules/slots/service.js";
import { setPokerNotifier, updatePokerIdentity, viewPoker } from "../modules/poker/service.js";
import { leaveWheelRoom, setWheelNotifier, updateWheelIdentity } from "../modules/wheel/service.js";
import { setRealtimeLogger } from "./guard.js";
import { createMotusNotifier, registerMotusHandlers } from "./motus.js";
import {
  setAchievementNotifier,
  setAccessDisconnectNotifier,
  setDisconnectNotifier,
  setIdentityNotifier,
  setSessionDisconnectNotifier,
  setWalletNotifier,
} from "./notify.js";
import {
  addConnection,
  presenceSnapshot,
  removeConnection,
  renameConnection,
} from "./presence.js";
import { createTableNotifier, registerTableHandlers } from "./tables.js";
import { registerBlackjackHandlers } from "./blackjack.js";
import { registerRouletteHandlers } from "./roulette.js";
import { createPlinkoNotifier, registerPlinkoHandlers } from "./plinko.js";
import { createWheelNotifier, registerWheelHandlers } from "./wheel.js";
import { createSlotsNotifier, registerSlotsHandlers } from "./slots.js";
import { createPokerNotifier, registerPokerHandlers } from "./poker.js";
import { registerChatHandlers } from "./chat.js";
import { sessionRoom, userRoom, type GameServer } from "./types.js";
import { setMotusNotifier, unwatch as unwatchMotus } from "../modules/motus/service.js";
import { ConnectionRegistry, REALTIME_LIMITS, RealtimeRateLimiter } from "./limits.js";
import { isAllowedSocketOrigin, socketClientIp } from "./origin.js";
import { AppError } from "../lib/errors.js";

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
  const publicOrigin = new URL(env.PUBLIC_ORIGIN).origin;
  const connections = new ConnectionRegistry(
    REALTIME_LIMITS.socketsPerAccount,
    REALTIME_LIMITS.socketsPerIp,
  );
  const events = new RealtimeRateLimiter(
    REALTIME_LIMITS.eventsPerAccount,
    REALTIME_LIMITS.eventsPerIp,
    REALTIME_LIMITS.eventWindowMs,
  );
  const io: GameServer = new Server(app.server, {
    path: "/socket.io",
    cors: { origin: publicOrigin, credentials: true },
    maxHttpBufferSize: REALTIME_LIMITS.maxMessageBytes,
    // Un NAS n'a pas de bande passante à gaspiller en trames de contrôle.
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.use(async (socket, next) => {
    let counted = false;
    const refuse = (code: string, details: Record<string, string> = {}) => {
      app.log.warn({ code, ...details }, "Handshake Socket.IO refusé");
      return next(new Error(code));
    };
    try {
      if (!isAllowedSocketOrigin(socket.handshake.headers.origin, publicOrigin)) {
        return refuse("SOCKET_ORIGIN_FORBIDDEN");
      }
      const header = socket.handshake.headers.cookie;
      if (!header) return refuse("UNAUTHENTICATED");

      const raw = fastifyCookie.parse(header)[SESSION_COOKIE];
      if (!raw) return refuse("UNAUTHENTICATED");

      const unsigned = app.unsignCookie(raw);
      if (!unsigned.valid || !unsigned.value) return refuse("UNAUTHENTICATED");

      const user = await resolveSession(unsigned.value);
      if (!user) return refuse("UNAUTHENTICATED");

      const rawFingerprint = socket.handshake.auth.deviceFingerprint;
      const deviceHash = hashDeviceFingerprint(
        typeof rawFingerprint === "string" ? rawFingerprint : undefined,
      );
      const ip = normalizeIp(
        socketClientIp(
          socket.handshake.headers["x-forwarded-for"],
          socket.handshake.address,
          isProduction ? 2 : 0,
        ),
      );
      await assertAccessAllowed({ userId: user.id, role: user.role, ip, deviceHash });

      const connectionLimit = connections.add(user.id, ip);
      if (connectionLimit) {
        return refuse("SOCKET_CONNECTION_LIMIT", { scope: connectionLimit });
      }
      counted = true;

      socket.data.sessionId = user.sessionId;
      socket.data.userId = user.id;
      socket.data.pseudo = user.pseudo;
      socket.data.avatarSeed = user.avatarSeed;
      socket.data.role = user.role;
      socket.data.ip = ip;
      socket.data.deviceHash = deviceHash;
      return next();
    } catch (error) {
      if (counted) connections.remove(socket.data.userId, socket.data.ip);
      const code = error instanceof AppError ? error.code : "HANDSHAKE_FAILED";
      app.log.warn({ code }, "Handshake Socket.IO refusé");
      return next(new Error(code));
    }
  });

  // Diffusion du solde vers toutes les sockets d'un même joueur. Enregistré ici
  // pour que le service de porte-monnaie n'ait pas à connaître Socket.IO.
  setWalletNotifier((userId, balance) => {
    io.to(userRoom(userId)).emit("wallet:update", { balance });
  });

  // Un succès peut tomber sur une table ouverte dans un autre onglet : c'est la
  // pièce du joueur qu'on prévient, pas la socket qui a joué le coup.
  setAchievementNotifier((userId, codes) => {
    io.to(userRoom(userId)).emit("achievements:unlocked", { codes });
  });

  setDisconnectNotifier((userId) => {
    io.in(userRoom(userId)).disconnectSockets(true);
  });

  setSessionDisconnectNotifier((sessionId) => {
    io.in(sessionRoom(sessionId)).disconnectSockets(true);
  });

  setAccessDisconnectNotifier((kind, value) => {
    for (const socket of io.sockets.sockets.values()) {
      const matches = kind === "ip" ? socket.data.ip === value : socket.data.deviceHash === value;
      if (matches && socket.data.role !== "admin") socket.disconnect(true);
    }
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
    updatePlinkoIdentity(userId, patch);
    updateWheelIdentity(userId, patch);
    updateSlotsIdentity(userId, patch);
    updatePokerIdentity(userId, patch);
  });

  // Même principe pour les tables. Les deux journaliseurs sont injectés parce
  // que ni le gestionnaire ni le garde-fou ne doivent dépendre de Fastify.
  setTableNotifier(createTableNotifier(io));
  setPlinkoNotifier(createPlinkoNotifier(io));
  setWheelNotifier(createWheelNotifier(io));
  setSlotsNotifier(createSlotsNotifier(io));
  setPokerNotifier(createPokerNotifier(io));
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
    void socket.join(sessionRoom(socket.data.sessionId));

    socket.use((packet, next) => {
      if (events.take(socket.data.userId, socket.data.ip)) return next();
      const failure = {
        ok: false as const,
        code: "SOCKET_RATE_LIMITED",
        message: "Trop d’actions ont été envoyées. Réessaie dans un instant.",
      };
      const ack = packet.at(-1);
      if (typeof ack === "function") ack(failure);
      else socket.emit("error:app", failure);
    });

    let revalidating = false;
    const revalidation = setInterval(() => {
      if (revalidating) return;
      revalidating = true;
      void resolveSessionById(socket.data.sessionId)
        .then((fresh) => {
          if (!fresh) return socket.disconnect(true);
          socket.data.role = fresh.role;
          socket.data.pseudo = fresh.pseudo;
          socket.data.avatarSeed = fresh.avatarSeed;
          return undefined;
        })
        .catch(() => socket.disconnect(true))
        .finally(() => {
          revalidating = false;
        });
    }, REALTIME_LIMITS.sessionRecheckMs);
    revalidation.unref();

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
    registerPlinkoHandlers(socket);
    registerWheelHandlers(socket);
    registerSlotsHandlers(socket);
    registerPokerHandlers(socket);
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
      else if (view?.game === "poker") socket.emit("poker:state", view);
      else if (view) socket.emit("match:state", view);
      else {
        // Le Plinko ne passe pas par `activeViewFor` : son état n'est pas une
        // partie au sens du gestionnaire, mais il faut quand même remettre le
        // joueur — ou le spectateur — devant sa planche après une reconnexion.
        const planche = viewPlinko(resumed, player.userId);
        if (planche) socket.emit("plinko:state", planche);
        const machine = viewSlots(resumed, player.userId);
        if (machine) socket.emit("slots:state", machine);
        const poker = viewPoker(resumed, player.userId);
        if (poker) socket.emit("poker:state", poker);
      }
    }

    socket.on("disconnect", () => {
      clearInterval(revalidation);
      connections.remove(socket.data.userId, socket.data.ip);
      events.prune();
      // L'ordre importe : le sursis d'abandon est armé sur la perte de la
      // dernière socket, il faut donc décompter avant de tester la présence.
      detach(player.userId);
      unwatchMotus(player.userId, socket.id);
      leaveWheelRoom(player.userId, socket.id);

      if (removeConnection(player.userId)) {
        io.emit("presence:update", presenceSnapshot());
      }
    });
  });

  return io;
}
