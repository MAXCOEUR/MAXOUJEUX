import { describe, expect, it } from "vitest";
import { buildDictionary, renderDictionarySql } from "../../../scripts/build-motus-dictionary.js";

const header = [
  "1_Mot",
  "2_Phono",
  "3_Phono_IPA",
  "4_Lemme",
  "5_Cgram",
  "6_CgramOrtho",
  "7_Genre",
  "8_Nombre",
  "9_InfoVER",
  "10_FreqMot",
  "11_FreqOrtho",
  "12_FreqLemme",
  "13_CDOrtho",
  "14_IsLem",
  "15_NbLettres",
].join("\t");

function row(word: string, category: string, frequency: number, isLemma: boolean): string {
  return [
    word,
    "",
    "",
    word,
    category,
    category,
    "",
    "",
    "",
    String(frequency),
    "",
    "",
    "",
    isLemma ? "1" : "0",
    String(word.length),
  ].join("\t");
}

describe("construction du dictionnaire Motus", () => {
  it("normalise les formes jouables et réserve les solutions aux lemmes fréquents", () => {
    const tsv = [
      header,
      row("école", "NOM", 12, true),
      row("écoles", "NOM", 9, false),
      row("rarete", "NOM", 0.4, true),
      row("arc-en-ciel", "NOM", 20, true),
      row("abcd", "NOM", 20, true),
    ].join("\n");

    expect(buildDictionary(tsv, "")).toEqual([
      { word: "ECOLE", length: 5, isSolution: true },
      { word: "ECOLES", length: 6, isSolution: false },
      { word: "RARETE", length: 6, isSolution: false },
    ]);
  });

  it("garde un mot familial comme essai mais jamais comme solution", () => {
    const tsv = [header, row("vilain", "ADJ", 8, true)].join("\n");
    expect(buildDictionary(tsv, "vilain\n")).toEqual([
      { word: "VILAIN", length: 6, isSolution: false },
    ]);
  });

  it("rend un SQL idempotent par lots", () => {
    const sql = renderDictionarySql([
      { word: "ECOLE", length: 5, isSolution: true },
      { word: "RARETE", length: 6, isSolution: false },
    ]);

    expect(sql).toContain("INSERT INTO \"motus_words\"");
    expect(sql).toContain("('ECOLE', 5, true, true)");
    expect(sql).toContain("ON CONFLICT (\"word\") DO UPDATE");
  });
});
