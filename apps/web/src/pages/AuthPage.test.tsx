import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthPage } from "./AuthPage.js";

test("expose l'email de connexion comme identifiant au gestionnaire de mots de passe", () => {
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AuthPage />
    </QueryClientProvider>,
  );
  const emailInput = markup.match(/<input[^>]*name="email"[^>]*>/)?.[0];

  assert.ok(emailInput, "Le champ email doit être rendu");
  assert.match(emailInput, /type="email"/);
  assert.match(emailInput, /autoComplete="username"/i);
});
