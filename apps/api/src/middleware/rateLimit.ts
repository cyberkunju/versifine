/**
 * In-memory token bucket rate limiter.
 *
 * Sized for hackathon traffic on a single Bun process. For multi-instance
 * deployment swap to Redis-backed tokens; the public API stays identical.
 *
 * Buckets are keyed by an opaque string (caller chooses: IP for unauth,
 * userId for auth, "phone:919..." for the bot trust path).
 */
import type { MiddlewareHandler } from 'hono';
import { errors } from '../utils/errors.ts';

interface Bucket {
  tokens: number;
  refilledAt: number;
}

interface Limiter {
  capacity: number;
  refillTokens: number;
  refillIntervalMs: number;
}

interface Options extends Limiter {
  /** Resolves the key to bucket on. Returning null skips rate limiting. */
  key: (c: import('hono').Context) => string | null | undefined;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 60_000;

function sweep() {
  if (Date.now() - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = Date.now();
  const cutoff = Date.now() - 5 * 60_000;
  for (const [k, v] of buckets) if (v.refilledAt < cutoff) buckets.delete(k);
}

export function rateLimit(opts: Options): MiddlewareHandler {
  return async (c, next) => {
    sweep();
    const key = opts.key(c);
    if (!key) return next();
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: opts.capacity, refilledAt: now };
    const elapsed = now - bucket.refilledAt;
    if (elapsed > 0) {
      const refill = (elapsed / opts.refillIntervalMs) * opts.refillTokens;
      bucket.tokens = Math.min(opts.capacity, bucket.tokens + refill);
      bucket.refilledAt = now;
    }
    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      throw errors.rateLimited();
    }
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    c.header('x-ratelimit-remaining', String(Math.floor(bucket.tokens)));
    await next();
  };
}

/** Common presets. */
export const limits = {
  auth: { capacity: 10, refillTokens: 10, refillIntervalMs: 60_000 },
  capture: { capacity: 60, refillTokens: 60, refillIntervalMs: 60_000 },
  copilot: { capacity: 20, refillTokens: 20, refillIntervalMs: 60_000 },
};
