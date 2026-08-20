export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, {count: number; resetsAt: number}>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  consume(key: string, now = Date.now()): boolean {
    const current = this.entries.get(key);
    if (!current || current.resetsAt <= now) {
      this.entries.set(key, {count: 1, resetsAt: now + this.windowMs});
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }
}
