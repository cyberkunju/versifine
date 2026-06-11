/**
 * FX resolution worker.
 *
 * When a transaction is logged in a foreign currency during an FX-provider
 * outage, `create.ts` stores it with `fxRate=1`, `baseAmount=<raw foreign
 * amount>` and `needsFxResolution=true` — so "5 OMR" is temporarily booked as
 * "₹5". Historically NOTHING ever read that flag, so the row stayed wrong
 * forever, silently corrupting every total/budget/forecast for that space.
 *
 * This worker closes that hole. Periodically (and once shortly after boot) it:
 *   1. finds flagged, non-deleted rows (+ their wallet currency),
 *   2. fetches the now-available rate (currency → wallet currency),
 *   3. recomputes `baseAmount`/`fxRate` and clears the flag — via a
 *      COMPARE-AND-SWAP update guarded by `needsFxResolution = true`, so two
 *      API instances (or a retry) can never double-apply, and a row a user
 *      corrected/deleted in the meantime is left alone,
 *   4. invalidates the forecast cache and recomputes budgets for touched spaces.
 *
 * Rate fetches happen OUTSIDE any row lock (no network-under-lock); the CAS
 * update is the only thing that mutates state. A still-failing rate leaves the
 * flag set so the next tick retries.
 */
import { and, asc, eq, isNull, sql as dsql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { transactions } from '../../db/schema/transactions.ts';
import { wallets } from '../../db/schema/wallets.ts';
import { users } from '../../db/schema/users.ts';
import { log } from '../../utils/logger.ts';
import { getRate } from './client.ts';
import { normalizeCurrencyCode, toBase } from './convert.ts';
import { recomputeAffectedBudgets } from '../budgets/index.ts';

/** How many flagged rows to attempt per tick. Keeps a backlog from stampeding
 *  the FX provider while still draining steadily. */
const BATCH_LIMIT = 50;
/** Default tick interval — 5 minutes. The provider rate is daily-ish, so there
 *  is no value polling faster, and a tighter loop just wastes calls. */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
/** First drain runs soon after boot to clear any backlog from a recent outage. */
const INITIAL_DELAY_MS = 20 * 1000;
/** After this many failed rate fetches a row is dead-lettered (metadata
 *  fxGaveUp=true) so a permanently-unsupported pair can't spin the worker
 *  forever or starve resolvable rows. ~1 hour at the default interval. */
const MAX_ATTEMPTS = 12;

export interface FxResolveResult {
  scanned: number;
  resolved: number;
  failed: number;
}

export interface FxResolveOpts {
  /** Restrict resolution to a single space — used by the isolated smoke test
   *  so it can never touch unrelated production rows. */
  spaceId?: string;
}

/**
 * Resolve a batch of FX-pending transactions. Safe to call concurrently and
 * repeatedly. Never throws — per-row failures are logged and left flagged for
 * the next attempt (until MAX_ATTEMPTS, after which the row is dead-lettered).
 */
export async function resolvePendingFx(
  limit = BATCH_LIMIT,
  opts: FxResolveOpts = {},
): Promise<FxResolveResult> {
  let resolved = 0;
  let failed = 0;

  let rows: Array<{
    id: string;
    amount: string;
    currency: string;
    spaceId: string;
    category: string | null;
    walletCurrency: string;
    metadata: unknown;
  }>;
  try {
    const conds = [
      eq(transactions.needsFxResolution, true),
      isNull(transactions.deletedAt),
      // Skip dead-lettered rows so a poison pair can't monopolise the batch.
      dsql`(${transactions.metadata} ->> 'fxGaveUp') is distinct from 'true'`,
    ];
    if (opts.spaceId) conds.push(eq(transactions.spaceId, opts.spaceId));
    rows = await db
      .select({
        id: transactions.id,
        amount: transactions.amount,
        currency: transactions.currency,
        spaceId: transactions.spaceId,
        category: transactions.category,
        walletCurrency: wallets.currency,
        metadata: transactions.metadata,
      })
      .from(transactions)
      .innerJoin(wallets, eq(transactions.walletId, wallets.id))
      .where(and(...conds))
      // Oldest first so a steady backlog drains FIFO and newly-flagged rows
      // never jump ahead of long-waiting ones.
      .orderBy(asc(transactions.createdAt))
      .limit(limit);
  } catch (err) {
    log.warn('FX_RESOLVE_SCAN_FAIL', { error: err instanceof Error ? err.message : String(err) });
    return { scanned: 0, resolved: 0, failed: 0 };
  }

  const scanned = rows.length;
  if (scanned === 0) return { scanned, resolved, failed };

  const touchedSpaces = new Map<string, Set<string | null>>();

  for (const row of rows) {
    const native = normalizeCurrencyCode(row.currency);
    const base = normalizeCurrencyCode(row.walletCurrency);

    // Defensive: a same-currency row should never be flagged; if it somehow is,
    // resolve it to 1:1 (amount === baseAmount) and clear the flag.
    let rate = 1;
    if (native !== base) {
      try {
        rate = await getRate(native, base);
      } catch (err) {
        failed += 1;
        await recordFxFailure(row.id, row.metadata, native, base, err);
        continue; // leave flagged; retry next tick (until dead-lettered)
      }
    }

    const amount = Number(row.amount);
    const newBase = toBase(amount, native, base, rate);

    try {
      // COMPARE-AND-SWAP. The guard pins the EXACT row state we read: the flag
      // is still set, AND the amount/currency haven't changed, AND it isn't
      // soft-deleted. So a concurrent user edit (PATCH amount) or delete makes
      // this a 0-row no-op and the worker re-resolves the new state next tick —
      // it can NEVER write a base derived from a now-stale amount. This is the
      // fix for the stale-amount race that would otherwise corrupt money.
      const updated = await db
        .update(transactions)
        .set({
          baseAmount: newBase.toFixed(2),
          fxRate: rate.toFixed(8),
          needsFxResolution: false,
        })
        .where(
          and(
            eq(transactions.id, row.id),
            eq(transactions.needsFxResolution, true),
            eq(transactions.amount, row.amount),
            eq(transactions.currency, row.currency),
            isNull(transactions.deletedAt),
          ),
        )
        .returning({ id: transactions.id });
      if (updated.length > 0) {
        resolved += 1;
        if (!touchedSpaces.has(row.spaceId)) touchedSpaces.set(row.spaceId, new Set());
        touchedSpaces.get(row.spaceId)!.add(row.category);
        log.info('FX_RESOLVE_OK', { id: row.id, from: native, to: base, rate, baseAmount: newBase });
      }
    } catch (err) {
      failed += 1;
      log.warn('FX_RESOLVE_UPDATE_FAIL', {
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Best-effort downstream recompute for spaces whose totals just changed.
  for (const [spaceId, categories] of touchedSpaces) {
    try {
      const [owner] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.activeSpaceId, spaceId))
        .limit(1);
      const userId = owner?.id ?? spaceId; // userId only routes budget-alert events
      for (const category of categories) {
        await recomputeAffectedBudgets(userId, spaceId, category);
      }
      const forecast = await import('../forecast/index.ts');
      forecast.invalidateForecast(spaceId);
    } catch (err) {
      log.warn('FX_RESOLVE_RECOMPUTE_FAIL', {
        spaceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { scanned, resolved, failed };
}

/** Bump the per-row failure counter and dead-letter it past MAX_ATTEMPTS, so a
 *  permanently-unsupported pair stops being retried (and stops starving the
 *  batch) while staying auditable (flag stays true, fxGaveUp marks why). */
async function recordFxFailure(
  id: string,
  metadata: unknown,
  from: string,
  to: string,
  err: unknown,
): Promise<void> {
  const prior = Number((metadata as Record<string, unknown> | null)?.['fxAttempts'] ?? 0);
  const attempts = prior + 1;
  const gaveUp = attempts >= MAX_ATTEMPTS;
  try {
    await db
      .update(transactions)
      .set({
        metadata: dsql`jsonb_set(jsonb_set(coalesce(${transactions.metadata}, '{}'::jsonb), '{fxAttempts}', to_jsonb(${attempts}::int), true), '{fxGaveUp}', to_jsonb(${gaveUp}::boolean), true)`,
      })
      .where(eq(transactions.id, id));
  } catch {
    // bookkeeping failure is non-fatal — the row simply retries next tick
  }
  log[gaveUp ? 'warn' : 'info'](gaveUp ? 'FX_RESOLVE_GAVEUP' : 'FX_RESOLVE_RATE_FAIL', {
    id,
    from,
    to,
    attempts,
    error: err instanceof Error ? err.message : String(err),
  });
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic FX resolution worker. Idempotent (a second call is a
 * no-op while one is running). The timer is unref'd so it never keeps the
 * process alive on its own.
 */
export function startFxResolutionWorker(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (timer) return;

  const tick = () => {
    void resolvePendingFx()
      .then((r) => {
        if (r.scanned > 0) log.info('FX_RESOLVE_TICK', { ...r });
      })
      .catch((err) => {
        log.warn('FX_RESOLVE_TICK_FAIL', { error: err instanceof Error ? err.message : String(err) });
      });
  };

  // Clear any backlog shortly after boot, then settle into the interval.
  const initial = setTimeout(tick, INITIAL_DELAY_MS);
  if (typeof (initial as { unref?: () => void }).unref === 'function') {
    (initial as { unref?: () => void }).unref!();
  }

  timer = setInterval(tick, intervalMs);
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref?: () => void }).unref!();
  }
  log.info('FX_RESOLVE_WORKER_STARTED', { intervalMs });
}

/** Stop the worker (graceful shutdown / tests). */
export function stopFxResolutionWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
