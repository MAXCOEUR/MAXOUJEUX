import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MotusKeyboard } from "./MotusKeyboard.js";

test("rend toutes les commandes et annonce les couleurs en français", () => {
  const markup = renderToStaticMarkup(
    <MotusKeyboard
      guesses={[
        { guess: "SALLE", marks: ["absent", "present", "correct", "absent", "absent"] },
      ]}
      disabled={false}
      canSubmit
      onLetter={() => undefined}
      onErase={() => undefined}
      onSubmit={() => undefined}
    />,
  );

  assert.equal(markup.match(/<button/g)?.length, 28);
  assert.match(markup, /aria-label="Lettre L, bien placée"/);
  assert.match(markup, /aria-label="Lettre A, présente ailleurs"/);
  assert.match(markup, /aria-label="Lettre S, absente"/);
  assert.match(markup, /aria-label="Effacer la dernière lettre"/);
  assert.match(markup, /aria-label="Valider le mot"/);
});
