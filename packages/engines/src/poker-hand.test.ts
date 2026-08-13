import { describe, expect, it } from "vitest";
import {
  POKER_RANKS,
  POKER_SUITS,
  comparePokerHands,
  createPokerDeck,
  evaluateFive,
  evaluateSeven,
  type PokerEngineCard,
} from "./poker-hand.js";

/** « As de pique » s'écrit `As`, « dix de cœur » `10h` : les tests restent lisibles. */
function main(...notations: string[]): PokerEngineCard[] {
  return notations.map((notation) => {
    const rang = notation.slice(0, -1) as (typeof POKER_RANKS)[number];
    const lettre = notation.slice(-1);
    const suit = { t: "clubs", k: "diamonds", c: "hearts", p: "spades" }[lettre];
    if (!suit || !POKER_RANKS.includes(rang)) throw new Error(`Carte illisible : ${notation}`);
    return { rank: rang, suit: suit as (typeof POKER_SUITS)[number] };
  });
}

const categorie = (...notations: string[]) => evaluateFive(main(...notations)).category;
const score = (...notations: string[]) => evaluateFive(main(...notations)).score;

describe("catégories", () => {
  it("reconnaît les neuf catégories", () => {
    expect(categorie("Ap", "Kp", "Qp", "Jp", "10p")).toBe("quinte-flush");
    expect(categorie("9p", "9t", "9c", "9k", "2p")).toBe("carre");
    expect(categorie("9p", "9t", "9c", "2k", "2p")).toBe("full");
    expect(categorie("Ap", "9p", "7p", "4p", "2p")).toBe("couleur");
    expect(categorie("9p", "8t", "7c", "6k", "5p")).toBe("suite");
    expect(categorie("9p", "9t", "9c", "5k", "2p")).toBe("brelan");
    expect(categorie("9p", "9t", "5c", "5k", "2p")).toBe("double-paire");
    expect(categorie("9p", "9t", "7c", "5k", "2p")).toBe("paire");
    expect(categorie("Ap", "Jt", "9c", "5k", "2p")).toBe("carte-haute");
  });

  it("classe la quinte flush royale comme une quinte flush à l'as", () => {
    // Une catégorie « royale » séparée casserait la comparaison : c'est la même
    // main, avec le rang le plus haut possible.
    const royale = evaluateFive(main("Ap", "Kp", "Qp", "Jp", "10p"));
    const autre = evaluateFive(main("9t", "8t", "7t", "6t", "5t"));
    expect(royale.category).toBe("quinte-flush");
    expect(royale.score).toBeGreaterThan(autre.score);
  });
});

describe("la roue A-2-3-4-5", () => {
  it("est une suite, la plus faible de toutes", () => {
    expect(categorie("Ap", "2t", "3c", "4k", "5p")).toBe("suite");
    expect(score("Ap", "2t", "3c", "4k", "5p")).toBeLessThan(score("2p", "3t", "4c", "5k", "6p"));
  });

  it("ne bat pas un brelan d'as", () => {
    // Le piège : traiter l'as comme rang haut ferait de la roue la suite la
    // plus forte, et elle passerait devant tout ce qui la précède.
    expect(score("Ap", "2t", "3c", "4k", "5p")).toBeGreaterThan(score("Ap", "At", "Ac", "Kk", "Qp"));
    expect(score("6p", "5t", "4c", "3k", "2p")).toBeGreaterThan(score("Ap", "2t", "3c", "4k", "5p"));
  });

  it("existe aussi en quinte flush", () => {
    expect(categorie("Ap", "2p", "3p", "4p", "5p")).toBe("quinte-flush");
    expect(score("Ap", "2p", "3p", "4p", "5p")).toBeLessThan(score("6p", "5p", "4p", "3p", "2p"));
  });
});

describe("départages", () => {
  it("départage un carré sur son kicker", () => {
    expect(score("9p", "9t", "9c", "9k", "Ap")).toBeGreaterThan(score("9p", "9t", "9c", "9k", "Kp"));
  });

  it("départage un full sur le brelan avant la paire", () => {
    // Full aux neuf par les deux bat full aux huit par les as : c'est le brelan
    // qui commande, jamais la paire.
    expect(score("9p", "9t", "9c", "2k", "2p")).toBeGreaterThan(score("8p", "8t", "8c", "Ak", "Ap"));
  });

  it("départage un brelan sur ses deux kickers", () => {
    expect(score("9p", "9t", "9c", "Ak", "2p")).toBeGreaterThan(score("9p", "9t", "9c", "Kk", "Qp"));
    expect(score("9p", "9t", "9c", "Ak", "5p")).toBeGreaterThan(score("9p", "9t", "9c", "Ak", "4p"));
  });

  it("départage une double paire sur la haute, puis la basse, puis le kicker", () => {
    expect(score("Kp", "Kt", "2c", "2k", "3p")).toBeGreaterThan(score("Qp", "Qt", "Jc", "Jk", "Ap"));
    expect(score("Kp", "Kt", "5c", "5k", "3p")).toBeGreaterThan(score("Kp", "Kt", "4c", "4k", "Ap"));
    expect(score("Kp", "Kt", "5c", "5k", "Ap")).toBeGreaterThan(score("Kp", "Kt", "5c", "5k", "Qp"));
  });

  it("départage une couleur carte par carte", () => {
    expect(score("Ap", "9p", "7p", "4p", "2p")).toBeGreaterThan(score("Kp", "Qp", "Jp", "9p", "7p"));
    expect(score("Ap", "9p", "7p", "4p", "3p")).toBeGreaterThan(score("Ap", "9p", "7p", "4p", "2p"));
  });

  it("rend le même score à deux mains strictement à égalité", () => {
    // Indispensable au partage d'un pot : l'égalité doit être exacte, pas
    // « à peu près ».
    expect(score("Ap", "Kt", "9c", "5k", "3p")).toBe(score("At", "Kp", "9k", "5c", "3t"));
    expect(comparePokerHands(evaluateFive(main("Ap", "Kt", "9c", "5k", "3p")), evaluateFive(main("At", "Kp", "9k", "5c", "3t")))).toBe(0);
  });

  it("fait primer la couleur sur la suite", () => {
    expect(score("Ap", "9p", "7p", "4p", "2p")).toBeGreaterThan(score("9p", "8t", "7c", "6k", "5p"));
  });
});

describe("sept cartes", () => {
  it("retient la meilleure combinaison de cinq", () => {
    // Deux paires au tableau, mais la main fait un full.
    const rang = evaluateSeven(main("9p", "9t", "5c", "5k", "2p", "9c", "3t"));
    expect(rang.category).toBe("full");
    expect(rang.cards).toHaveLength(5);
  });

  it("voit une couleur du tableau battue par une carte plus haute en main", () => {
    // Couleur complète au tableau : celui qui tient un pique plus haut la
    // surpasse, les autres se contentent du tableau.
    const tableau = ["Kp", "9p", "7p", "4p", "2p"];
    const avecAs = evaluateSeven(main(...tableau, "Ap", "3t"));
    const sansAs = evaluateSeven(main(...tableau, "3t", "2c"));
    expect(avecAs.category).toBe("couleur");
    expect(sansAs.category).toBe("couleur");
    expect(avecAs.score).toBeGreaterThan(sansAs.score);
    // Sans pique en main, on joue exactement le tableau.
    expect(sansAs.score).toBe(evaluateFive(main(...tableau)).score);
  });

  it("joue le tableau quand la main n'apporte rien", () => {
    const tableau = ["Ap", "Kp", "Qp", "Jp", "10p"];
    const a = evaluateSeven(main(...tableau, "2c", "3t"));
    const b = evaluateSeven(main(...tableau, "7c", "8t"));
    expect(a.category).toBe("quinte-flush");
    expect(a.score).toBe(b.score);
  });

  it("refuse une main trop courte", () => {
    expect(() => evaluateSeven(main("Ap", "Kp", "Qp", "Jp"))).toThrow();
  });
});

describe("balayage exhaustif des 2 598 960 mains de cinq cartes", () => {
  /**
   * Le filet de sécurité de tout le jeu.
   *
   * Les effectifs par catégorie et le nombre de classes d'équivalence sont des
   * constantes combinatoires connues : aucune implémentation fausse ne tombe
   * dessus par hasard. Une erreur de départage, un rang oublié ou une roue mal
   * traitée déplacent immédiatement l'un de ces nombres.
   */
  it("retrouve les effectifs connus et les 7 462 mains distinctes", () => {
    const paquet: PokerEngineCard[] = [];
    for (const suit of POKER_SUITS) {
      for (const rank of POKER_RANKS) paquet.push({ rank, suit });
    }

    const effectifs = new Map<string, number>();
    const scores = new Set<number>();
    let total = 0;

    for (let a = 0; a < 48; a += 1)
      for (let b = a + 1; b < 49; b += 1)
        for (let c = b + 1; c < 50; c += 1)
          for (let d = c + 1; d < 51; d += 1)
            for (let e = d + 1; e < 52; e += 1) {
              const rang = evaluateFive([
                paquet[a] as PokerEngineCard,
                paquet[b] as PokerEngineCard,
                paquet[c] as PokerEngineCard,
                paquet[d] as PokerEngineCard,
                paquet[e] as PokerEngineCard,
              ]);
              effectifs.set(rang.category, (effectifs.get(rang.category) ?? 0) + 1);
              scores.add(rang.score);
              total += 1;
            }

    expect(total).toBe(2_598_960);
    expect(effectifs.get("quinte-flush")).toBe(40);
    expect(effectifs.get("carre")).toBe(624);
    expect(effectifs.get("full")).toBe(3_744);
    expect(effectifs.get("couleur")).toBe(5_108);
    expect(effectifs.get("suite")).toBe(10_200);
    expect(effectifs.get("brelan")).toBe(54_912);
    expect(effectifs.get("double-paire")).toBe(123_552);
    expect(effectifs.get("paire")).toBe(1_098_240);
    expect(effectifs.get("carte-haute")).toBe(1_302_540);
    expect(scores.size).toBe(7_462);
  }, 120_000);
});

describe("sept cartes, contrôle croisé", () => {
  it("égale toujours le maximum des vingt et une combinaisons", () => {
    // Générateur reproductible : ce test ne peut pas devenir instable.
    let graine = 20_260_813;
    const aleatoire = (borne: number) => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return Math.floor((graine / 2147483648) * borne);
    };

    for (let essai = 0; essai < 3_000; essai += 1) {
      const sept = createPokerDeck(aleatoire).slice(0, 7);
      let attendu = -1;
      for (let a = 0; a < 3; a += 1)
        for (let b = a + 1; b < 4; b += 1)
          for (let c = b + 1; c < 5; c += 1)
            for (let d = c + 1; d < 6; d += 1)
              for (let e = d + 1; e < 7; e += 1) {
                const cinq = [sept[a], sept[b], sept[c], sept[d], sept[e]] as PokerEngineCard[];
                attendu = Math.max(attendu, evaluateFive(cinq).score);
              }
      expect(evaluateSeven(sept).score).toBe(attendu);
    }
  }, 60_000);
});

describe("jeu de cartes", () => {
  it("compte cinquante-deux cartes toutes différentes", () => {
    const paquet = createPokerDeck(() => 0);
    expect(paquet).toHaveLength(52);
    expect(new Set(paquet.map((c) => `${c.rank}${c.suit}`)).size).toBe(52);
  });

  it("mélange réellement", () => {
    let graine = 7;
    const aleatoire = (borne: number) => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return graine % borne;
    };
    const a = createPokerDeck(aleatoire).map((c) => `${c.rank}${c.suit}`);
    const b = createPokerDeck(aleatoire).map((c) => `${c.rank}${c.suit}`);
    expect(a).not.toEqual(b);
  });
});
