import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AdminAccount } from "@maxoujeux/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountTable, CreatePlayerDialog } from "./AdminPage.js";

const player: AdminAccount = {
  id: "player-id", email: "alice@example.test", pseudo: "Alice", avatarSeed: "seed",
  isAdmin: false, balance: 1250, createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z",
};
const admin: AdminAccount = { ...player, id: "admin-id", pseudo: "Maison", isAdmin: true };
const actions = { onResetPassword: () => undefined, onSetBalance: () => undefined, onDelete: () => undefined };

test("affiche les informations des comptes et protège les administrateurs", () => {
  const markup = renderToStaticMarkup(<AccountTable accounts={[player, admin]} {...actions} />);
  assert.match(markup, /Alice/);
  assert.match(markup, /alice@example\.test/);
  assert.match(markup, /1\s?250/);
  assert.match(markup, /Joueur/);
  assert.match(markup, /Administrateur/);
  assert.equal((markup.match(/Réinitialiser le mot de passe/g) ?? []).length, 2);
});

test("propose seulement les champs d'un joueur à créer", () => {
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <CreatePlayerDialog open onClose={() => undefined} />
    </QueryClientProvider>,
  );
  assert.match(markup, /name="email"/);
  assert.match(markup, /name="pseudo"/);
  assert.match(markup, /name="password"/);
  assert.doesNotMatch(markup, /name="(?:role|isAdmin)"/i);
});
