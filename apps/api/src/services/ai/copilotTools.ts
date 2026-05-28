/**
 * Tool functions exposed to the copilot LLM.
 *
 * The copilot is forbidden from doing math in prose — every sum, every
 * breakdown, every comparison comes from one of these tools so we can
 * audit it. Each function:
 *   - is a pure server function (no LLM in the body)
 *   - reads only what's strictly necessary
 *   - filters by `space_id` so cross-tenant numbers cannot leak
 *
 * If the underlying transactions services aren't available yet (the
 * other agent's work is still in flight) we return a structured
 * "unavailable" envelope; the model is instructed in the system prompt
 * to relay that gracefully instead of fabricating a number.
 */
import { and, between, desc, eq, gte, isNull, lte, sql as drizzleSql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { recurringItems } from '../../db/schema/recurring.ts';
import { transactions } from '../../db/schema/transactions.ts';
import { log } from '../../utils/logger.ts';

type Range = { from: string; to: string };

function isoRange(range: Range): { from: string; to: string } {
  const safe = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  return { from: safe(range.from), to: safe(range.to) };
}

function unavailable(tool: string, reason: string): {
  tool: string;
  ok: false;
  message: string;
} {
  return {
    tool,
    ok: false,
    message: `Tool unavailable: ${reason}`,
  };
}

interface ComputeTotalArgs {
  from: string;
  to: string;
  category?: string | null;
  type?: 'income' | 'expense' | 'transfer';
}

export interface ComputeTotalResult {
  tool: 'compute_total';
  ok: true;
  range: Range;
  category: string | null;
  type: ComputeTotalArgs['type'] | null;
  total: number;
  count: number;
}

/**
 * Sum the absolute value of transactions in a window. The result is in
 * each transaction's `base_amount` (already converted to the wallet's
 * canonical currency at write time).
 */
export async function compute_total(
  spaceId: string,
  args: ComputeTotalArgs,
): Promise<ComputeTotalResult | ReturnType<typeof unavailable>> {
  try {
    const range = isoRange(args);
    if (!range.from || !range.to) {
      return unavailable('compute_total', 'invalid date range');
    }
    const filters: SQL[] = [
      eq(transactions.spaceId, spaceId),
      isNull(transactions.deletedAt),
      gte(transactions.date, range.from),
      lte(transactions.date, range.to),
    ];
    if (args.type) filters.push(eq(transactions.type, args.type));
    if (args.category) filters.push(eq(transactions.category, args.category));

    const [row] = await db
      .select({
        total: drizzleSql<number>`coalesce(sum(${transactions.baseAmount})::float, 0)`,
        count: drizzleSql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(and(...filters));

    return {
      tool: 'compute_total',
      ok: true,
      range,
      category: args.category ?? null,
      type: args.type ?? null,
      total: Number(row?.total ?? 0),
      count: Number(row?.count ?? 0),
    };
  } catch (err) {
    log.warn('TOOL_COMPUTE_TOTAL_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return unavailable('compute_total', 'transaction services not ready');
  }
}

interface BreakdownArgs {
  from: string;
  to: string;
}

export interface ComputeBreakdownResult {
  tool: 'compute_category_breakdown';
  ok: true;
  range: Range;
  rows: Array<{ category: string; total: number; count: number }>;
}

export async function compute_category_breakdown(
  spaceId: string,
  args: BreakdownArgs,
): Promise<ComputeBreakdownResult | ReturnType<typeof unavailable>> {
  try {
    const range = isoRange(args);
    if (!range.from || !range.to) {
      return unavailable('compute_category_breakdown', 'invalid date range');
    }
    const rows = await db
      .select({
        category: transactions.category,
        total: drizzleSql<number>`coalesce(sum(${transactions.baseAmount})::float, 0)`,
        count: drizzleSql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          isNull(transactions.deletedAt),
          eq(transactions.type, 'expense'),
          between(transactions.date, range.from, range.to),
        ),
      )
      .groupBy(transactions.category)
      .orderBy(desc(drizzleSql`sum(${transactions.baseAmount})`));

    return {
      tool: 'compute_category_breakdown',
      ok: true,
      range,
      rows: rows.map((r) => ({
        category: r.category ?? 'Uncategorized',
        total: Number(r.total),
        count: Number(r.count),
      })),
    };
  } catch (err) {
    log.warn('TOOL_BREAKDOWN_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return unavailable(
      'compute_category_breakdown',
      'transaction services not ready',
    );
  }
}

export interface ComputeForecastResult {
  tool: 'compute_forecast';
  ok: true;
  days: number;
  recurringBase: number;
  variableTotal: number;
  total: number;
  source: 'forecast_service' | 'rolling_average';
}

type ForecastFn = (
  spaceId: string,
  days: number,
) => Promise<{ recurringBase?: number; variableTotal?: number; total?: number }>;

let forecastFn: ForecastFn | null | undefined;
async function loadForecast(): Promise<ForecastFn | null> {
  if (forecastFn !== undefined) return forecastFn;
  try {
    // TODO: cross-agent import — services/forecast/index.ts
    const path = '../forecast/' + 'index.ts';
    const mod = (await import(path)) as { computeForecast?: ForecastFn };
    forecastFn = typeof mod.computeForecast === 'function' ? mod.computeForecast : null;
  } catch {
    forecastFn = null;
  }
  return forecastFn ?? null;
}

export async function compute_forecast(
  spaceId: string,
  args: { days: number },
): Promise<ComputeForecastResult | ReturnType<typeof unavailable>> {
  const days = Math.max(1, Math.min(90, Math.round(args.days)));
  const fn = await loadForecast();
  if (fn) {
    try {
      const out = await fn(spaceId, days);
      return {
        tool: 'compute_forecast',
        ok: true,
        days,
        recurringBase: Number(out.recurringBase ?? 0),
        variableTotal: Number(out.variableTotal ?? 0),
        total: Number(out.total ?? 0),
        source: 'forecast_service',
      };
    } catch (err) {
      log.warn('TOOL_FORECAST_RUNTIME_FAIL', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Defensive fallback: rolling average over the last 30 days, scaled
  // up to the requested window. Better than fabricating zero.
  try {
    const today = new Date();
    const ninetyDaysAgo = new Date(today);
    ninetyDaysAgo.setDate(today.getDate() - 30);
    const from = ninetyDaysAgo.toISOString().slice(0, 10);
    const to = today.toISOString().slice(0, 10);
    const [row] = await db
      .select({
        total: drizzleSql<number>`coalesce(sum(${transactions.baseAmount})::float, 0)`,
        days: drizzleSql<number>`greatest(count(distinct ${transactions.date}), 1)::int`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          isNull(transactions.deletedAt),
          eq(transactions.type, 'expense'),
          between(transactions.date, from, to),
        ),
      );
    const dailyAverage = Number(row?.total ?? 0) / Math.max(1, Number(row?.days ?? 1));
    return {
      tool: 'compute_forecast',
      ok: true,
      days,
      recurringBase: 0,
      variableTotal: dailyAverage * days,
      total: dailyAverage * days,
      source: 'rolling_average',
    };
  } catch (err) {
    log.warn('TOOL_FORECAST_FALLBACK_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return unavailable('compute_forecast', 'forecast service not ready');
  }
}

export interface FindRecurringResult {
  tool: 'find_recurring';
  ok: true;
  rows: Array<{
    id: string;
    displayName: string;
    averageAmount: number;
    currency: string;
    frequencyDays: number;
    nextExpectedDate: string | null;
    confidence: number;
  }>;
}

export async function find_recurring(
  spaceId: string,
): Promise<FindRecurringResult | ReturnType<typeof unavailable>> {
  try {
    const rows = await db
      .select()
      .from(recurringItems)
      .where(and(eq(recurringItems.spaceId, spaceId), eq(recurringItems.status, 'active')))
      .orderBy(desc(recurringItems.confidence));
    return {
      tool: 'find_recurring',
      ok: true,
      rows: rows.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        averageAmount: Number(r.averageAmount),
        currency: r.currency,
        frequencyDays: r.frequencyDays,
        nextExpectedDate: r.nextExpectedDate,
        confidence: Number(r.confidence),
      })),
    };
  } catch (err) {
    log.warn('TOOL_FIND_RECURRING_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return unavailable('find_recurring', 'recurring service not ready');
  }
}

export interface ComparePeriodsResult {
  tool: 'compare_periods';
  ok: true;
  a: ComputeTotalResult;
  b: ComputeTotalResult;
  deltaTotal: number;
  deltaByCategory: Array<{ category: string; aTotal: number; bTotal: number; delta: number }>;
}

export async function compare_periods(
  spaceId: string,
  args: { a: Range; b: Range },
): Promise<ComparePeriodsResult | ReturnType<typeof unavailable>> {
  const a = await compute_total(spaceId, { ...args.a, type: 'expense' });
  const b = await compute_total(spaceId, { ...args.b, type: 'expense' });
  if (!('ok' in a) || !a.ok || !('ok' in b) || !b.ok) {
    return unavailable('compare_periods', 'one or both ranges failed to load');
  }

  const aBreakdown = await compute_category_breakdown(spaceId, args.a);
  const bBreakdown = await compute_category_breakdown(spaceId, args.b);
  const aRows = 'ok' in aBreakdown && aBreakdown.ok ? aBreakdown.rows : [];
  const bRows = 'ok' in bBreakdown && bBreakdown.ok ? bBreakdown.rows : [];

  const cats = new Set<string>([...aRows.map((r) => r.category), ...bRows.map((r) => r.category)]);
  const deltaByCategory: ComparePeriodsResult['deltaByCategory'] = [];
  for (const cat of cats) {
    const aTotal = aRows.find((r) => r.category === cat)?.total ?? 0;
    const bTotal = bRows.find((r) => r.category === cat)?.total ?? 0;
    deltaByCategory.push({ category: cat, aTotal, bTotal, delta: bTotal - aTotal });
  }
  deltaByCategory.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  return {
    tool: 'compare_periods',
    ok: true,
    a,
    b,
    deltaTotal: b.total - a.total,
    deltaByCategory,
  };
}

/**
 * The OpenAI tool descriptors the model sees. Kept in one place so the
 * route handler can pass them straight to the chat completions API.
 */
export const COPILOT_TOOL_SPECS = [
  {
    type: 'function' as const,
    function: {
      name: 'compute_total',
      description:
        'Sum transactions in a date range. Optionally filter by category and/or type.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD inclusive' },
          to: { type: 'string', description: 'YYYY-MM-DD inclusive' },
          category: {
            type: 'string',
            description: 'optional category filter (use exact category name)',
          },
          type: {
            type: 'string',
            enum: ['income', 'expense', 'transfer'],
            description: 'optional type filter',
          },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'compute_category_breakdown',
      description:
        'Per-category expense totals between from and to dates, sorted descending.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD inclusive' },
          to: { type: 'string', description: 'YYYY-MM-DD inclusive' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'compute_forecast',
      description:
        'Forecast spending for the next N days. Returns recurring base + variable estimate + total.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 90 },
        },
        required: ['days'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_recurring',
      description: 'List detected recurring transactions with their next expected dates.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'compare_periods',
      description:
        'Compare expense totals and per-category deltas between two date ranges (a → b).',
      parameters: {
        type: 'object',
        properties: {
          a: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
            },
            required: ['from', 'to'],
          },
          b: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
            },
            required: ['from', 'to'],
          },
        },
        required: ['a', 'b'],
      },
    },
  },
];

/**
 * Dispatch a model-issued tool call to the matching server function.
 * Always returns a JSON-serializable object so the route can stuff it
 * straight back into the chat history as a `tool` message.
 */
export async function dispatchTool(
  spaceId: string,
  name: string,
  rawArgs: string,
): Promise<unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return unavailable(name, 'arguments were not valid JSON');
  }
  switch (name) {
    case 'compute_total':
      return compute_total(spaceId, args as unknown as ComputeTotalArgs);
    case 'compute_category_breakdown':
      return compute_category_breakdown(spaceId, args as unknown as BreakdownArgs);
    case 'compute_forecast':
      return compute_forecast(spaceId, args as unknown as { days: number });
    case 'find_recurring':
      return find_recurring(spaceId);
    case 'compare_periods':
      return compare_periods(spaceId, args as unknown as { a: Range; b: Range });
    default:
      return unavailable(name, 'unknown tool');
  }
}
