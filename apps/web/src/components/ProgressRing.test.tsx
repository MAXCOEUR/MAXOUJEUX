import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { syncServerClock } from "@/lib/clock";
import { ProgressRing } from "./ProgressRing.js";

const NOW = "2026-08-12T12:00:00.000Z";
const IN_FIFTEEN_SECONDS = "2026-08-12T12:00:15.000Z";

test("affiche les secondes réellement restantes au centre de l’anneau", () => {
  syncServerClock(NOW);

  const html = renderToStaticMarkup(
    <ProgressRing deadlineAt={IN_FIFTEEN_SECONDS} turnMs={30_000} showSeconds />,
  );

  assert.match(html, /aria-label="15 secondes restantes"/);
  assert.match(html, />15<\/span>/);
});

test("ne masque pas le contenu central sans l’option des secondes", () => {
  syncServerClock(NOW);

  const html = renderToStaticMarkup(
    <ProgressRing deadlineAt={IN_FIFTEEN_SECONDS} turnMs={30_000}>
      <span>Avatar</span>
    </ProgressRing>,
  );

  assert.match(html, /Avatar/);
  assert.doesNotMatch(html, /secondes restantes/);
});
