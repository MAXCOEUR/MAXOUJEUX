import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { CreatePlayerDialog } from "./AdminPage.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  MutationObserver: dom.window.MutationObserver,
  FormData: dom.window.FormData,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});
Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => null,
});

test("ferme la création sans afficher d'erreur après une réponse différée réussie", async () => {
  let closeCount = 0;
  let answerRequest: ((response: Response) => void) | undefined;
  const delayedResponse = new Promise<Response>((resolve) => {
    answerRequest = resolve;
  });

  globalThis.fetch = async () => delayedResponse;

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CreatePlayerDialog open onClose={() => { closeCount += 1; }} />
    </QueryClientProvider>,
  );

  fireEvent.change(view.getByLabelText("Email"), { target: { value: "alice@example.test" } });
  fireEvent.change(view.getByLabelText("Pseudo"), { target: { value: "Alice" } });
  fireEvent.change(view.getByLabelText("Mot de passe"), { target: { value: "Password-2026!" } });
  fireEvent.submit(view.baseElement.querySelector("form")!);

  answerRequest?.(new Response(JSON.stringify({
    account: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "alice@example.test",
      pseudo: "Alice",
      avatarSeed: "seed",
      role: "player",
      isAdmin: false,
      isBanned: false,
      balance: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    },
  }), { status: 201, headers: { "Content-Type": "application/json" } }));

  await waitFor(() => assert.equal(closeCount, 1), { timeout: 10_000 });
  assert.equal(view.queryByRole("alert"), null);
});
