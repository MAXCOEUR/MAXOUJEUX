import assert from "node:assert/strict";
import test from "node:test";
import { markAvatarImage } from "@maxoujeux/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar } from "./Avatar.js";
import { parseRoute, routePath } from "@/lib/route";

const ID = "11111111-1111-4111-8111-111111111111";

function rendre(seed: string): string {
  return renderToStaticMarkup(<Avatar userId={ID} seed={seed} pseudo="Alice" />);
}

test("une graine héritée ne déclenche aucune requête d'image", () => {
  const html = rendre("d4f8a1b2c3d4e5f6");

  // Le jeton dit lui-même qu'il n'y a pas d'image : aucun 404 à provoquer.
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Alice/);
});

test("une graine porteuse d'image pointe une URL versionnée", () => {
  const html = rendre(markAvatarImage("abcd1234"));

  assert.match(html, new RegExp(`/api/users/${ID}/avatar\\?v=abcd1234`));
  // Le dessin procédural reste peint dessous : il sert de repli permanent.
  assert.match(html, /Alice/);
});

test("l'espace Mon compte a une adresse propre", () => {
  assert.equal(routePath({ name: "compte" }), "/mon-compte");
  assert.deepEqual(parseRoute("/mon-compte"), { name: "compte" });
  // Toute adresse inconnue retombe sur le lobby, y compris une sous-adresse.
  assert.deepEqual(parseRoute("/mon-compte/xxx"), { name: "lobby" });
});
