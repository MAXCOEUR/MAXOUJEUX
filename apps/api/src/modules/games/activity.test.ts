import { afterEach, describe, expect, it } from "vitest";
import { activityOf, releaseActivity, reserveActivity } from "./activity.js";

const userId = "joueur-1";

afterEach(() => {
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
});
