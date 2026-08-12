import { afterEach, describe, expect, it } from "vitest";
import {
  activityOf,
  blockActivity,
  releaseActivity,
  reserveActivity,
  unblockActivity,
} from "./activity.js";

const userId = "joueur-1";

afterEach(() => {
  unblockActivity(userId);
  releaseActivity(userId, { kind: "table", id: "table-1" });
  releaseActivity(userId, { kind: "motus", id: "slot-1" });
});

describe("registre d'activité", () => {
  it("réserve une activité et rend la même réservation idempotente", () => {
    expect(reserveActivity(userId, { kind: "motus", id: "slot-1" })).toBe(true);
    expect(reserveActivity(userId, { kind: "motus", id: "slot-1" })).toBe(true);
    expect(activityOf(userId)).toEqual({ kind: "motus", id: "slot-1" });
  });

  it("refuse une autre activité tant que la première est réservée", () => {
    expect(reserveActivity(userId, { kind: "table", id: "table-1" })).toBe(true);
    expect(reserveActivity(userId, { kind: "motus", id: "slot-1" })).toBe(false);
    expect(activityOf(userId)).toEqual({ kind: "table", id: "table-1" });
  });

  it("ne libère pas une réservation plus récente avec un propriétaire périmé", () => {
    reserveActivity(userId, { kind: "table", id: "table-1" });
    releaseActivity(userId, { kind: "motus", id: "slot-1" });
    expect(activityOf(userId)).toEqual({ kind: "table", id: "table-1" });

    releaseActivity(userId, { kind: "table", id: "table-1" });
    expect(activityOf(userId)).toBeNull();
  });

  it("empêche une nouvelle activité pendant la suppression d'un compte", () => {
    expect(blockActivity(userId)).toBe(true);
    expect(reserveActivity(userId, { kind: "motus", id: "slot-1" })).toBe(false);
    unblockActivity(userId);
    expect(reserveActivity(userId, { kind: "motus", id: "slot-1" })).toBe(true);
  });

  it("refuse de bloquer un compte qui possède déjà une activité", () => {
    expect(reserveActivity(userId, { kind: "table", id: "table-1" })).toBe(true);
    expect(blockActivity(userId)).toBe(false);
    expect(activityOf(userId)).toEqual({ kind: "table", id: "table-1" });
  });

  it("refuse une seconde suppression pendant que le compte est déjà bloqué", () => {
    expect(blockActivity(userId)).toBe(true);
    expect(blockActivity(userId)).toBe(false);
  });
});
