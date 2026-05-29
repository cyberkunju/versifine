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
import { CATEGORIES, type TransactionSource } from '@versifine/shared';
import { db } from '../../db/client.ts';
import { recurringItems } from '../../db/schema/recurring.ts';
import { transactions } from '../../db/schema/transactions.ts';
import { log } from '../../utils/logger.ts';
import { listLiveWallets, pickWallet } from '../capture/wallet.ts';

type Range = { from: string; to: string };

/**
 * Context every tool dispatch carries. Read tools only need the space id;
 * the write tool (`log_transaction`) also needs the acting user id (for the
 * WS event + audit) and the surface it came from (web vs WhatsApp).
 */
export interface ToolContext {
  spaceId: string;
  userId: string;
  source?: TransactionSource;
}

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

/* ------------------------------------------------------------------ *
 * Write tool — log a transaction.
 *
 * The copilot is otherwise read-only; this is the single mutation it can
 * perform, and it routes through the SAME createTransaction pipeline the
 * omnibar and bot use (FX, categorisation, budget recompute, WS events).
 * It is space-scoped and validates input, so the model cannot fabricate a
 * cross-tenant write or a malformed row.
 * ------------------------------------------------------------------ */
interface LogTransactionArgs {
  type?: 'expense' | 'income';
  amount?: number;
  description?: string;
  category?: string | null;
  currency?: string | null;
  date?: string | null;
  walletHint?: string | null;
}

export interface LogTransactionResult {
  tool: 'log_transaction';
  ok: true;
  transaction: {
    id: string;
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    currency: string;
    description: string;
    category: string | null;
    date: string;
    wallet: string;
  };
}

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function log_transaction(
  ctx: ToolContext,
  args: LogTransactionArgs,
): Promise<LogTransactionResult | ReturnType<typeof unavailable>> {
  const amount = typeof args.amount === 'number' ? args.amount : Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return unavailable('log_transaction', 'a positive amount is required');
  }
  const description = (args.description ?? '').toString().trim().slice(0, 280);
  if (!description) {
    return unavailable('log_transaction', 'a short description is required');
  }
  const type: 'expense' | 'income' = args.type === 'income' ? 'income' : 'expense';
  const date = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
    ? args.date
    : todayIso();
  const currency =
    typeof args.currency === 'string' && args.currency.trim()
      ? args.currency.trim().toUpperCase().slice(0, 3)
      : undefined;
  const category =
    typeof args.category === 'string' && (CATEGORIES as readonly string[]).includes(args.category)
      ? args.category
      : undefined;

  // Resolve a wallet in this space (hint → exact/word/type → first wallet).
  const live = await listLiveWallets(ctx.spaceId);
  const pick = pickWallet(live, args.walletHint ?? null);
  if (!pick.wallet) {
    return unavailable('log_transaction', 'no wallet is set up yet — add one first');
  }

  try {
    // Lazy import keeps copilotTools cycle-free with the transactions module.
    const path = '../transactions/' + 'create.ts';
    const mod = (await import(path)) as {
      createTransaction?: (opts: {
        userId: string;
        spaceId: string;
        source: TransactionSource;
        input: Record<string, unknown>;
      }) => Promise<{
        id: string;
        type: string;
        amount: string;
        currency: string;
        description: string;
        category: string | null;
        date: string;
      }>;
    };
    if (typeof mod.createTransaction !== 'function') {
      return unavailable('log_transaction', 'transaction service not ready');
    }
    const input: Record<string, unknown> = {
      type,
      amount,
      date,
      description,
      walletId: pick.wallet.id,
      tags: [],
    };
    if (currency) input.currency = currency;
    if (category) input.category = category;

    const row = await mod.createTransaction({
      userId: ctx.userId,
      spaceId: ctx.spaceId,
      source: ctx.source ?? 'manual_web',
      input,
    });

    return {
      tool: 'log_transaction',
      ok: true,
      transaction: {
        id: row.id,
        type: (row.type === 'opening_balance' ? 'expense' : row.type) as
          | 'income'
          | 'expense'
          | 'transfer',
        amount: Number(row.amount),
        currency: row.currency,
        description: row.description,
        category: row.category,
        date: row.date,
        wallet: pick.wallet.name,
      },
    };
  } catch (err) {
    log.warn('TOOL_LOG_TRANSACTION_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    return unavailable('log_transaction', 'could not save the transaction');
  }
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
  {
    type: 'function' as const,
    function: {
      name: 'log_transaction',
      description:
        'Record a new expense or income for the user. Use this when the user asks to log/add/record a spend or income (e.g. "log 1000 for taxi", "add my 85000 salary"). Only call when you have at least an amount and a short description; if the amount or what it was for is unclear, ask first instead of guessing.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['expense', 'income'],
            description: 'expense (money out) or income (money in). Default expense.',
          },
          amount: { type: 'number', description: 'positive amount in the wallet currency' },
          description: {
            type: 'string',
            description: 'short noun phrase of what it was for, e.g. "taxi", "salary", "groceries"',
          },
          category: {
            type: 'string',
            description: 'optional category name; omit to let the server categorise',
          },
          currency: { type: 'string', description: 'optional ISO code like INR/USD; omit for default' },
          date: { type: 'string', description: 'optional YYYY-MM-DD; omit for today' },
          walletHint: {
            type: 'string',
            description: 'optional wallet name/type the user named (e.g. "cash", "hdfc")',
          },
        },
        required: ['amount', 'description'],
      },
    },
  },
];

/**
 * Dispatch a model-issued tool call to the matching server function.
 * Always returns a JSON-serializable object so the route can stuff it
 * straight back into the chat history as a `tool` message.
 *
 * Read tools only need `ctx.spaceId`; `log_transaction` also uses
 * `ctx.userId` + `ctx.source` for the write + WS event.
 */
export async function dispatchTool(
  ctx: ToolContext,
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
      return compute_total(ctx.spaceId, args as unknown as ComputeTotalArgs);
    case 'compute_category_breakdown':
      return compute_category_breakdown(ctx.spaceId, args as unknown as BreakdownArgs);
    case 'compute_forecast':
      return compute_forecast(ctx.spaceId, args as unknown as { days: number });
    case 'find_recurring':
      return find_recurring(ctx.spaceId);
    case 'compare_periods':
      return compare_periods(ctx.spaceId, args as unknown as { a: Range; b: Range });
    case 'log_transaction':
      return log_transaction(ctx, args as unknown as LogTransactionArgs);
    default:
      return unavailable(name, 'unknown tool');
  }
}
