/**
 * FX client.
 *
 * Lookups are read-through-cached against `fx_rates`: hit the DB first, and
 * only when a row is missing or older than `FX_CACHE_SECONDS` do we hit the
 * upstream provider. The default provider is open.er-api.com which returns
 * a `{ rates: { CCY: number } }` map keyed by the requested base, so a
 * single fetch warms the entire pair set for that base in one round trip.
 *
 * Failures degrade rather than crash:
 *   - exponential backoff on transient network errors (3 attempts)
 *   - on persistent failure we return the most recent stale cached rate
 *     when one exists (better than blocking the write path)
 *   - identity (base == quote) short-circuits to 1
 *
 * Currency codes are upper-case ISO 4217. Callers pass anything; we
 * uppercase here so the rest of the surface can stay strict.
 */
import { and, desc, eq, sql as drizzleSql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { fxRates } from '../../db/schema/fx.ts';
import { env } from '../../env.ts';
import { errors } from '../../utils/errors.ts';
import { log } from '../../utils/logger.ts';

const MAX_FETCH_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 200;

interface UpstreamResponse {
  result?: string;
  base_code?: string;
  rates?: Record<string, number>;
}

function upper(value: string): string {
  return value.trim().toUpperCase();
}

async function readCached(base: string, quote: string): Promise<{ rate: number; fetchedAt: Date } | null> {
  const [row] = await db
    .select({ rate: fxRates.rate, fetchedAt: fxRates.fetchedAt })
    .from(fxRates)
    .where(and(eq(fxRates.base, base), eq(fxRates.quote, quote)))
    .orderBy(desc(fxRates.fetchedAt))
    .limit(1);
  if (!row) return null;
  return { rate: Number(row.rate), fetchedAt: row.fetchedAt };
}

function isFresh(fetchedAt: Date): boolean {
  const ageSec = (Date.now() - fetchedAt.getTime()) / 1000;
  return ageSec < env.FX_CACHE_SECONDS;
}

async function fetchUpstream(base: string): Promise<Record<string, number>> {
  const url = `${env.FX_API_URL.replace(/\/$/, '')}/${base}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      const res = await fetch(url, { signal: ac.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) {
        throw new Error(`FX upstream HTTP ${res.status}`);
      }
      const json = (await res.json()) as UpstreamResponse;
      if (!json.rates || typeof json.rates !== 'object') {
        throw new Error('FX upstream missing rates');
      }
      return json.rates;
    } catch (err) {
      lastErr = err;
      log.warn('FX_FETCH_RETRY', {
        base,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
      if (attempt < MAX_FETCH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_BASE_MS * 2 ** (attempt - 1)));
      }
    }
  }
  throw errors.upstream(
    lastErr instanceof Error ? `FX fetch failed: ${lastErr.message}` : 'FX fetch failed',
  );
}

async function persistRates(base: string, rates: Record<string, number>): Promise<void> {
  const now = new Date();
  const rows = Object.entries(rates)
    .filter(([quote, rate]) => /^[A-Z]{3}$/.test(quote) && Number.isFinite(rate) && rate > 0)
    .map(([quote, rate]) => ({
      base,
      quote,
      rate: rate.toFixed(8),
      fetchedAt: now,
    }));
  if (rows.length === 0) return;
  // Upsert per (base, quote) — multiple rows are fine in one statement.
  await db
    .insert(fxRates)
    .values(rows)
    .onConflictDoUpdate({
      target: [fxRates.base, fxRates.quote],
      set: {
        rate: drizzleSql`excluded.rate`,
        fetchedAt: drizzleSql`excluded.fetched_at`,
      },
    });
}

/**
 * Get the conversion factor: 1 unit of `base` → `quote` units.
 *
 * Identity pairs short-circuit. Callers should pass anything to `base`
 * and `'INR'` (or the user's base) to `quote`, but it's symmetric.
 */
export async function getRate(base: string, quote: string): Promise<number> {
  const b = upper(base);
  const q = upper(quote);
  if (!/^[A-Z]{3}$/.test(b) || !/^[A-Z]{3}$/.test(q)) {
    throw errors.validation('Currency must be a 3-letter ISO code', { base, quote });
  }
  if (b === q) return 1;

  const cached = await readCached(b, q);
  if (cached && isFresh(cached.fetchedAt)) {
    return cached.rate;
  }

  try {
    const rates = await fetchUpstream(b);
    await persistRates(b, rates);
    const rate = rates[q];
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
      // Provider didn't return our pair: fall back to inverse if we have it.
      const inverse = await readCached(q, b);
      if (inverse && inverse.rate > 0) return 1 / inverse.rate;
      if (cached) return cached.rate;
      throw errors.upstream(`No rate available for ${b}->${q}`);
    }
    return rate;
  } catch (err) {
    if (cached) {
      log.warn('FX_FETCH_STALE_FALLBACK', {
        base: b,
        quote: q,
        error: err instanceof Error ? err.message : String(err),
      });
      return cached.rate;
    }
    throw err;
  }
}

/**
 * Synchronous helper for tests / scripts. Identity short-circuit only.
 * Real conversions must go through `getRate` to fetch + persist.
 */
export function trivialRate(base: string, quote: string): number | null {
  return upper(base) === upper(quote) ? 1 : null;
}
