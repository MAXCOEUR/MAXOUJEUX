import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TableScene } from "./TableScene.js";

test("range les six jeux sur deux lignes compactes", () => {
  const markup = renderToStaticMarkup(<TableScene />);

  assert.match(markup, /grid-cols-3/);
  assert.match(markup, /grid-rows-2/);
  assert.equal((markup.match(/data-table-scene-item="true"/g) ?? []).length, 6);
  assert.doesNotMatch(markup, /col-span-2/);
});
