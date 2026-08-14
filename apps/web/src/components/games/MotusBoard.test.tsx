import assert from "node:assert/strict";
import test from "node:test";
import type { MotusView } from "@maxoujeux/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MotusBoard } from "./MotusBoard.js";

function playingView(): MotusView {
  return {
    slotStart: "2026-08-11T12:00:00.000Z",
    slotEnd: "2026-08-11T18:00:00.000Z",
    nextSlotAt: "2026-08-11T18:00:00.000Z",
    isCurrentSlot: true,
    canStartCurrent: false,
    length: 5,
    guesses: [],
    attemptsLeft: 6,
    status: "playing",
    endReason: null,
    stake: 100,
    payout: 0,
    net: -100,
    version: 0,
    startedAt: "2026-08-11T12:00:30.000Z",
    durationMs: null,
    now: "2026-08-11T12:05:00.000Z",
  };
}

test("place le contour sur la prochaine case vide", () => {
  const markup = renderToStaticMarkup(
    <MotusBoard view={playingView()} draft="MO" pending={false} />,
  );

  assert.equal(markup.match(/ring-2/g)?.length, 1);
  assert.match(markup, /ring-2[^>]*><\/span>/);
});

test("garde le contour sur la dernière case lorsque le mot est complet", () => {
  const markup = renderToStaticMarkup(
    <MotusBoard view={playingView()} draft="MOTUS" pending={false} />,
  );

  assert.equal(markup.match(/ring-2/g)?.length, 1);
  assert.match(markup, /ring-2[^>]*>S<\/span>/);
});
