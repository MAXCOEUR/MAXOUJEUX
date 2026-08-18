import type { preHandlerHookHandler } from "fastify";
import { AppError } from "./errors.js";
import { currentUser, requireAuth } from "./require-auth.js";

/** Protège les routes réservées aux administrateurs. */
export const requireAdmin: preHandlerHookHandler = async function (request, reply) {
  await requireAuth.call(this, request, reply, () => undefined);
  if (currentUser(request).role !== "admin") {
    throw new AppError(403, "ADMIN_REQUIRED", "Accès administrateur requis");
  }
};
