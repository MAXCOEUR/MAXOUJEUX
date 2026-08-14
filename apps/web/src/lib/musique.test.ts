import assert from "node:assert/strict";
import test from "node:test";
import { GAME_CODES } from "@maxoujeux/shared";
import {
  MUSIC_ZONES,
  melanger,
  parseManifest,
  tracksFor,
  trackUrl,
  zoneForRoute,
} from "./musique.js";

// --- Zones -----------------------------------------------------------------

test("les écrans hors jeu partagent l'ambiance du lobby", () => {
  // Le lobby, les classements, les succès, un profil et « mon compte » sont les
  // couloirs du casino : ils n'ont pas à changer de musique entre eux.
  assert.equal(zoneForRoute({ name: "lobby" }, null), "lobby");
  assert.equal(zoneForRoute({ name: "classement" }, null), "lobby");
  assert.equal(zoneForRoute({ name: "succes" }, null), "lobby");
  assert.equal(zoneForRoute({ name: "profil", pseudo: "maxou" }, null), "lobby");
  assert.equal(zoneForRoute({ name: "compte" }, null), "lobby");
});

test("un salon prend déjà la zone de son jeu", () => {
  // La musique change en entrant dans le salon, pas en s'asseyant : c'est là
  // qu'on change d'univers.
  assert.equal(zoneForRoute({ name: "salon", game: "poker" }, null), "poker");
  assert.equal(zoneForRoute({ name: "salon", game: "plinko" }, null), "plinko");
});

test("une table suit le jeu réellement en cours", () => {
  assert.equal(zoneForRoute({ name: "table", tableId: "x" }, "blackjack"), "blackjack");
  assert.equal(zoneForRoute({ name: "table", tableId: "x" }, "motus"), "motus");
});

test("une table dont le jeu n'est pas encore connu reste au lobby", () => {
  // L'état de la table arrive après la navigation : mieux vaut l'ambiance
  // générale qu'un silence le temps de l'aller-retour.
  assert.equal(zoneForRoute({ name: "table", tableId: "x" }, null), "lobby");
});

test("chaque jeu du catalogue a sa zone", () => {
  for (const game of GAME_CODES) {
    assert.ok(MUSIC_ZONES.includes(game), `${game} n'a pas de zone musicale`);
  }
});

// --- Manifeste --------------------------------------------------------------

test("un manifeste absent ne déclare aucune piste", () => {
  assert.deepEqual(parseManifest(null), {});
  assert.deepEqual(parseManifest(undefined), {});
  assert.deepEqual(parseManifest("pas un objet"), {});
});

test("relit les zones déclarées", () => {
  const manifest = parseManifest({
    lobby: ["nuit-bleue.mp3", "feutre.mp3"],
    poker: ["tapis-vert.mp3"],
  });

  assert.deepEqual(manifest.lobby, ["nuit-bleue.mp3", "feutre.mp3"]);
  assert.deepEqual(manifest.poker, ["tapis-vert.mp3"]);
});

test("écarte ce qui n'est pas une zone connue", () => {
  // Une faute de frappe dans le manifeste ne doit pas créer une zone fantôme.
  const manifest = parseManifest({ lobbi: ["x.mp3"], poker: ["ok.mp3"] });

  assert.equal(Object.keys(manifest).length, 1);
  assert.deepEqual(manifest.poker, ["ok.mp3"]);
});

test("écarte les entrées qui ne sont pas des noms de fichiers", () => {
  const manifest = parseManifest({ lobby: ["bon.mp3", 42, null, "", "  ", "autre.mp3"] });
  assert.deepEqual(manifest.lobby, ["bon.mp3", "autre.mp3"]);
});

test("une zone déclarée vide n'est pas retenue", () => {
  assert.deepEqual(parseManifest({ lobby: [] }), {});
});

// --- Résolution des pistes --------------------------------------------------

test("une zone garnie joue ses propres pistes", () => {
  const manifest = { lobby: ["a.mp3"], poker: ["b.mp3", "c.mp3"] };
  assert.deepEqual(tracksFor(manifest, "poker"), ["b.mp3", "c.mp3"]);
});

test("une zone sans piste retombe sur le lobby", () => {
  // C'est ce qui permet de démarrer avec deux ou trois morceaux sans devoir en
  // trouver un par jeu.
  const manifest = { lobby: ["a.mp3"] };
  assert.deepEqual(tracksFor(manifest, "roulette"), ["a.mp3"]);
});

test("sans lobby ni zone propre, il n'y a rien à jouer", () => {
  assert.deepEqual(tracksFor({ poker: ["b.mp3"] }, "motus"), []);
});

test("le chemin d'une piste tient compte de sa zone", () => {
  assert.equal(trackUrl("poker", "tapis vert.mp3"), "/sons/musique/poker/tapis%20vert.mp3");
});

// --- File d'attente ---------------------------------------------------------

test("le mélange conserve toutes les pistes, sans doublon", () => {
  // C'est ce qui garantit qu'on entend toute la zone avant de réentendre un
  // morceau, plutôt qu'un tirage au sort qui répéterait le même deux fois.
  const pistes = ["a", "b", "c", "d", "e"];
  const melange = melanger(pistes);

  assert.equal(melange.length, pistes.length);
  assert.deepEqual([...melange].sort(), [...pistes].sort());
});

test("le mélange ne touche pas à la liste d'origine", () => {
  const pistes = ["a", "b", "c"];
  melanger(pistes);
  assert.deepEqual(pistes, ["a", "b", "c"]);
});
