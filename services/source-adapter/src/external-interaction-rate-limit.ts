export type ExternalInteractionRateLimit = {
  windowSeconds: number;
  maxRequests: number;
};

type Bucket = {
  count: number;
  resetAtMs: number;
};

export class ExternalInteractionRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  check(
    interfaceKey: string,
    limit: ExternalInteractionRateLimit,
  ): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAtMs) this.buckets.delete(key);
    }

    const windowMs = limit.windowSeconds * 1000;
    const bucket = this.buckets.get(interfaceKey);
    if (!bucket) {
      this.buckets.set(interfaceKey, { count: 1, resetAtMs: now + windowMs });
      return { ok: true };
    }
    if (bucket.count >= limit.maxRequests) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAtMs - now) / 1000)),
      };
    }
    bucket.count += 1;
    return { ok: true };
  }
}
