import assert from "node:assert/strict";
import test from "node:test";
import { faviconSvg, faviconTitle } from "./favicon.js";

test("n'ajoute aucune pastille sans message non lu", () => {
  const svg = faviconSvg(0);
  assert.doesNotMatch(svg, /<circle/);
  assert.match(svg, /<svg[^>]*viewBox="0 0 64 64"/);
});

test("pose la pastille dès le premier message", () => {
  const svg = faviconSvg(1);
  // Deux disques : le liseré sombre qui détache, puis la pastille rouge.
  assert.equal(svg.match(/<circle/g)?.length, 2);
  assert.match(svg, /#e8756a/);
});

test("la pastille ne dépend pas du nombre de messages", () => {
  // Une icône de 16 pixels ne peut pas porter de chiffre : c'est le titre qui
  // compte, la pastille ne fait que signaler.
  assert.equal(faviconSvg(1), faviconSvg(42));
});

test("le SVG reste bien formé pour être posé en data:", () => {
  for (const unread of [0, 3]) {
    const svg = faviconSvg(unread);
    assert.ok(svg.startsWith("<svg"), "doit commencer par la balise racine");
    assert.ok(svg.endsWith("</svg>"), "doit être fermé");
    assert.doesNotMatch(svg, /\n/, "une seule ligne : le SVG part dans une URL");
  }
});

test("le titre reste nu sans message", () => {
  assert.equal(faviconTitle(0), "MaxouJeux");
  assert.equal(faviconTitle(-1), "MaxouJeux");
});

test("le titre porte le compte", () => {
  assert.equal(faviconTitle(1), "(1) MaxouJeux");
  assert.equal(faviconTitle(12), "(12) MaxouJeux");
});

test("le titre plafonne à 99+", () => {
  // Au-delà, le compte exact n'apprend plus rien et pousse le nom du site hors
  // de la largeur visible d'un onglet.
  assert.equal(faviconTitle(99), "(99) MaxouJeux");
  assert.equal(faviconTitle(100), "(99+) MaxouJeux");
  assert.equal(faviconTitle(4_000), "(99+) MaxouJeux");
});
