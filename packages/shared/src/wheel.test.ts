import { describe, expect, it } from "vitest";
import {
  WHEEL_COOLDOWN_MS,
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

describe("délai de 24 h", () => {
  const now = new Date("2026-08-13T12:00:00.000Z");

  it("laisse lancer un compte qui n'a jamais joué", () => {
    expect(nextWheelSpinAt(null, now)).toBeNull();
  });

  it("compte à partir du lancer, pas de minuit", () => {
    const lastSpin = new Date(now.getTime() - 10 * 60 * 60 * 1000);
    const next = nextWheelSpinAt(lastSpin, now);
    expect(next?.toISOString()).toBe("2026-08-14T02:00:00.000Z");
  });

  it("rouvre la roue à l'expiration exacte du délai", () => {
    const lastSpin = new Date(now.getTime() - WHEEL_COOLDOWN_MS);
    expect(nextWheelSpinAt(lastSpin, now)).toBeNull();
  });
});
