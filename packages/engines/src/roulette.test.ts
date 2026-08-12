import { describe, expect, it } from "vitest";
import { ROULETTE_OUTSIDE, spotKey, type RouletteSpot } from "@maxoujeux/shared";
import {
  ROULETTE_POCKETS,
  ROULETTE_WHEEL,
  covers,
  pocketIndex,
  rouletteColor,
  roulettePayout,
  spinRoulette,
} from "./roulette.js";

const plein = (number: number): RouletteSpot => ({ kind: "straight", number });

describe("cylindre", () => {
  it("porte trente-sept cases, toutes distinctes, de 0 à 36", () => {
    expect(ROULETTE_POCKETS).toBe(37);
    expect(new Set(ROULETTE_WHEEL).size).toBe(37);
    expect([...ROULETTE_WHEEL].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 37 }, (_, index) => index),
    );
  });

  it("compte dix-huit rouges, dix-huit noirs et un zéro vert", () => {
    const parCouleur = { red: 0, black: 0, green: 0 };
    for (const pocket of ROULETTE_WHEEL) parCouleur[rouletteColor(pocket)] += 1;
    expect(parCouleur).toEqual({ red: 18, black: 18, green: 1 });
  });

  it("alterne les couleurs autour du cylindre", () => {
    // La propriété qui distingue un vrai cylindre d'une liste rangée : hors
    // zéro, deux cases voisines ne sont jamais de la même couleur.
    for (let index = 0; index < ROULETTE_POCKETS; index += 1) {
      const ici = ROULETTE_WHEEL[index]!;
      const apres = ROULETTE_WHEEL[(index + 1) % ROULETTE_POCKETS]!;
      if (ici === 0 || apres === 0) continue;
      expect(rouletteColor(ici)).not.toBe(rouletteColor(apres));
    }
  });

  it("situe chaque numéro à une position unique", () => {
    expect(pocketIndex(0)).toBe(0);
    expect(pocketIndex(26)).toBe(36);
    expect(() => pocketIndex(37)).toThrow();
  });
});

describe("couverture des cases", () => {
  it("un plein ne couvre que son numéro", () => {
    expect(covers(plein(17), 17)).toBe(true);
    expect(covers(plein(17), 18)).toBe(false);
    expect(covers(plein(0), 0)).toBe(true);
  });

  it("le zéro fait tout perdre, sauf le plein sur zéro", () => {
    // Deux pièges classiques : 0 est pair, et 0 est inférieur à 18. Les laisser
    // gagner supprimerait purement et simplement l'avantage de la maison.
    for (const kind of ROULETTE_OUTSIDE) {
      expect(covers({ kind }, 0), `${kind} ne doit pas couvrir le zéro`).toBe(false);
    }
    expect(covers(plein(0), 0)).toBe(true);
  });

  it("distingue les couleurs", () => {
    expect(covers({ kind: "red" }, 32)).toBe(true);
    expect(covers({ kind: "black" }, 32)).toBe(false);
    expect(covers({ kind: "black" }, 26)).toBe(true);
  });

  it("distingue pair, impair, manque et passe", () => {
    expect(covers({ kind: "even" }, 18)).toBe(true);
    expect(covers({ kind: "odd" }, 18)).toBe(false);
    expect(covers({ kind: "low" }, 18)).toBe(true);
    expect(covers({ kind: "high" }, 18)).toBe(false);
    expect(covers({ kind: "high" }, 19)).toBe(true);
  });

  it("découpe les douzaines aux bonnes bornes", () => {
    expect(covers({ kind: "dozen1" }, 1)).toBe(true);
    expect(covers({ kind: "dozen1" }, 12)).toBe(true);
    expect(covers({ kind: "dozen2" }, 12)).toBe(false);
    expect(covers({ kind: "dozen2" }, 13)).toBe(true);
    expect(covers({ kind: "dozen3" }, 36)).toBe(true);
  });

  it("découpe les colonnes de trois en trois", () => {
    expect(covers({ kind: "column1" }, 1)).toBe(true);
    expect(covers({ kind: "column2" }, 2)).toBe(true);
    expect(covers({ kind: "column3" }, 3)).toBe(true);
    expect(covers({ kind: "column3" }, 36)).toBe(true);
    expect(covers({ kind: "column1" }, 3)).toBe(false);
  });

  it("chaque numéro non nul appartient à exactement une douzaine et une colonne", () => {
    for (let value = 1; value <= 36; value += 1) {
      const douzaines = (["dozen1", "dozen2", "dozen3"] as const).filter((kind) =>
        covers({ kind }, value),
      );
      const colonnes = (["column1", "column2", "column3"] as const).filter((kind) =>
        covers({ kind }, value),
      );
      expect(douzaines, `douzaine de ${value}`).toHaveLength(1);
      expect(colonnes, `colonne de ${value}`).toHaveLength(1);
    }
  });
});

describe("versements", () => {
  it("rend la mise comprise, selon le rapport de la case", () => {
    expect(roulettePayout(plein(17), 100, 17)).toBe(3_600);
    expect(roulettePayout({ kind: "dozen2" }, 100, 13)).toBe(300);
    expect(roulettePayout({ kind: "column1" }, 100, 1)).toBe(300);
    expect(roulettePayout({ kind: "red" }, 100, 32)).toBe(200);
  });

  it("ne rend rien sur une case perdante", () => {
    expect(roulettePayout(plein(17), 100, 18)).toBe(0);
    expect(roulettePayout({ kind: "red" }, 100, 0)).toBe(0);
  });

  it("l'espérance de la maison est bien celle d'un cylindre à un zéro", () => {
    // Sur les 37 numéros, une mise de 1 sur rouge rend 2 dix-huit fois : 36 pour
    // 37 misés. Si ce total valait 37, le jeu serait équitable — et le zéro ne
    // servirait plus à rien.
    let rendu = 0;
    for (const pocket of ROULETTE_WHEEL) rendu += roulettePayout({ kind: "red" }, 1, pocket);
    expect(rendu).toBe(36);

    let renduPlein = 0;
    for (const pocket of ROULETTE_WHEEL) renduPlein += roulettePayout(plein(17), 1, pocket);
    expect(renduPlein).toBe(36);
  });
});

describe("tirage", () => {
  it("rend la case désignée par l'aléa fourni", () => {
    expect(spinRoulette(() => 0)).toBe(0);
    expect(spinRoulette(() => 1)).toBe(32);
    expect(spinRoulette(() => 36)).toBe(26);
  });

  it("borne son tirage au nombre de cases", () => {
    const demandes: number[] = [];
    spinRoulette((maximum) => {
      demandes.push(maximum);
      return 0;
    });
    expect(demandes).toEqual([37]);
  });

  it("peut atteindre les trente-sept cases", () => {
    const vus = new Set<number>();
    for (let index = 0; index < ROULETTE_POCKETS; index += 1) vus.add(spinRoulette(() => index));
    expect(vus.size).toBe(37);
  });
});

describe("clé de case", () => {
  it("distingue chaque case et reste stable", () => {
    expect(spotKey(plein(0))).toBe("straight:0");
    expect(spotKey(plein(17))).toBe("straight:17");
    expect(spotKey({ kind: "red" })).toBe("red");

    const toutes = [
      ...Array.from({ length: 37 }, (_, n) => spotKey(plein(n))),
      ...ROULETTE_OUTSIDE.map((kind) => spotKey({ kind })),
    ];
    expect(new Set(toutes).size).toBe(49);
  });
});
