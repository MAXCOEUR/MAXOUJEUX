import {
  createPlayerSchema,
  resetPlayerPasswordSchema,
  setPlayerBalanceSchema,
} from "@maxoujeux/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../lib/require-admin.js";
import {
  createPlayer,
  deletePlayer,
  listAccounts,
  resetPlayerPassword,
  setPlayerBalance,
} from "./service.js";

const accountParamsSchema = z.object({ id: z.string().uuid() });

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAdmin);

  app.get("/accounts", async (_request, reply) => {
    return reply.send({ accounts: await listAccounts() });
  });

  app.post("/accounts", async (request, reply) => {
    const input = createPlayerSchema.parse(request.body);
    return reply.status(201).send({ account: await createPlayer(input) });
  });

  app.patch("/accounts/:id/password", async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    const input = resetPlayerPasswordSchema.parse(request.body);
    await resetPlayerPassword(id, input);
    return reply.status(204).send();
  });

  app.patch("/accounts/:id/balance", async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    const input = setPlayerBalanceSchema.parse(request.body);
    return reply.send({ balance: await setPlayerBalance(id, input) });
  });

  app.delete("/accounts/:id", async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    await deletePlayer(id);
    return reply.status(204).send();
  });
}
