# Administration and Global Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une zone d'administration sécurisée pour gérer les comptes joueurs et un chat global éphémère conservant au plus 1 000 messages dans la mémoire de chaque navigateur.

**Architecture:** Le rôle administrateur est persisté sur `users`, résolu avec chaque session et contrôlé sur des routes REST dédiées. Les opérations de compte restent transactionnelles et les MaxouCoin passent exclusivement par le service de portefeuille. Le chat utilise Socket.IO sans stockage serveur ; un store Zustand global borne l'historique local et alimente un panneau monté dans `AppShell`.

**Tech Stack:** TypeScript strict, Fastify 5, Drizzle ORM/PostgreSQL-PGlite, Argon2id, Socket.IO 4, React 18, Zustand 5, TanStack Query, Zod 3, Tailwind CSS 4, Vitest et `node:test` via `tsx`.

## Global Constraints

- Code, commentaires, libellés et documentation en français.
- Aucun message de chat en base, en mémoire serveur, dans `localStorage` ou dans `sessionStorage`.
- Le client conserve exactement les 1 000 messages de chat les plus récents et les purge à la déconnexion.
- Un message de chat contient au plus 500 caractères après normalisation et son identité vient exclusivement de la session Socket.IO.
- Les comptes administrateurs sont visibles mais ne peuvent être modifiés ni supprimés depuis la zone admin.
- La zone admin crée uniquement des joueurs ; aucun rôle ne vient du corps envoyé par le client.
- Toute réinitialisation de mot de passe révoque toutes les sessions et déconnecte toutes les sockets du joueur.
- Toute suppression est refusée si `activityOf(userId)` n'est pas `null`.
- Tout mouvement MaxouCoin passe par `apps/api/src/modules/wallet/service.ts` et produit une écriture auditable `admin_adjustment` si le solde change.
- Aucun transfert entre comptes, aucun paiement, aucune conversion monétaire.
- Après toute modification de `apps/api/src/db/schema.ts`, exécuter `pnpm db:generate` et versionner la migration générée.
- Ne pas modifier les changements locaux préexistants dans `CLAUDE.md`, `apps/web/src/components/ResumeBanner.tsx`, `apps/web/src/lib/roulette-ui.ts`, `apps/web/src/lib/roulette-ui.test.ts` ou `artifacts/`.

---

## File Map

- `packages/shared/src/admin.ts` — schémas Zod et DTO de l'administration.
- `packages/shared/src/chat.ts` — validation et DTO du chat.
- `packages/shared/src/auth.ts` — ajoute `isAdmin` au profil courant.
- `packages/shared/src/economy.ts` — ajoute la raison auditable `admin_adjustment`.
- `packages/shared/src/realtime.ts` — ajoute `chat:send` et `chat:message`.
- `packages/shared/src/index.ts` — exporte les nouveaux contrats.
- `apps/api/src/db/schema.ts` et `apps/api/drizzle/0002_admin_role.sql` — persistance du rôle.
- `apps/api/src/modules/auth/bootstrap-admin.ts` — amorçage idempotent configuré par l'exploitant.
- `apps/api/src/modules/auth/service.ts` — primitive commune de création atomique d'un compte.
- `apps/api/src/modules/auth/session.ts` — rôle résolu à chaque requête et révocation transactionnelle.
- `apps/api/src/lib/require-admin.ts` — garde REST du rôle administrateur.
- `apps/api/src/modules/wallet/service.ts` — fixation auditable d'un solde cible.
- `apps/api/src/modules/admin/service.ts` — liste et mutations des comptes joueurs.
- `apps/api/src/modules/admin/routes.ts` — surface REST `/api/admin`.
- `apps/api/src/realtime/notify.ts` — notifieur injecté de déconnexion forcée.
- `apps/api/src/realtime/chat.ts` — validation, limitation anti-spam et diffusion sans historique.
- `apps/api/src/realtime/index.ts` — branche les gestionnaires chat et les déconnexions forcées.
- `apps/web/src/lib/admin.ts` — hooks TanStack Query de la zone admin.
- `apps/web/src/pages/AdminPage.tsx` — liste, création et fenêtres d'action.
- `apps/web/src/lib/chat.ts` — store borné, non-lus et purge.
- `apps/web/src/components/ChatPanel.tsx` — panneau global responsive.
- `apps/web/src/lib/socket.ts` — branche les messages et purge l'état.
- `apps/web/src/lib/route.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/AppShell.tsx` — route, garde UI et points d'entrée globaux.
- `.env.example`, `docker-compose.yml`, `docker-compose.example.yml` — configuration explicite de l'administrateur initial.

---

### Task 1: Shared administration and chat contracts

**Files:**
- Create: `packages/shared/src/admin.ts`
- Create: `packages/shared/src/admin.test.ts`
- Create: `packages/shared/src/chat.ts`
- Create: `packages/shared/src/chat.test.ts`
- Modify: `packages/shared/src/auth.ts`
- Modify: `packages/shared/src/economy.ts`
- Modify: `packages/shared/src/realtime.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/web/src/pages/RouletteTablePage.test.tsx`

**Interfaces:**
- Produces: `AdminAccount`, `CreatePlayerInput`, `ResetPlayerPasswordInput`, `SetPlayerBalanceInput`.
- Produces: `CHAT_MAX_LENGTH = 500`, `CHAT_CLIENT_LIMIT = 1000`, `ChatMessage`, `ChatSendInput`, `chatSendSchema`.
- Produces: `CurrentUser.isAdmin: boolean` and wallet reason `admin_adjustment`.
- Extends: `ServerToClientEvents["chat:message"]` and `ClientToServerEvents["chat:send"]`.

- [ ] **Step 1: Write failing shared-contract tests**

Create tests that assert the concrete boundaries:

```ts
// packages/shared/src/admin.test.ts
import { describe, expect, it } from "vitest";
import { createPlayerSchema, resetPlayerPasswordSchema, setPlayerBalanceSchema } from "./admin.js";

describe("contrats d'administration", () => {
  it("réutilise les règles de compte pour créer un joueur", () => {
    expect(createPlayerSchema.parse({
      email: "joueur@example.test",
      pseudo: "Joueur_1",
      password: "mot-de-passe-solide",
    })).toMatchObject({ pseudo: "Joueur_1" });
  });

  it("refuse un solde négatif, fractionnaire ou hors entier sûr", () => {
    for (const balance of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(setPlayerBalanceSchema.safeParse({ balance }).success).toBe(false);
    }
  });

  it("applique la règle complète de mot de passe à une réinitialisation", () => {
    expect(resetPlayerPasswordSchema.safeParse({ password: "court" }).success).toBe(false);
  });
});
```

```ts
// packages/shared/src/chat.test.ts
import { describe, expect, it } from "vitest";
import { CHAT_MAX_LENGTH, chatSendSchema } from "./chat.js";

describe("contrat du chat", () => {
  it("normalise les espaces et refuse un message vide", () => {
    expect(chatSendSchema.parse({ body: "  Bonjour\r\n  tout le monde  " })).toEqual({
      body: "Bonjour\n tout le monde",
    });
    expect(chatSendSchema.safeParse({ body: " \n\t " }).success).toBe(false);
  });

  it("borne le corps à 500 caractères", () => {
    expect(chatSendSchema.safeParse({ body: "a".repeat(CHAT_MAX_LENGTH) }).success).toBe(true);
    expect(chatSendSchema.safeParse({ body: "a".repeat(CHAT_MAX_LENGTH + 1) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run: `pnpm --filter @maxoujeux/shared test -- src/admin.test.ts src/chat.test.ts`

Expected: FAIL because `admin.ts` and `chat.ts` do not exist.

- [ ] **Step 3: Add the exact shared schemas and DTOs**

Implement these public shapes:

```ts
// packages/shared/src/admin.ts
import { z } from "zod";
import { registerSchema, passwordSchema } from "./auth.js";

export const createPlayerSchema = registerSchema;
export const resetPlayerPasswordSchema = z.object({ password: passwordSchema });
export const setPlayerBalanceSchema = z.object({
  balance: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type ResetPlayerPasswordInput = z.infer<typeof resetPlayerPasswordSchema>;
export type SetPlayerBalanceInput = z.infer<typeof setPlayerBalanceSchema>;

export interface AdminAccount {
  id: string;
  email: string;
  pseudo: string;
  avatarSeed: string;
  isAdmin: boolean;
  balance: number;
  createdAt: string;
  lastSeenAt: string;
}
```

```ts
// packages/shared/src/chat.ts
import { z } from "zod";

export const CHAT_MAX_LENGTH = 500;
export const CHAT_CLIENT_LIMIT = 1000;

const normalizeChatBody = (value: string) =>
  value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim();

export const chatSendSchema = z.object({
  body: z.string().transform(normalizeChatBody).pipe(z.string().min(1).max(CHAT_MAX_LENGTH)),
});

export type ChatSendInput = z.infer<typeof chatSendSchema>;

export interface ChatMessage {
  id: string;
  userId: string;
  pseudo: string;
  avatarSeed: string;
  body: string;
  createdAt: string;
}
```

Add `isAdmin: boolean` to `CurrentUser`; add `admin_adjustment` to `WALLET_REASONS` and its label `Ajustement administrateur`; add the chat events with `ActionReply` ack; export both new files from `index.ts`.
Add `isAdmin: false` to the existing typed `CurrentUser` fixture in
`apps/web/src/pages/RouletteTablePage.test.tsx`, so the repository remains type-safe as
soon as the shared contract becomes stricter.

- [ ] **Step 4: Run shared tests and typecheck**

Run: `pnpm --filter @maxoujeux/shared test && pnpm --filter @maxoujeux/shared typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the shared boundary**

```bash
git add packages/shared/src apps/web/src/pages/RouletteTablePage.test.tsx
git commit -m "feat: définir les contrats admin et chat"
```

---

### Task 2: Persist the administrator role and bootstrap the configured account

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0002_admin_role.sql` via Drizzle
- Modify: `apps/api/drizzle/meta/_journal.json`
- Create: `apps/api/drizzle/meta/0002_snapshot.json`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/modules/auth/service.ts`
- Modify: `apps/api/src/modules/auth/session.ts`
- Modify: `apps/api/src/modules/auth/routes.ts`
- Create: `apps/api/src/modules/auth/bootstrap-admin.ts`
- Create: `apps/api/src/modules/auth/bootstrap-admin.test.ts`
- Create: `apps/api/src/lib/require-admin.ts`
- Create: `apps/api/src/lib/require-admin.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/vitest.config.ts`

**Interfaces:**
- Produces: `createAccount(input: RegisterInput, options?: { isAdmin?: boolean }): Promise<AuthenticatedUser>`.
- Preserves: `register(input)` as a wrapper that always creates `isAdmin: false`.
- Produces: `bootstrapAdmin(config = env): Promise<void>`.
- Produces: `requireAdmin: preHandlerHookHandler`.
- Extends: `AuthenticatedUser.isAdmin: boolean` and every `CurrentUser` response.

- [ ] **Step 1: Write failing bootstrap and guard tests**

Cover these cases with unique emails per test and cleanup through `trackCreated()` or explicit user deletion:

```ts
it("crée une seule fois le compte administrateur et son journal initial", async () => {
  const config = { ADMIN_EMAIL: email, ADMIN_PSEUDO: pseudo, ADMIN_PASSWORD: password };
  await bootstrapAdmin(config);
  await bootstrapAdmin(config);
  const rows = await db.select().from(users).where(eq(users.email, email));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.isAdmin).toBe(true);
  expect(await ledgerSum(rows[0]!.id)).toBe(env.STARTING_BALANCE);
});

it("promeut un compte existant sans remplacer son mot de passe", async () => {
  const account = await createAccount({ email, pseudo, password: original });
  const before = await passwordHashOf(account.id);
  await bootstrapAdmin({ ADMIN_EMAIL: email, ADMIN_PSEUDO: "Ignoré", ADMIN_PASSWORD: replacement });
  expect(await passwordHashOf(account.id)).toBe(before);
  expect(await isAdminOf(account.id)).toBe(true);
});
```

For `requireAdmin`, instantiate a minimal Fastify route using `request.user` and assert a player receives 403 `ADMIN_REQUIRED` while an admin reaches the handler.

- [ ] **Step 2: Run targeted tests and confirm failure**

Run: `pnpm --filter @maxoujeux/api test -- src/modules/auth/bootstrap-admin.test.ts src/lib/require-admin.test.ts`

Expected: FAIL because the role, bootstrap and guard do not exist.

- [ ] **Step 3: Add `users.isAdmin` and generate the migration**

Add to `users`:

```ts
isAdmin: boolean("is_admin").notNull().default(false),
```

Run: `pnpm --filter @maxoujeux/api exec drizzle-kit generate --name=admin_role`

Expected: a new `0002_admin_role.sql` with `ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL` plus updated Drizzle metadata. Inspect the generated SQL; do not hand-edit an unrelated migration.

- [ ] **Step 4: Validate all-or-none admin environment variables**

Extend `envSchema` with optional `ADMIN_EMAIL`, `ADMIN_PSEUDO`, `ADMIN_PASSWORD`, using a
preprocessor that maps an empty or whitespace-only environment value to `undefined`,
then the shared email/pseudo/password schemas. Add a `superRefine` issue on each missing
member when one or two non-empty values are present. In tests, keep all three absent by
default. Export a narrow `AdminBootstrapConfig` accepted by `bootstrapAdmin` so the unit
test does not mutate `process.env`.

- [ ] **Step 5: Extract atomic account creation and resolve the role in sessions**

Rename the transaction-bearing creation logic to:

```ts
export async function createAccount(
  input: RegisterInput,
  options: { isAdmin?: boolean } = {},
): Promise<AuthenticatedUser>
```

Insert `isAdmin: options.isAdmin ?? false`, return the role, and keep:

```ts
export function register(input: RegisterInput) {
  return createAccount(input, { isAdmin: false });
}
```

Select and return `users.isAdmin` in login and session resolution. Add the role to `toPublicUser` in auth routes.

- [ ] **Step 6: Implement idempotent bootstrap and REST guard**

`bootstrapAdmin` must:

1. return immediately if all variables are absent;
2. query by case-insensitive email;
3. update only `isAdmin: true` when found;
4. otherwise call `createAccount(input, { isAdmin: true })`;
5. tolerate the race where another process creates the same email by re-reading and promoting it, but still surface a pseudo collision belonging to another email.

`requireAdmin` calls `requireAuth`, then throws `new AppError(403, "ADMIN_REQUIRED", "Accès administrateur requis")` unless `currentUser(request).isAdmin` is true.

Call `await bootstrapAdmin()` in `start()` immediately after `runMigrations()` and before recovery routines.

- [ ] **Step 7: Run migration, auth, bootstrap and shared tests**

Run: `pnpm --filter @maxoujeux/api test -- src/modules/auth/bootstrap-admin.test.ts src/lib/require-admin.test.ts && pnpm --filter @maxoujeux/api typecheck`

Expected: PASS.

- [ ] **Step 8: Commit persistence and bootstrap**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/src/env.ts apps/api/src/modules/auth apps/api/src/lib/require-admin.ts apps/api/src/lib/require-admin.test.ts apps/api/src/index.ts apps/api/vitest.config.ts
git commit -m "feat: amorcer le compte administrateur"
```

---

### Task 3: Add auditable administrative balance adjustment

**Files:**
- Modify: `apps/api/src/modules/wallet/service.ts`
- Modify: `apps/api/src/modules/wallet/service.test.ts`

**Interfaces:**
- Consumes: wallet reason `admin_adjustment` from Task 1.
- Produces: `setBalance(userId: string, target: number): Promise<number>`.
- Guarantees: no journal entry when target equals current balance; notification only after commit.

- [ ] **Step 1: Write failing wallet tests**

Add tests using `trackCreated`, `balanceOf` and `ledgerSum`:

```ts
it("fixe un solde supérieur avec un mouvement auditable", async () => {
  const userId = await created.user(500);
  await db.insert(walletTx).values({
    userId, delta: 500, balanceAfter: 500, reason: "signup_bonus",
  });
  expect(await setBalance(userId, 900)).toBe(900);
  expect(await balanceOf(userId)).toBe(900);
  expect(await ledgerSum(userId)).toBe(900);
});

it("fixe un solde inférieur sans permettre un solde négatif", async () => {
  const userId = await created.user(500);
  await db.insert(walletTx).values({
    userId, delta: 500, balanceAfter: 500, reason: "signup_bonus",
  });
  expect(await setBalance(userId, 125)).toBe(125);
  expect(await balanceOf(userId)).toBe(125);
  expect(await ledgerSum(userId)).toBe(125);
  await expect(setBalance(userId, -1)).rejects.toThrow("Solde cible invalide");
  expect(await balanceOf(userId)).toBe(125);
});

it("n'écrit aucun mouvement quand le solde cible est identique", async () => {
  const userId = await created.user(500);
  await db.insert(walletTx).values({
    userId, delta: 500, balanceAfter: 500, reason: "signup_bonus",
  });
  const countEntries = async () => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(walletTx)
      .where(eq(walletTx.userId, userId));
    return row?.count ?? 0;
  };
  const before = await countEntries();
  expect(await setBalance(userId, 500)).toBe(500);
  expect(await countEntries()).toBe(before);
});
```

- [ ] **Step 2: Run the targeted wallet test and confirm failure**

Run: `pnpm --filter @maxoujeux/api test -- src/modules/wallet/service.test.ts -t "solde"`

Expected: FAIL because `setBalance` is missing.

- [ ] **Step 3: Implement `setBalance` inside the wallet service**

Validate `Number.isSafeInteger(target) && target >= 0`. In a transaction, lock the row before computing the delta:

```ts
await tx.execute(sql`select ${wallets.userId} from ${wallets}
  where ${wallets.userId} = ${userId} for update`);
```

Read the current balance after the lock. If absent, throw `WALLET_NOT_FOUND`. If identical, return it. Otherwise update to the target with `returning`, insert `walletTx` with the computed delta, returned balance and `admin_adjustment`, commit, then call `notifyWallet`.

Extend `Executor` with `execute` only if the helper uses the shared executor type; keep direct wallet writes inside this module.

- [ ] **Step 4: Run wallet tests on PGlite**

Run: `pnpm --filter @maxoujeux/api test -- src/modules/wallet/service.test.ts`

Expected: PASS, including the existing credit/debit and concurrency cases.

- [ ] **Step 5: Run the wallet suite against PostgreSQL when available**

Run after starting `docker-compose.dev.yml`:

```bash
$env:DATABASE_URL='postgres://maxoujeux:maxoujeux@localhost:5433/maxoujeux'
pnpm --filter @maxoujeux/api test -- src/modules/wallet/service.test.ts
```

Expected: PASS. If Docker/PostgreSQL is unavailable, record that limitation in the final handoff; PGlite alone does not prove lock concurrency.

- [ ] **Step 6: Commit the audited adjustment**

```bash
git add apps/api/src/modules/wallet/service.ts apps/api/src/modules/wallet/service.test.ts
git commit -m "feat: ajuster les MaxouCoin par administration"
```

---

### Task 4: Implement administrator account service and REST routes

**Files:**
- Create: `apps/api/src/modules/admin/service.ts`
- Create: `apps/api/src/modules/admin/service.test.ts`
- Create: `apps/api/src/modules/admin/routes.ts`
- Create: `apps/api/src/modules/admin/routes.test.ts`
- Modify: `apps/api/src/modules/auth/session.ts`
- Modify: `apps/api/src/modules/games/activity.ts`
- Modify: `apps/api/src/modules/games/activity.test.ts`
- Modify: `apps/api/src/realtime/notify.ts`
- Modify: `apps/api/src/realtime/index.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `createAccount`, `hashPassword`, `revokeAllSessions`, `activityOf`, `setBalance`, shared admin schemas.
- Produces: `listAccounts`, `createPlayer`, `resetPlayerPassword`, `setPlayerBalance`, `deletePlayer`.
- Produces: `blockActivity(userId): boolean` and `unblockActivity(userId): void` to close the deletion race.
- Produces: `setDisconnectNotifier((userId) => void)` and `disconnectUser(userId)`.
- Registers: REST endpoints beneath `/api/admin`.

- [ ] **Step 1: Write failing service tests for all protected mutations**

Test the service directly:

```ts
it("liste joueurs et administrateurs sans exposer de hash", async () => {
  const rows = await listAccounts();
  expect(rows.find((row) => row.id === playerId)).toMatchObject({ isAdmin: false, balance: 500 });
  expect(rows[0]).not.toHaveProperty("passwordHash");
});

it("protège tout administrateur contre les trois mutations", async () => {
  const target = await createAccount(
    { email: adminEmail, pseudo: adminPseudo, password: "mot-de-passe-admin" },
    { isAdmin: true },
  );
  const protectedError = { code: "ADMIN_ACCOUNT_PROTECTED" };
  await expect(
    resetPlayerPassword(target.id, { password: "nouveau-mot-de-passe" }),
  ).rejects.toMatchObject(protectedError);
  await expect(
    setPlayerBalance(target.id, { balance: 750 }),
  ).rejects.toMatchObject(protectedError);
  await expect(deletePlayer(target.id)).rejects.toMatchObject(protectedError);
});

it("refuse de supprimer un joueur en activité", async () => {
  reserveActivity(playerId, { kind: "motus", id: "test-slot" });
  await expect(deletePlayer(playerId)).rejects.toMatchObject({ code: "PLAYER_ACTIVE" });
  releaseActivity(playerId, { kind: "motus", id: "test-slot" });
});

it("empêche une nouvelle activité pendant la suppression d'un compte", () => {
  expect(blockActivity(playerId)).toBe(true);
  expect(reserveActivity(playerId, { kind: "motus", id: "test-slot" })).toBe(false);
  unblockActivity(playerId);
  expect(reserveActivity(playerId, { kind: "motus", id: "test-slot" })).toBe(true);
});
```

Inject a fake disconnect notifier to assert password reset and deletion call it only after successful persistence. Verify the new password with `verifyPassword` and assert sessions are removed.

- [ ] **Step 2: Run service tests and confirm failure**

Run: `pnpm --filter @maxoujeux/api test -- src/modules/admin/service.test.ts`

Expected: FAIL because the admin module does not exist.

- [ ] **Step 3: Implement focused admin service operations**

Use a private `playerTarget(id)` selector that returns `id` and `isAdmin`, throws `ACCOUNT_NOT_FOUND` when absent, and throws `ADMIN_ACCOUNT_PROTECTED` when true. Apply it inside each mutation immediately before writing.

`listAccounts()` joins `users` and `wallets`, orders administrators first then `lower(pseudo)`, and maps dates to ISO.

`createPlayer(input)` calls `createAccount(input, { isAdmin: false })` and maps the result to `AdminAccount` by re-reading `lastSeenAt`.

`resetPlayerPassword(id, input)` hashes before opening a short transaction, protects/re-reads the target in that transaction, updates `passwordHash`, deletes all rows in `sessions`, commits, then calls `disconnectUser(id)`. To keep revocation atomic, add `revokeAllSessionsIn(exec, userId)` in the session module and keep `revokeAllSessions` as the database wrapper.

`setPlayerBalance(id, input)` protects the target, then calls `setBalance`.

Extend the activity registry with a `blockedUsers` set. `reserveActivity` returns false
while a user is blocked. `blockActivity(id)` synchronously returns false when an activity
already exists; otherwise it adds the ID to `blockedUsers`. `unblockActivity(id)` removes
it. This reservation contains no `await` and therefore atomically closes the race with a
new game start.

`deletePlayer(id)` calls `blockActivity(id)` before its first `await` and throws
`PLAYER_ACTIVE` when it returns false. Within `try/finally`, it opens a transaction,
protects/re-reads the target, deletes the user and commits; the `finally` always calls
`unblockActivity(id)`. Only after a successful commit does it call `disconnectUser(id)`.

- [ ] **Step 4: Write failing route authorization and validation tests**

Build a Fastify test app with cookie support, registered error handler and `adminRoutes`. Create signed sessions for a player and an admin. Assert:

- unauthenticated `GET /accounts` returns 401;
- player session returns 403 `ADMIN_REQUIRED`;
- admin receives 200 and the account list;
- `POST /accounts` never accepts an `isAdmin` property as authority and returns a player;
- invalid balance returns 400 fields;
- protected admin mutations return 409 `ADMIN_ACCOUNT_PROTECTED`;
- valid delete returns 204.

- [ ] **Step 5: Register exact REST handlers**

Use these schemas and statuses:

```ts
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
```

Validate `:id` with `z.object({ id: z.string().uuid() })`. Register the module at `/api/admin` in `index.ts`.

In realtime setup, register the disconnect notifier as:

```ts
setDisconnectNotifier((userId) => {
  io.in(userRoom(userId)).disconnectSockets(true);
});
```

- [ ] **Step 6: Run all admin API tests and typecheck**

Run: `pnpm --filter @maxoujeux/api test -- src/modules/admin/service.test.ts src/modules/admin/routes.test.ts && pnpm --filter @maxoujeux/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the administrator API**

```bash
git add apps/api/src/modules/admin apps/api/src/modules/auth/session.ts apps/api/src/modules/games/activity.ts apps/api/src/modules/games/activity.test.ts apps/api/src/realtime/notify.ts apps/api/src/realtime/index.ts apps/api/src/index.ts
git commit -m "feat: exposer la gestion des joueurs"
```

---

### Task 5: Add the protected administration page

**Files:**
- Create: `apps/web/src/lib/admin.ts`
- Create: `apps/web/src/lib/admin.test.ts`
- Create: `apps/web/src/pages/AdminPage.tsx`
- Create: `apps/web/src/pages/AdminPage.test.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/route.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`

**Interfaces:**
- Consumes: `AdminAccount` and shared admin input schemas.
- Produces: `useAdminAccounts`, `useCreatePlayer`, `useResetPlayerPassword`, `useSetPlayerBalance`, `useDeletePlayer`.
- Extends: `api.patch<T>` and `api.delete<T>`.
- Extends: route union with `{ name: "admin" }` mapped to `/admin`.

- [ ] **Step 1: Write failing route and API-adapter tests**

Extend route coverage or create `admin.test.ts` to assert:

```ts
assert.deepEqual(parseRoute("/admin"), { name: "admin" });
assert.equal(routePath({ name: "admin" }), "/admin");
```

Test an exported pure helper `adminActionAllowed(account)` returns false for admins and true for players. Test that mutation success invalidates `adminAccountsQueryKey` and updates `sessionQueryKey` only when the adjusted account is the current account.

- [ ] **Step 2: Run web tests and confirm failure**

Run: `pnpm --filter @maxoujeux/web test -- src/lib/admin.test.ts`

Expected: FAIL because the admin client and route do not exist.

- [ ] **Step 3: Add API methods, admin hooks and route support**

Add:

```ts
patch: <T>(path: string, body: unknown) => apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
```

Use query key `const adminAccountsQueryKey = ["admin", "accounts"] as const`. Every mutation invalidates it. Balance mutation also updates the session cache if `accountId === current.id`, though normal UI protection makes that defensive only.

Add the `admin` route to `Route`, `routePath` and `parseRoute`.

- [ ] **Step 4: Write failing static-render tests for the page**

Following existing `renderToStaticMarkup` tests, verify an account row shows pseudo, email, formatted balance and `Administrateur` or `Joueur`; verify admin rows render no mutation buttons; verify the creation dialog includes email, pseudo and password but no role selector.

- [ ] **Step 5: Implement the page with focused dialogs**

Keep `AdminPage.tsx` composed from small local components:

- `AccountTable` / mobile account cards;
- `CreatePlayerDialog`;
- `ResetPasswordDialog`;
- `SetBalanceDialog`;
- `DeleteAccountDialog`.

Parse form payloads with the shared Zod schemas before mutation. Convert `ApiClientError.fields` to field messages. Use one primary brass action on the page (`Créer un joueur`); dialog confirmation buttons may be primary because each dialog is a separate decision context. Use native table semantics on desktop and labeled cards on narrow screens.

- [ ] **Step 6: Protect navigation and render the admin entry point**

In `Screen`, if `route.name === "admin"` and `!user.isAdmin`, call a small pure redirect helper or render the lobby while an effect replaces the route with lobby. Avoid navigating during render. Render `AdminPage` only for admins.

In `AppShell`, add a visible `Administration` link only when `user.isAdmin`; keep it compact on mobile with an accessible label.

- [ ] **Step 7: Run web tests and typecheck**

Run: `pnpm --filter @maxoujeux/web test && pnpm --filter @maxoujeux/web typecheck`

Expected: PASS.

- [ ] **Step 8: Commit the administration interface**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/admin.ts apps/web/src/lib/admin.test.ts apps/web/src/lib/route.ts apps/web/src/App.tsx apps/web/src/components/AppShell.tsx apps/web/src/pages/AdminPage.tsx apps/web/src/pages/AdminPage.test.tsx
git commit -m "feat: ajouter la zone administration"
```

---

### Task 6: Implement stateless global chat on Socket.IO

**Files:**
- Create: `apps/api/src/realtime/chat.ts`
- Create: `apps/api/src/realtime/chat.test.ts`
- Modify: `apps/api/src/realtime/index.ts`

**Interfaces:**
- Consumes: `chatSendSchema`, `ChatMessage`, `GameServer`, `GameSocket`, `withAck`.
- Produces: `registerChatHandlers(io: GameServer, socket: GameSocket): void`.
- Guarantees: no module-level message array and no database import.

- [ ] **Step 1: Write failing tests around a pure rate limiter and handler**

Export a small `ChatRateLimiter` class configured as `new ChatRateLimiter(5, 10_000)`. Test with an injected clock:

```ts
it("autorise cinq messages puis refuse le sixième dans la fenêtre", () => {
  const limiter = new ChatRateLimiter(5, 10_000, () => now);
  for (let index = 0; index < 5; index += 1) expect(limiter.take()).toBe(true);
  expect(limiter.take()).toBe(false);
  now += 10_001;
  expect(limiter.take()).toBe(true);
});
```

With fake `io` and `socket`, capture the registered callback and assert:

- the emitted message identity equals `socket.data`, ignoring any forged extra fields;
- whitespace is normalized;
- invalid bodies return `VALIDATION_ERROR` through the ack;
- the sixth rapid message returns `CHAT_RATE_LIMITED`;
- one accepted message causes exactly one `io.emit("chat:message", message)` and the
  module has no database dependency.

- [ ] **Step 2: Run the chat server test and confirm failure**

Run: `pnpm --filter @maxoujeux/api test -- src/realtime/chat.test.ts`

Expected: FAIL because `realtime/chat.ts` does not exist.

- [ ] **Step 3: Implement per-socket rate limiting and broadcasting**

Keep rate state in the closure created by `registerChatHandlers`, so disconnecting the
socket releases it. Register the handler with this concrete shape, extracting message
construction into `createChatMessage(socket.data, input)` only if that keeps the handler
focused:

```ts
socket.on("chat:send", (payload, ack) => {
  void withAck(socket, "chat:send", ack, async () => {
    const input = chatSendSchema.parse(payload);
    if (!limiter.take()) {
      throw new AppError(
        429,
        "CHAT_RATE_LIMITED",
        "Tu envoies des messages trop rapidement.",
      );
    }
    const message: ChatMessage = {
      id: randomUUID(),
      userId: socket.data.userId,
      pseudo: socket.data.pseudo,
      avatarSeed: socket.data.avatarSeed,
      body: input.body,
      createdAt: new Date().toISOString(),
    };
    io.emit("chat:message", message);
    return null;
  });
});
```

The rate-limit failure is exactly:

```ts
new AppError(429, "CHAT_RATE_LIMITED", "Tu envoies des messages trop rapidement.")
```

Build the message using `randomUUID()`, `socket.data.userId`, `pseudo`, `avatarSeed`, parsed body and `new Date().toISOString()`. Broadcast with `io.emit`. Return `null` through the ack. Do not import `db` or `chatMessages`.

- [ ] **Step 4: Register the handler and run realtime/API tests**

Call `registerChatHandlers(io, socket)` once per connection in `realtime/index.ts`.

Run: `pnpm --filter @maxoujeux/api test -- src/realtime/chat.test.ts && pnpm --filter @maxoujeux/api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the stateless chat server**

```bash
git add apps/api/src/realtime/chat.ts apps/api/src/realtime/chat.test.ts apps/api/src/realtime/index.ts
git commit -m "feat: diffuser le chat global sans historique"
```

---

### Task 7: Add bounded client chat state and global panel

**Files:**
- Create: `apps/web/src/lib/chat.ts`
- Create: `apps/web/src/lib/chat.test.ts`
- Create: `apps/web/src/components/ChatPanel.tsx`
- Create: `apps/web/src/components/ChatPanel.test.tsx`
- Modify: `apps/web/src/lib/socket.ts`
- Modify: `apps/web/src/lib/session.ts`
- Modify: `apps/web/src/components/AppShell.tsx`

**Interfaces:**
- Consumes: `CHAT_CLIENT_LIMIT`, `CHAT_MAX_LENGTH`, `ChatMessage`, `chatSendSchema`.
- Produces store actions: `receive`, `open`, `close`, `clear`.
- Produces selectors/state: `messages`, `isOpen`, `unread`.
- Produces: `sendChat(body: string): Promise<ActionReply>` using existing `emitWithAck`.

- [ ] **Step 1: Write failing bounded-store tests**

Create messages with monotonic IDs and assert:

```ts
it("ne conserve que les 1 000 messages les plus récents", () => {
  for (let index = 0; index < CHAT_CLIENT_LIMIT + 25; index += 1) {
    useChat.getState().receive(message(index));
  }
  expect(useChat.getState().messages).toHaveLength(CHAT_CLIENT_LIMIT);
  expect(useChat.getState().messages[0]?.id).toBe("25");
});

it("compte les non-lus seulement quand le panneau est fermé", () => {
  useChat.getState().receive(message(1));
  expect(useChat.getState().unread).toBe(1);
  useChat.getState().open();
  useChat.getState().receive(message(2));
  expect(useChat.getState().unread).toBe(0);
});

it("vide messages, non-lus et état d'ouverture", () => {
  useChat.getState().clear();
  expect(useChat.getState()).toMatchObject({ messages: [], unread: 0, isOpen: false });
});
```

- [ ] **Step 2: Run the store test and confirm failure**

Run: `pnpm --filter @maxoujeux/web test -- src/lib/chat.test.ts`

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the in-memory store and socket binding**

Implement Zustand state without `persist`. `receive` appends and uses `.slice(-CHAT_CLIENT_LIMIT)`. If closed, increment unread up to `CHAT_CLIENT_LIMIT`; `open` clears unread; `close` preserves messages.

Register exactly one `socket.on("chat:message", message => useChat.getState().receive(message))` inside `connect()`. In `disconnect()`, call `useChat.getState().clear()`. Also call `clear()` at the beginning of successful logout before `queryClient.clear()` so the state is purged even if the socket is already absent.

`sendChat` validates locally with `chatSendSchema` and then uses `emitWithAck`:

```ts
return emitWithAck((socket, ack) => socket.emit("chat:send", input, ack));
```

- [ ] **Step 4: Write failing static panel tests**

Verify static markup for:

- empty state text `Aucun message pour le moment`;
- two message rows with avatar/pseudo/time/body;
- textarea or input with `maxLength={CHAT_MAX_LENGTH}`;
- no `aria-live` region on the message list;
- unread badge capped visually as `999+` if state exceeds 999.

- [ ] **Step 5: Implement the responsive panel**

Mount `ChatPanel` once in `AppShell`. Add a chat button beside the wallet/user controls with an accessible unread label. Use `Modal variant="lateral"` for the panel. The composer:

- keeps a local draft;
- sends on submit and on Enter without Shift;
- permits Shift+Enter for a newline;
- disables duplicate submission while pending;
- preserves the draft on failure and shows the ack message near the composer;
- clears the draft on success;
- scrolls to the bottom only when the user was already near the bottom, so reading older local messages is not interrupted.

Use `<time dateTime={createdAt}>` and a French `HH:mm` formatter. Do not mark the list as live; use the unread badge when closed.

- [ ] **Step 6: Run web tests and typecheck**

Run: `pnpm --filter @maxoujeux/web test && pnpm --filter @maxoujeux/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the global chat client**

```bash
git add apps/web/src/lib/chat.ts apps/web/src/lib/chat.test.ts apps/web/src/lib/socket.ts apps/web/src/lib/session.ts apps/web/src/components/ChatPanel.tsx apps/web/src/components/ChatPanel.test.tsx apps/web/src/components/AppShell.tsx
git commit -m "feat: ajouter le panneau de chat global"
```

---

### Task 8: Wire deployment configuration and verify the complete feature

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.example.yml`

**Interfaces:**
- Consumes: `ADMIN_EMAIL`, `ADMIN_PSEUDO`, `ADMIN_PASSWORD` validated in Task 2.
- Produces: deployable example configuration for the initial admin account.

- [ ] **Step 1: Add explicit admin variables to environment examples**

In `.env.example`, add a section explaining that all three values must be present together, are used to create or promote the initial admin, and do not reset its password after creation:

```dotenv
# --- Administration ----------------------------------------------------------
ADMIN_EMAIL=admin@example.com
ADMIN_PSEUDO=Admin
# 10 caractères minimum ; utilisé uniquement à la création initiale.
ADMIN_PASSWORD=
```

In `docker-compose.example.yml`, add concrete `ADMIN_EMAIL`, `ADMIN_PSEUDO` and
`ADMIN_PASSWORD=REMPLACE_MOI_MOT_DE_PASSE_ADMIN_10_CARACTERES_MINIMUM` beneath the API
session settings, with the same explanation.

In the canonical `docker-compose.yml`, pass through all three variables without defaults:

```yaml
ADMIN_EMAIL: ${ADMIN_EMAIL:-}
ADMIN_PSEUDO: ${ADMIN_PSEUDO:-}
ADMIN_PASSWORD: ${ADMIN_PASSWORD:-}
```

Empty values are treated as absent as a group; a partial non-empty group fails validation.

- [ ] **Step 2: Check Compose rendering**

Run with temporary non-secret values supplied only to the command environment:

```powershell
$env:POSTGRES_PASSWORD='test-compose-only'
$env:SESSION_SECRET='test-compose-secret-long-de-plus-de-trente-deux-caracteres'
$env:PUBLIC_ORIGIN='https://example.test'
$env:ADMIN_EMAIL='admin@example.test'
$env:ADMIN_PSEUDO='Admin'
$env:ADMIN_PASSWORD='mot-de-passe-admin-test'
docker compose config --quiet
```

Expected: exit code 0. Do not print `docker compose config`, because it would echo secret values.

- [ ] **Step 3: Run complete automated verification**

Run in this order:

```bash
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: all commands exit 0. If a pre-existing unrelated local change fails a check, isolate and report it; do not overwrite that work.

- [ ] **Step 4: Run browser verification with the webapp-testing skill**

Start the app with a dedicated development session secret and admin variables. Verify at 390 px and 1280 px:

1. the configured admin can log in and sees the Administration entry;
2. a normal player cannot reach `/admin` and the API rejects a forged call;
3. the admin can create a player, reset its password, set its exact balance and delete it;
4. reset disconnects every open tab of the player;
5. deletion is blocked while the player has an active game;
6. chat messages appear in two authenticated browsers on different pages;
7. navigation and panel close preserve messages;
8. reload clears messages and provides no history;
9. the 1 001st locally received message evicts the oldest without UI slowdown;
10. keyboard focus, Escape, Enter/Shift+Enter and mobile layout behave correctly.

Capture screenshots of the admin page and chat panel only if useful for the handoff; do not add them to git unless requested.

- [ ] **Step 5: Inspect final scope and commit configuration**

Run: `git status --short` and `git diff --stat HEAD~1`

Confirm unrelated pre-existing files were not staged. Then:

```bash
git add .env.example docker-compose.yml docker-compose.example.yml
git commit -m "docs: configurer le compte administrateur"
```

- [ ] **Step 6: Use verification-before-completion before reporting success**

Re-run the decisive commands from Step 3 after the final commit, record their exit codes, and only then state that the feature is complete.
