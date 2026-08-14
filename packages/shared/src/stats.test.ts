import { describe, expect, it } from "vitest";
import {
  compareMotusPerformance,
  formatChrono,
  formatRank,
  formatRendement,
  periodRange,
} from "./stats.js";

/** Un instant précis, exprimé en heure de Paris. */
function paris(iso: string): Date {
  return new Date(iso);
}

describe("bornes des périodes", () => {
  // Mercredi 12 août 2026, 14 h à Paris (UTC+2 en été).
  const mercredi = paris("2026-08-12T12:00:00Z");

  it("réduit la journée à un seul jour", () => {
    expect(periodRange("day", mercredi)).toEqual({ from: "2026-08-12", to: "2026-08-12" });
  });

  it("fait commencer la semaine le lundi", () => {
    expect(periodRange("week", mercredi)).toEqual({ from: "2026-08-10", to: "2026-08-12" });
  });

  it("garde un lundi entier dans sa propre semaine", () => {
    const lundi = paris("2026-08-10T12:00:00Z");
    expect(periodRange("week", lundi)).toEqual({ from: "2026-08-10", to: "2026-08-10" });
  });

  it("place le dimanche en fin de semaine, et non au début", () => {
    const dimanche = paris("2026-08-16T12:00:00Z");
    expect(periodRange("week", dimanche)).toEqual({ from: "2026-08-10", to: "2026-08-16" });
  });

  it("arrête le mois et l'année au jour courant", () => {
    expect(periodRange("month", mercredi)).toEqual({ from: "2026-08-01", to: "2026-08-12" });
    expect(periodRange("year", mercredi)).toEqual({ from: "2026-01-01", to: "2026-08-12" });
  });

  it("exprime « depuis toujours » comme un intervalle, pour n'avoir qu'une requête", () => {
    expect(periodRange("all", mercredi)).toEqual({ from: "1970-01-01", to: "2026-08-12" });
  });

  /**
   * Le fuseau se joue à la frontière de minuit : 23 h 30 UTC un 11 août, il est
   * déjà 1 h 30 le 12 à Paris. Une borne calculée en UTC daterait la manche de
   * la veille et la ferait disparaître du classement du jour.
   */
  it("bascule de jour à minuit heure de Paris, pas à minuit UTC", () => {
    const apresMinuitParis = paris("2026-08-11T23:30:00Z");
    expect(periodRange("day", apresMinuitParis)).toEqual({
      from: "2026-08-12",
      to: "2026-08-12",
    });
  });

  it("tient au changement d'heure d'hiver", () => {
    // 25 octobre 2026, 23 h 30 UTC : Paris est repassé à UTC+1, on est le 26.
    const hiver = paris("2026-10-25T23:30:00Z");
    expect(periodRange("day", hiver)).toEqual({ from: "2026-10-26", to: "2026-10-26" });
    // Le 26 octobre 2026 est un lundi : la semaine commence ce jour-là.
    expect(periodRange("week", hiver)).toEqual({ from: "2026-10-26", to: "2026-10-26" });
  });

  it("tient au passage d'une année sur l'autre", () => {
    const premierJanvier = paris("2027-01-01T10:00:00Z");
    expect(periodRange("year", premierJanvier)).toEqual({
      from: "2027-01-01",
      to: "2027-01-01",
    });
    expect(periodRange("month", premierJanvier)).toEqual({
      from: "2027-01-01",
      to: "2027-01-01",
    });
    // Le 1er janvier 2027 est un vendredi : la semaine déborde sur décembre.
    expect(periodRange("week", premierJanvier)).toEqual({
      from: "2026-12-28",
      to: "2027-01-01",
    });
  });
});

describe("classement Motus", () => {
  it("fait passer les essais avant le chrono", () => {
    const rapideMaisLong = { attempts: 4, durationMs: 10_000 };
    const lentMaisEfficace = { attempts: 2, durationMs: 120_000 };
    expect(compareMotusPerformance(lentMaisEfficace, rapideMaisLong)).toBeLessThan(0);
  });

  it("départage deux grilles au même nombre d'essais par le chrono", () => {
    const a = { attempts: 3, durationMs: 40_000 };
    const b = { attempts: 3, durationMs: 41_000 };
    expect(compareMotusPerformance(a, b)).toBeLessThan(0);
  });
});

describe("affichage", () => {
  it("écrit le premier rang en toutes lettres", () => {
    expect(formatRank(1)).toBe("1er");
    expect(formatRank(2)).toBe("2e");
    expect(formatRank(87)).toBe("87e");
  });

  it("signe le rendement et refuse la division par zéro", () => {
    expect(formatRendement(38.4)).toBe("+38 %");
    expect(formatRendement(-12.6)).toBe("−13 %");
    expect(formatRendement(null)).toBe("—");
  });

  it("écrit le chrono sans minutes tant qu'il n'y en a pas", () => {
    expect(formatChrono(48_000)).toBe("48 s");
    expect(formatChrono(102_000)).toBe("1 min 42 s");
    expect(formatChrono(600_000)).toBe("10 min 00 s");
  });
});
