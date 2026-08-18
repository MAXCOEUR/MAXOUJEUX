import type { preHandlerHookHandler } from "fastify";
import { AppError } from "./errors.js";
import { currentUser, requireAuth } from "./require-auth.js";

/** Protège les routes accessibles aux modérateurs et à l'administrateur. */
export const requireStaff: preHandlerHookHandler = async function (request, reply) {
  await requireAuth.call(this, request, reply, () => undefined);
  if (currentUser(request).role === "player") {
    throw new AppError(403, "STAFF_REQUIRED", "Accès réservé à l’équipe de modération");
  }
};
