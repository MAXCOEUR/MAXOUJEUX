import assert from "node:assert/strict";
import test from "node:test";
import { getGame } from "@maxoujeux/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { NewTableDialog } from "./NewTableDialog";

test("le créateur règle les blindes, les caves et les places de sa table de poker", () => {
  const html = renderToStaticMarkup(
    <NewTableDialog
      open
      onClose={() => undefined}
      game={getGame("poker")!}
      balance={5_000}
      onCreate={() => undefined}
      loading={false}
    />,
  );

  assert.match(html, /Petite blinde/);
  assert.match(html, /Grosse blinde/);
  assert.match(html, /Cave minimale/);
  assert.match(html, /Cave maximale/);
  assert.match(html, /Nombre de places/);
  assert.match(html, /Illimitée/);
  assert.match(html, /La cave est débitée à l’ouverture/);
});
