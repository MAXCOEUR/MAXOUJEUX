import assert from "node:assert/strict";
import test from "node:test";
import { resetAfterSuccessfulSubmit } from "./form-submit.js";

test("réinitialise le formulaire seulement après une soumission différée réussie", async () => {
  let finishRequest: (() => void) | undefined;
  const request = new Promise<void>((resolve) => {
    finishRequest = resolve;
  });
  let resetCount = 0;

  const submission = resetAfterSuccessfulSubmit(
    { reset: () => { resetCount += 1; } },
    () => request,
  );

  assert.equal(resetCount, 0);
  finishRequest?.();
  await submission;
  assert.equal(resetCount, 1);
});

test("ne réinitialise pas le formulaire quand la soumission échoue", async () => {
  let resetCount = 0;

  await assert.rejects(() => resetAfterSuccessfulSubmit(
    { reset: () => { resetCount += 1; } },
    async () => { throw new Error("échec réseau"); },
  ));

  assert.equal(resetCount, 0);
});
