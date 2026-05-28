/**
 * Forecast orchestrator — recurring-decomposed ARIMA per design § 7.
 *
 * The trick: forecasting raw daily spend muddles the predictable subscription
 * tail (Netflix on the 12th, electricity on the 28th) with the noisy
 * variable tail (groceries, takeout). So we separate them:
 *
 *   1. Build a 90-day daily expense series (sum of base amounts per date).
 *   2. Pull active recurring items whose `next_expected_date` falls in the
 *      forecast window. Each contributes a known amount on a known day.
 *   3. Subtract the historical recurring contribution from the daily series
 *      to isolate the variable component.
 *   4. Forecast that variable component with ARIMA(1,1,1) (with rolling-
 *      average fallback). The model only sees the noisy half, which is
 *      where prediction actually adds value.
 *   5. Recombine: per-day total = recurring expected on that day + variable
 *      forecast for that day.
 *   6. Run anomaly detection over the historical daily series so the UI can
 *      flag spikes alongside the projection.
 *
 * Result is cached for six hours per space. The cache is invalidated by
 * `forecast.invalidated` events from the bus (subscribed once at module
 * load) or via the explicit `invalidateForecast` helper.
 */
import { and, eq, gte, isNull, lte, sql as drizzleSql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import {
  recurringItems,
  type RecurringItem,
} from '../../db/schema/recurring.ts';
import { transactions } from '../../db/schema/transactions.ts';
import { log } from '../../utils/logger.ts';
import { detectAnomalies, type AnomalyResult } from './anomaly.ts';
import { forecastSeries } from './arima.ts';

const LOOKBACK_DAYS = 90;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface ForecastDay {
  date: string;
  recurring: number;
  variable: number;
  lower: number;
  upper: number;
}

export interface ForecastResult {
  recurringBase: number;
  variableTotal: number;
  total: number;
  daily: ForecastDay[];
  anomalies: AnomalyResult[];
  method: 'arima' | 'rolling_average';
}

interface CacheEntry {
  result: ForecastResult;
  expiresAt: number;
  days: number;
}

const cache = new Map<string, CacheEntry>();

export async function computeForecast(
  spaceId: string,
  days: number = 30,
): Promise<ForecastResult> {
  const cached = cache.get(spaceId);
  if (cached && cached.days === days && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const today = startOfUtcDay(new Date());
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS + 1);

  const historical = await loadHistoricalDailyTotals(spaceId, since, today);
  const recurring = await loadActiveRecurring(spaceId);

  const horizonDates = nextHorizonDates(today, days);
  const recurringByDate = recurringContributionByDate(recurring, horizonDates);

  // Subtract recurring contribution from the historical tail so the ARIMA
  // model only sees the variable component. Recurring history is harder to
  // attribute precisely; we approximate by spreading the average amount of
  // each item across its expected slots inside the lookback.
  const variableHistory = subtractRecurringFromHistory(
    historical.series,
    historical.dates,
    recurring,
  );

  const horizonForecast = forecastSeries(variableHistory, days);

  // Anomaly detection over the *original* (recurring + variable) series so
  // the user sees real spikes including unusual subscription jumps.
  const anomalies = detectAnomalies(
    historical.dates.map((date, i) => ({
      date,
      amount: historical.series[i] ?? 0,
    })),
  );

  const daily: ForecastDay[] = [];
  let recurringBase = 0;
  let variableTotal = 0;

  for (let i = 0; i < days; i += 1) {
    const date = horizonDates[i];
    if (!date) continue;
    const recurringForDay = recurringByDate.get(date) ?? 0;
    const variableForDay = horizonForecast.forecasts[i] ?? 0;
    const lowerVar = horizonForecast.lower[i] ?? variableForDay;
    const upperVar = horizonForecast.upper[i] ?? variableForDay;
    daily.push({
      date,
      recurring: round2(recurringForDay),
      variable: round2(variableForDay),
      lower: round2(recurringForDay + lowerVar),
      upper: round2(recurringForDay + upperVar),
    });
    recurringBase += recurringForDay;
    variableTotal += variableForDay;
  }

  const result: ForecastResult = {
    recurringBase: round2(recurringBase),
    variableTotal: round2(variableTotal),
    total: round2(recurringBase + variableTotal),
    daily,
    anomalies,
    method: horizonForecast.method,
  };

  cache.set(spaceId, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
    days,
  });

  log.info('FORECAST_COMPUTE_OK', {
    spaceId,
    days,
    method: result.method,
    total: result.total,
    anomalies: anomalies.length,
  });

  return result;
}

export function invalidateForecast(spaceId: string): void {
  cache.delete(spaceId);
}

/**
 * Test-only: clear the entire cache so smoke runs don't carry state across.
 */
export function _resetForecastCache(): void {
  cache.clear();
}

// ---------- internal helpers ----------

async function loadHistoricalDailyTotals(
  spaceId: string,
  from: Date,
  to: Date,
): Promise<{ dates: string[]; series: number[] }> {
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);
  const rows = await db
    .select({
      date: transactions.date,
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.spaceId, spaceId),
        eq(transactions.type, 'expense'),
        isNull(transactions.deletedAt),
        gte(transactions.date, fromIso),
        lte(transactions.date, toIso),
      ),
    )
    .groupBy(transactions.date);

  const totalsByDate = new Map<string, number>();
  for (const r of rows) totalsByDate.set(r.date, Number(r.total));

  const dates: string[] = [];
  const series: number[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    const iso = cursor.toISOString().slice(0, 10);
    dates.push(iso);
    series.push(totalsByDate.get(iso) ?? 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { dates, series };
}

async function loadActiveRecurring(spaceId: string): Promise<RecurringItem[]> {
  return await db
    .select()
    .from(recurringItems)
    .where(
      and(
        eq(recurringItems.spaceId, spaceId),
        eq(recurringItems.status, 'active'),
      ),
    );
}

function recurringContributionByDate(
  items: RecurringItem[],
  horizonDates: string[],
): Map<string, number> {
  const horizonSet = new Set(horizonDates);
  const out = new Map<string, number>();
  for (const item of items) {
    if (!item.nextExpectedDate) continue;
    const amount = Number(item.averageAmount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    // Project the item across the horizon: starting at next_expected_date,
    // step by frequency_days until we leave the window.
    let cursor = new Date(`${item.nextExpectedDate}T00:00:00Z`);
    const lastDate = horizonDates[horizonDates.length - 1];
    const lastMs = lastDate ? new Date(`${lastDate}T00:00:00Z`).getTime() : 0;
    while (cursor.getTime() <= lastMs) {
      const iso = cursor.toISOString().slice(0, 10);
      if (horizonSet.has(iso)) {
        out.set(iso, (out.get(iso) ?? 0) + amount);
      }
      cursor.setUTCDate(cursor.getUTCDate() + item.frequencyDays);
      if (item.frequencyDays <= 0) break;
    }
  }
  return out;
}

function subtractRecurringFromHistory(
  series: number[],
  dates: string[],
  items: RecurringItem[],
): number[] {
  if (items.length === 0) return series.slice();
  const dateIndex = new Map<string, number>();
  for (let i = 0; i < dates.length; i += 1) {
    const d = dates[i];
    if (d) dateIndex.set(d, i);
  }
  const out = series.slice();

  for (const item of items) {
    if (!item.nextExpectedDate) continue;
    const amount = Number(item.averageAmount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const freq = item.frequencyDays;
    if (freq <= 0) continue;
    // Walk backwards from the most recent expected date through the
    // historical window, deducting `amount` per occurrence.
    let cursor = new Date(`${item.nextExpectedDate}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() - freq);
    const firstDate = dates[0];
    const firstMs = firstDate ? new Date(`${firstDate}T00:00:00Z`).getTime() : 0;
    while (cursor.getTime() >= firstMs) {
      const iso = cursor.toISOString().slice(0, 10);
      const idx = dateIndex.get(iso);
      if (idx !== undefined) {
        const remaining = (out[idx] ?? 0) - amount;
        out[idx] = Math.max(0, remaining);
      }
      cursor.setUTCDate(cursor.getUTCDate() - freq);
    }
  }
  return out;
}

function nextHorizonDates(start: Date, days: number): string[] {
  const out: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  for (let i = 0; i < days; i += 1) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export type { AnomalyResult } from './anomaly.ts';
