export type ConnectionLimit = "account" | "ip";

export const REALTIME_LIMITS = {
  maxMessageBytes: 65_536,
  socketsPerAccount: 5,
  socketsPerIp: 20,
  eventsPerAccount: 120,
  eventsPerIp: 600,
  eventWindowMs: 60_000,
  sessionRecheckMs: 30 * 60_000,
} as const;

export class ConnectionRegistry {
  private readonly accounts = new Map<string, number>();
  private readonly ips = new Map<string, number>();

  constructor(
    private readonly maxPerAccount: number,
    private readonly maxPerIp: number,
  ) {}

  add(userId: string, ip: string): ConnectionLimit | null {
    if ((this.accounts.get(userId) ?? 0) >= this.maxPerAccount) return "account";
    if ((this.ips.get(ip) ?? 0) >= this.maxPerIp) return "ip";
    this.accounts.set(userId, (this.accounts.get(userId) ?? 0) + 1);
    this.ips.set(ip, (this.ips.get(ip) ?? 0) + 1);
    return null;
  }

  remove(userId: string, ip: string): void {
    this.decrement(this.accounts, userId);
    this.decrement(this.ips, ip);
  }

  private decrement(map: Map<string, number>, key: string): void {
    const next = (map.get(key) ?? 0) - 1;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  }
}

export class RealtimeRateLimiter {
  private readonly accounts = new Map<string, number[]>();
  private readonly ips = new Map<string, number[]>();

  constructor(
    private readonly maxPerAccount: number,
    private readonly maxPerIp: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(userId: string, ip: string): boolean {
    const timestamp = this.now();
    const account = this.active(this.accounts, userId, timestamp);
    const ipEvents = this.active(this.ips, ip, timestamp);
    if (account.length >= this.maxPerAccount || ipEvents.length >= this.maxPerIp) return false;
    account.push(timestamp);
    ipEvents.push(timestamp);
    return true;
  }

  prune(): void {
    const timestamp = this.now();
    this.pruneMap(this.accounts, timestamp);
    this.pruneMap(this.ips, timestamp);
  }

  private pruneMap(map: Map<string, number[]>, now: number): void {
    for (const key of map.keys()) {
      if (this.active(map, key, now).length === 0) map.delete(key);
    }
  }

  private active(map: Map<string, number[]>, key: string, now: number): number[] {
    const entries = map.get(key) ?? [];
    const threshold = now - this.windowMs;
    while (entries[0] !== undefined && entries[0] <= threshold) entries.shift();
    map.set(key, entries);
    return entries;
  }
}
