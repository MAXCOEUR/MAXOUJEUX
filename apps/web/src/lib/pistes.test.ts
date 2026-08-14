import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { MUSIC_ZONES, parseManifest, type MusicZone } from "./musique.js";

/**
 * Le manifeste face au disque.
 *
 * `pistes.json` est écrit à la main, et une faute de frappe s'y traduit par un
 * silence : la piste déclarée renvoie un 404, le lecteur passe à la suivante, et
 * personne ne sait pourquoi la zone est muette. Autant que ça échoue ici.
 *
 * Ce test lit les vrais fichiers du dépôt. Il ne s'applique donc qu'à
 * l'installation courante, ce qui est précisément l'intérêt.
 */

const RACINE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/sons/musique",
);

const MANIFESTE = path.join(RACINE, "pistes.json");

/** Les fichiers audio réellement présents dans une zone. */
function fichiersDe(zone: MusicZone): string[] {
  const dossier = path.join(RACINE, zone);
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier).filter((nom) => nom.toLowerCase().endsWith(".mp3"));
}

function manifeste() {
  return parseManifest(JSON.parse(readFileSync(MANIFESTE, "utf8")));
}

test("le manifeste existe et se relit", () => {
  assert.ok(existsSync(MANIFESTE), "pistes.json est absent : il n'y aurait aucune musique");
  assert.ok(Object.keys(manifeste()).length > 0, "aucune zone déclarée");
});

test("chaque piste déclarée existe sur le disque", () => {
  for (const [zone, pistes] of Object.entries(manifeste())) {
    for (const piste of pistes ?? []) {
      assert.ok(
        existsSync(path.join(RACINE, zone, piste)),
        `« ${zone}/${piste} » est déclaré mais introuvable`,
      );
    }
  }
});

test("chaque fichier présent est déclaré", () => {
  // L'oubli inverse est le plus fréquent : on dépose un morceau et on ne pense
  // pas au manifeste. Le fichier reste alors inaudible sans le moindre signe.
  const declare = manifeste();
  for (const zone of MUSIC_ZONES) {
    for (const fichier of fichiersDe(zone)) {
      assert.ok(
        declare[zone]?.includes(fichier),
        `« ${zone}/${fichier} » est présent mais absent de pistes.json`,
      );
    }
  }
});

test("chaque zone déclarée l'est pour une zone connue", () => {
  const brut = JSON.parse(readFileSync(MANIFESTE, "utf8")) as Record<string, unknown>;
  for (const zone of Object.keys(brut)) {
    assert.ok(
      (MUSIC_ZONES as readonly string[]).includes(zone),
      `« ${zone} » n'est pas une zone : cette entrée est ignorée en silence`,
    );
  }
});

test("le lobby a au moins une piste", () => {
  // C'est la zone de repli de toutes les autres : sans elle, un jeu sans musique
  // propre reste muet au lieu de retomber sur l'ambiance générale.
  assert.ok((manifeste().lobby ?? []).length > 0, "aucune piste de lobby");
});
