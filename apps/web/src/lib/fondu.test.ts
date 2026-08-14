import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fade, isFading, stopFade, type Fadable } from "./musique.js";

/**
 * Le fondu enchaîné, sous minuterie contrôlée.
 *
 * Ce fichier existe à cause d'un bug précis : une **seule** minuterie était
 * partagée par tous les fondus. Un fondu enchaîné en lance deux de front — l'un
 * qui monte, l'autre qui descend — et le second annulait le premier. La suite du
 * fondu annulé, celle qui met la piste sortante en pause, n'était jamais
 * exécutée : la musique du lobby continuait indéfiniment, insensible au volume
 * comme à la coupure, et chaque changement d'écran en empilait une de plus.
 */

/** Une piste réduite à ce dont le fondu a besoin. */
function piste(volume: number): Fadable {
  return { volume };
}

/** Assez de temps pour qu'un fondu de 800 ms aille à son terme. */
const APRES_LE_FONDU = 1_000;

test("mène un fondu jusqu'à sa valeur d'arrivée", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const element = piste(0);

  fade(element, 1);
  t.mock.timers.tick(APRES_LE_FONDU);

  assert.equal(element.volume, 1);
  assert.equal(isFading(element), false, "la minuterie doit être libérée à l'arrivée");
});

test("exécute la suite une fois le fondu terminé", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const element = piste(1);
  let coupee = false;

  fade(element, 0, () => {
    coupee = true;
  });
  t.mock.timers.tick(APRES_LE_FONDU);

  assert.equal(element.volume, 0);
  assert.equal(coupee, true);
});

test("deux fondus simultanés aboutissent tous les deux", (t) => {
  // Le cœur du bug : c'est exactement ce que fait un changement de zone.
  t.mock.timers.enable({ apis: ["setInterval"] });
  const sortante = piste(1);
  const entrante = piste(0);
  let sortanteCoupee = false;

  fade(sortante, 0, () => {
    sortanteCoupee = true;
  });
  fade(entrante, 0.6);

  t.mock.timers.tick(APRES_LE_FONDU);

  assert.equal(sortante.volume, 0);
  assert.equal(entrante.volume, 0.6);
  assert.equal(sortanteCoupee, true, "la piste sortante doit avoir été coupée");
});

test("relancer un fondu sur le même élément remplace le précédent", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const element = piste(0);
  let premiereSuite = 0;

  fade(element, 1, () => {
    premiereSuite += 1;
  });
  // Changement d'avis en cours de route : le premier fondu ne doit pas
  // ressusciter ensuite pour ramener le volume qu'on vient de quitter.
  fade(element, 0.2);

  t.mock.timers.tick(APRES_LE_FONDU);

  assert.equal(element.volume, 0.2);
  assert.equal(premiereSuite, 0, "la suite du fondu remplacé ne doit pas s'exécuter");
});

test("interrompre un fondu fige le volume et n'exécute pas la suite", (t) => {
  // C'est ce que fait un geste du joueur sur le curseur : il prime sur la
  // transition automatique en cours.
  t.mock.timers.enable({ apis: ["setInterval"] });
  const element = piste(1);
  let coupee = false;

  fade(element, 0, () => {
    coupee = true;
  });
  t.mock.timers.tick(200);
  stopFade(element);
  const fige = element.volume;
  t.mock.timers.tick(APRES_LE_FONDU);

  assert.equal(element.volume, fige, "le volume ne doit plus bouger après l'interruption");
  assert.equal(coupee, false);
  assert.equal(isFading(element), false);
});

test("interrompre un fondu ne touche pas à celui d'un autre élément", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const a = piste(0);
  const b = piste(0);

  fade(a, 1);
  fade(b, 1);
  stopFade(a);
  t.mock.timers.tick(APRES_LE_FONDU);

  assert.notEqual(a.volume, 1, "le fondu de a devait être interrompu");
  assert.equal(b.volume, 1, "celui de b devait aller à son terme");
});

mock.timers.reset();
