import { describe, expect, it } from "vitest";
import {
  WHEEL_SEGMENTS,
  WHEEL_TOTAL_WEIGHT,
  nextWheelSpinAt,
  wheelPayout,
  wheelProbability,
  wheelReturnToPlayer,
} from "./wheel.js";

describe("barème de la roue", () => {
  it("redistribue entre 90 et 95 %", () => {
    // Ce test est le garde-fou de l'économie : retoucher un poids ou un
    // multiplicateur sans refaire le calcul doit casser ici, pas six mois plus
    // tard dans les soldes.
    const rtp = wheelReturnToPlayer();
    expect(rtp).toBeGreaterThanOrEqual(0.9);
    expect(rtp).toBeLessThanOrEqual(0.95);
    expect(rtp).toBeCloseTo(0.9225, 4);
  });

  it("répartit mille poids sur neuf secteurs", () => {
    expect(WHEEL_SEGMENTS).toHaveLength(9);
    expect(WHEEL_TOTAL_WEIGHT).toBe(1000);
    for (const segment of WHEEL_SEGMENTS) {
      expect(segment.weight).toBeGreaterThan(0);
    }
  });

  it("garde les gros multiplicateurs rares", () => {
    const rares = WHEEL_SEGMENTS.filter((segment) => segment.multiplierTenths >= 50);
    const poids = rares.reduce((total, segment) => total + segment.weight, 0);
    // ×5, ×10 et ×20 pèsent ensemble 10 poids sur 1 000, soit exactement 1 %.
    expect(poids / WHEEL_TOTAL_WEIGHT).toBeLessThanOrEqual(0.01);
  });

  it("n'aligne pas deux gros multiplicateurs voisins", () => {
    // L'ordre des secteurs est un choix de rendu : deux gros côte à côte
    // trahissent une roue rangée par valeur.
    for (let index = 0; index < WHEEL_SEGMENTS.length; index += 1) {
      const current = WHEEL_SEGMENTS[index]?.multiplierTenths ?? 0;
      const next = WHEEL_SEGMENTS[(index + 1) % WHEEL_SEGMENTS.length]?.multiplierTenths ?? 0;
      expect(current >= 50 && next >= 50).toBe(false);
    }
  });

  it("expose des probabilités qui totalisent 1", () => {
    const total = WHEEL_SEGMENTS.reduce((sum, _, index) => sum + wheelProbability(index), 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("versement", () => {
  it("rend un montant entier pour toute mise autorisée", () => {
    for (let stake = 10; stake <= 1_000; stake += 10) {
      for (const segment of WHEEL_SEGMENTS) {
        expect(Number.isInteger(wheelPayout(stake, segment.multiplierTenths))).toBe(true);
      }
    }
  });

  it("refuse un versement non entier plutôt que de l'arrondir", () => {
    expect(() => wheelPayout(5, 5)).toThrow();
  });

  it("rend zéro sur la case perdante", () => {
    expect(wheelPayout(500, 0)).toBe(0);
  });
});

describe("un lancer par jour civil parisien", () => {
  // 14 h à Paris le 13 août (UTC+2 en été).
  const now = new Date("2026-08-13T12:00:00.000Z");

  it("laisse lancer un compte qui n'a jamais joué", () => {
    expect(nextWheelSpinAt(null, now)).toBeNull();
  });

  it("renvoie au minuit suivant après un lancer du jour", () => {
    const lastSpin = new Date("2026-08-13T06:00:00.000Z"); // 08 h Paris, même jour
    // 00 h Paris le 14 août = 22 h UTC le 13, l'été.
    expect(nextWheelSpinAt(lastSpin, now)?.toISOString()).toBe("2026-08-13T22:00:00.000Z");
  });

  it("rouvre la roue dès le changement de jour, sans attendre 24 h", () => {
    // 23 h 50 à Paris le 12 août ; il est 00 h 10 le 13 quand on redemande.
    const lastSpin = new Date("2026-08-12T21:50:00.000Z");
    const justeApresMinuit = new Date("2026-08-12T22:10:00.000Z");
    // Vingt minutes se sont écoulées, mais le jour a changé : c'est ce que
    // « une fois par jour » veut dire, et c'est la règle du bonus quotidien.
    expect(nextWheelSpinAt(lastSpin, justeApresMinuit)).toBeNull();
  });

  it("ne rouvre pas la roue au bout de 24 h si le jour n'a pas changé", () => {
    // Lancé à 02 h Paris le 13 ; il est 23 h le même jour, soit 21 h plus tard.
    const lastSpin = new Date("2026-08-13T00:00:00.000Z");
    const memeSoir = new Date("2026-08-13T21:00:00.000Z");
    expect(nextWheelSpinAt(lastSpin, memeSoir)).not.toBeNull();
  });

  /**
   * Comme pour les créneaux Motus, la borne est une **heure civile** : minuit à
   * Paris, quelle que soit la saison. En hiver, il tombe à 23 h UTC.
   */
  it("cale la réouverture sur minuit de Paris, même en heure d'hiver", () => {
    const hiver = new Date("2027-01-15T13:00:00.000Z"); // 14 h Paris
    const lastSpin = new Date("2027-01-15T07:00:00.000Z"); // 08 h Paris, même jour
    expect(nextWheelSpinAt(lastSpin, hiver)?.toISOString()).toBe("2027-01-15T23:00:00.000Z");
  });
});
