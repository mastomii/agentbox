export class RateLimitWindow {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(maxAttempts: number, windowMs: number, maxKeys = 10_000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  isBlocked(key: string, now = Date.now()): boolean {
    const entry = this.entries.get(key);
    if (!entry || now >= entry.resetAt) return false;
    return entry.count >= this.maxAttempts;
  }
  consume(key: string, now = Date.now()): boolean {
    if (this.isBlocked(key, now)) return true;
    const entry = this.entries.get(key);
    if (!entry || now >= entry.resetAt) {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count += 1;
    }
    this.prune(now);
    return false;
  }
  clear(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    if (this.entries.size <= this.maxKeys) return;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maxKeys) {
      const first = this.entries.keys().next().value as string | undefined;
      if (!first) break;
      this.entries.delete(first);
    }
  }
}
