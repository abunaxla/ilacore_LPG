import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Fixed-window rate limiter kept in memory. Enough while the API runs as one process. Swap for a
 * shared store (Redis) before running several instances.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts a hit for `key` and throws 429 once the limit is exceeded in the current window. */
  hit(key: string): void {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      if (this.hits.size > 50_000) this.sweep(t);
      return;
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      throw new HttpException(
        { error: 'too_many_requests', message: 'Too many attempts. Wait a few minutes and try again.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private sweep(t: number): void {
    for (const [key, entry] of this.hits) if (entry.resetAt <= t) this.hits.delete(key);
  }
}