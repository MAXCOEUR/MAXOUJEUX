import { describe, expect, it } from "vitest";
import { ConnectionRegistry, REALTIME_LIMITS, RealtimeRateLimiter } from "./limits.js";

describe("limites Socket.IO", () => {
  it("expose les plafonds de sécurité attendus", () => {
    expect(REALTIME_LIMITS).toMatchObject({
      maxMessageBytes: 65_536,
      socketsPerAccount: 5,
      socketsPerIp: 20,
      eventsPerAccount: 120,
      eventsPerIp: 600,
      sessionRecheckMs: 30 * 60_000,
    });
  });
  it("plafonne et libère les connexions par compte et IP", () => {
    const registry = new ConnectionRegistry(2, 3);
    expect(registry.add("u1", "ip1")).toBe(null);
    expect(registry.add("u1", "ip1")).toBe(null);
    expect(registry.add("u1", "ip2")).toBe("account");
    registry.remove("u1", "ip1");
    expect(registry.add("u1", "ip2")).toBe(null);

    expect(registry.add("u2", "ip1")).toBe(null);
    expect(registry.add("u3", "ip1")).toBe(null);
    expect(registry.add("u4", "ip1")).toBe("ip");
  });

  it("applique les fenêtres compte et IP puis oublie les événements expirés", () => {
    let now = 0;
    const limiter = new RealtimeRateLimiter(2, 3, 60_000, () => now);
    expect(limiter.take("u1", "ip1")).toBe(true);
    expect(limiter.take("u1", "ip1")).toBe(true);
    expect(limiter.take("u1", "ip2")).toBe(false);

    now = 60_001;
    expect(limiter.take("u1", "ip1")).toBe(true);
  });

  it("applique les plafonds exacts par IP et libère les compteurs", () => {
    const registry = new ConnectionRegistry(
      REALTIME_LIMITS.socketsPerAccount,
      REALTIME_LIMITS.socketsPerIp,
    );
    for (let index = 0; index < REALTIME_LIMITS.socketsPerIp; index += 1) {
      expect(registry.add(`user-${index}`, "203.0.113.8")).toBe(null);
    }
    expect(registry.add("user-overflow", "203.0.113.8")).toBe("ip");
    registry.remove("user-0", "203.0.113.8");
    expect(registry.add("user-after-disconnect", "203.0.113.8")).toBe(null);

    let now = 0;
    const limiter = new RealtimeRateLimiter(
      REALTIME_LIMITS.eventsPerAccount,
      REALTIME_LIMITS.eventsPerIp,
      REALTIME_LIMITS.eventWindowMs,
      () => now,
    );
    for (let account = 0; account < 5; account += 1) {
      for (let action = 0; action < REALTIME_LIMITS.eventsPerAccount; action += 1) {
        expect(limiter.take(`rate-${account}`, "203.0.113.9")).toBe(true);
      }
    }
    expect(limiter.take("rate-overflow", "203.0.113.9")).toBe(false);
    now = REALTIME_LIMITS.eventWindowMs + 1;
    limiter.prune();
    expect(limiter.take("rate-after-window", "203.0.113.9")).toBe(true);
  });
});
