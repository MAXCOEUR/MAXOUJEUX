import {
  createPlayerSchema,
  banAccountSchema,
  resetPlayerPasswordSchema,
  setPlayerBalanceSchema,
  setUserRoleSchema,
} from "@maxoujeux/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../lib/require-admin.js";
import { requireStaff } from "../../lib/require-staff.js";
import { currentUser } from "../../lib/require-auth.js";
import {
  createPlayer,
  deletePlayer,
  listAccounts,
  resetPlayerPassword,
  setAccountRole,
  setPlayerBalance,
} from "./service.js";
import {
  banAccount,
  listAccountAccesses,
  listAccountBans,
  revokeBan,
} from "../moderation/service.js";

const accountParamsSchema = z.object({ id: z.string().uuid() });

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/accounts", { preHandler: requireStaff }, async (_request, reply) => {
    return reply.send({ accounts: await listAccounts() });
  });

  app.post("/accounts", { preHandler: requireAdmin }, async (request, reply) => {
    const input = createPlayerSchema.parse(request.body);
    return reply
      .status(201)
      .send({ account: await createPlayer(input, currentUser(request).id) });
  });

  app.patch("/accounts/:id/password", { preHandler: requireStaff }, async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    const input = resetPlayerPasswordSchema.parse(request.body);
    await resetPlayerPassword(id, input, currentUser(request).id);
    return reply.status(204).send();
  });

  app.patch("/accounts/:id/balance", { preHandler: requireStaff }, async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    const input = setPlayerBalanceSchema.parse(request.body);
    return reply.send({ balance: await setPlayerBalance(id, input, currentUser(request).id) });
  });

  app.patch("/accounts/:id/role", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    await setAccountRole(id, setUserRoleSchema.parse(request.body), currentUser(request).id);
    return reply.status(204).send();
  });

  app.get("/accounts/:id/accesses", { preHandler: requireStaff }, async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    return reply.send({ accesses: await listAccountAccesses(id) });
  });

  app.get("/accounts/:id/bans", { preHandler: requireStaff }, async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    return reply.send({ bans: await listAccountBans(id) });
  });

  app.post("/accounts/:id/bans", { preHandler: requireStaff }, async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    const bans = await banAccount(currentUser(request).id, id, banAccountSchema.parse(request.body));
    return reply.status(201).send({ bans });
  });

  app.post("/bans/:id/revoke", { preHandler: requireStaff }, async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    await revokeBan(currentUser(request).id, id);
    return reply.status(204).send();
  });

  app.delete("/accounts/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    await deletePlayer(id, currentUser(request).id);
    return reply.status(204).send();
  });
}
