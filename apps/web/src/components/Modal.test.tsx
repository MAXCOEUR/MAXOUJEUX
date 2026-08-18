import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Modal } from "./Modal.js";

test("place le contenu d'une feuille dans une région défilable", () => {
  const markup = renderToStaticMarkup(
    <Modal
      open
      onClose={() => undefined}
      title="Fenêtre longue"
      footer={<button type="button">Action permanente</button>}
    >
      <p>Contenu long</p>
    </Modal>,
  );

  assert.match(
    markup,
    /data-modal-body="true"[^>]*class="[^"]*min-h-0[^"]*overflow-y-auto/,
  );
  assert.ok(markup.indexOf("Contenu long") < markup.indexOf("Action permanente"));
});
