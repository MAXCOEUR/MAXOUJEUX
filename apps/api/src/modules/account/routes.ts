import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME,
  deleteAccountSchema,
  parseAvatarSeed,
  updateEmailSchema,
  updatePasswordSchema,
  updatePseudoSchema,
} from "@maxoujeux/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEVICE_HEADER } from "../../lib/access-context.js";
import { currentUser, requireAuth, requireResourceAuth } from "../../lib/require-auth.js";
import { disconnectUser, notifyIdentity } from "../../realtime/notify.js";
import { toPublicUser } from "../auth/public-user.js";
import {
  clearSessionCookie,
  createSession,
  setSessionCookie,
} from "../auth/session.js";
import { decoderAvatar } from "./avatar.js";
import { deleteAvatar, readAvatar, writeAvatar } from "./avatar-service.js";
import {
  anonymiseAccount,
  changeEmail,
  changePassword,
  changePseudo,
} from "./service.js";

/** Un an. La graine tourne à chaque changement, donc rien ne peut rester périmé. */
const CACHE_IMMUABLE = "private, max-age=31536000, immutable";
/** Version absente ou dépassée : on sert quand même, mais on revalide à chaque fois. */
const CACHE_REVALIDER = "private, no-cache";

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  /**
   * Même plafond que la connexion : ces routes changent les identifiants du
   * compte, le plafond global de 300 requêtes par minute ne protégerait rien.
   */
  const guard = { rateLimit: { max: 10, timeWindow: "15 minutes" } };

  /**
   * Les octets de l'avatar arrivent bruts.
   *
   * Les passer en base64 dans du JSON gonflerait la charge d'un tiers pour rien.
   * Le plafond propre à ce type est plus serré que le `bodyLimit` global : une
   * image plus lourde est refusée par Fastify avant d'atteindre le gestionnaire.
   */
  app.addContentTypeParser(
    AVATAR_MIME,
    { parseAs: "buffer", bodyLimit: AVATAR_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.patch("/email", { config: guard }, async (request, reply) => {
    const input = updateEmailSchema.parse(request.body);
    const user = await changeEmail(currentUser(request).id, input);
    return reply.send({ user: toPublicUser(user) });
  });

  app.patch("/pseudo", { config: guard }, async (request, reply) => {
    const input = updatePseudoSchema.parse(request.body);
    const user = await changePseudo(currentUser(request).id, input);
    return reply.send({ user: toPublicUser(user) });
  });

  app.patch("/password", { config: guard }, async (request, reply) => {
    const { id } = currentUser(request);
    const input = updatePasswordSchema.parse(request.body);
    await changePassword(id, input);

    // Toutes les sessions viennent de tomber, y compris celle qui pose la
    // question. On en rouvre une pour ne pas éjecter l'appelant — ce qui fait
    // aussi tourner son jeton, bonne hygiène après un changement de secret.
    const token = await createSession(id, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      deviceFingerprint:
        typeof request.headers[DEVICE_HEADER] === "string"
          ? request.headers[DEVICE_HEADER]
          : undefined,
    });
    setSessionCookie(reply, token);

    // Coupure des sockets **après** l'envoi de la réponse : dans l'autre ordre,
    // le client Socket.IO retenterait sa poignée de main avec l'ancien cookie
    // et enchaînerait les échecs de reconnexion.
    reply.raw.on("finish", () => disconnectUser(id));
    return reply.status(204).send();
  });

  app.delete("/", { config: guard }, async (request, reply) => {
    deleteAccountSchema.parse(request.body);
    await anonymiseAccount(currentUser(request).id);
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.put("/avatar", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const { id } = currentUser(request);
    const image = decoderAvatar(Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0));
    const avatarSeed = await writeAvatar(id, image);
    notifyIdentity(id, { avatarSeed });
    return reply.send({ avatarSeed });
  });

  app.delete("/avatar", async (request, reply) => {
    const { id } = currentUser(request);
    const avatarSeed = await deleteAvatar(id);
    notifyIdentity(id, { avatarSeed });
    return reply.send({ avatarSeed });
  });
}

const avatarParams = z.object({ userId: z.string().uuid() });

/**
 * Lecture de l'image d'un joueur, montée sous `/api/users`.
 *
 * Séparée du reste du module parce qu'elle parle d'un **autre** compte que
 * l'appelant : c'est l'adresse que porte la balise `img` de chaque avatar.
 */
export async function avatarReadRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/:userId/avatar",
    {
      preHandler: requireResourceAuth,
      // Un salon plein déclenche une quinzaine de requêtes au premier
      // affichage, puis plus aucune. Le plafond global serait atteint par un
      // joueur qui navigue vite entre les salons.
      config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { userId } = avatarParams.parse(request.params);
      const stored = await readAvatar(userId);

      if (!stored) {
        // Jamais mis en cache : le front ne demande l'image que lorsque le
        // jeton l'annonce, un 404 signale donc une charge utile désynchronisée,
        // état passager qu'il serait absurde de figer chez le client.
        return reply.header("Cache-Control", "no-store").status(404).send();
      }

      const { version } = parseAvatarSeed(stored.seed);
      const etag = `"${version}"`;

      reply
        .header("ETag", etag)
        // Une version dépassée arrive d'une socket figée ou d'un état de jeu en
        // mémoire. On sert les octets courants — jamais un 404, qui ferait
        // disparaître l'avatar — mais sans figer le cache.
        .header("Cache-Control", request.query && (request.query as { v?: string }).v === version
          ? CACHE_IMMUABLE
          : CACHE_REVALIDER)
        // Redondant avec `private`, mais couvre un mandataire mal configuré en
        // amont : deux joueurs ne doivent jamais partager une entrée de cache.
        .header("Vary", "Cookie");

      if (request.headers["if-none-match"] === etag) {
        return reply.status(304).send();
      }

      return reply
        // Codé en dur, jamais le type annoncé par le client à l'envoi.
        .header("Content-Type", AVATAR_MIME)
        .header("Content-Length", stored.image.length)
        .send(stored.image);
    },
  );
}
