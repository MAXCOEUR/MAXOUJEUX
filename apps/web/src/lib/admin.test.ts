import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import type { AdminAccount, CurrentUser } from "@maxoujeux/shared";
import {
  adminAccountsQueryKey,
  adminActionAllowed,
  onAdminMutationSuccess,
  updateCurrentAccountBalance,
} from "./admin.js";
import { parseRoute, routePath } from "./route.js";
import { sessionQueryKey } from "./session.js";

const player: AdminAccount = {
  id: "player-id", email: "joueur@example.test", pseudo: "Joueur", avatarSeed: "seed",
  role: "player", isBanned: false, isAdmin: false, balance: 1200, createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z",
};

test("reconnaît le chemin d'administration", () => {
  assert.deepEqual(parseRoute("/admin"), { name: "admin" });
  assert.equal(routePath({ name: "admin" }), "/admin");
});

test("masque les mutations des comptes administrateurs", () => {
  assert.equal(adminActionAllowed({ ...player, isAdmin: true }), false);
  assert.equal(adminActionAllowed(player), true);
});

test("invalide les comptes et ne met à jour que la session concernée", () => {
  const queryClient = new QueryClient();
  const current: CurrentUser = { ...player, id: "current-id" };
  queryClient.setQueryData(adminAccountsQueryKey, [player]);
  queryClient.setQueryData(sessionQueryKey, current);

  onAdminMutationSuccess(queryClient);
  updateCurrentAccountBalance(queryClient, player.id, 2500);
  assert.equal(queryClient.getQueryState(adminAccountsQueryKey)?.isInvalidated, true);
  assert.equal(queryClient.getQueryData<CurrentUser>(sessionQueryKey)?.balance, current.balance);

  updateCurrentAccountBalance(queryClient, current.id, 2500);
  assert.equal(queryClient.getQueryData<CurrentUser>(sessionQueryKey)?.balance, 2500);
});
