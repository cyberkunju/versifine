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
import { CATEGORIES, type TransactionSource, isCategory, type Category } from '@versifine/shared';
import { db } from '../../db/client.ts';
import { recurringItems } from '../../db/schema/recurring.ts';
import { transactions } from '../../db/schema/transactions.ts';
import { wallets } from '../../db/schema/wallets.ts';
import { log } from '../../utils/logger.ts';
import { createTransaction } from '../transactions/create.ts';
import { computeForecast } from '../forecast/index.ts';
import { listLiveWallets, pickWallet } from '../capture/wallet.ts';
import { emit } from '../events/bus.ts';
import {
  listBudgets,
  computeBudgetProgress,
  updateBudget,
  createBudget,
  recomputeAffectedBudgets,
} from '../budgets/index.ts';

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

function unavailable(
  tool: string,
  reason: string,
): {
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
    return unavailable('compute_category_breakdown', 'transaction services not ready');
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

export async function compute_forecast(
  spaceId: string,
  args: { days: number },
): Promise<ComputeForecastResult | ReturnType<typeof unavailable>> {
  const days = Math.max(1, Math.min(90, Math.round(args.days)));
  try {
    const out = await computeForecast(spaceId, days);
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
  const date =
    typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : todayIso();
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

    const row = await createTransaction({
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

export interface ListBudgetsResult {
  tool: 'list_budgets';
  ok: true;
  budgets: Array<{
    id: string;
    name: string;
    recurrence: string;
    warnThreshold: number;
    exceedThreshold: number;
    progress: any;
  }>;
}

export async function list_budgets(
  spaceId: string,
): Promise<ListBudgetsResult | ReturnType<typeof unavailable>> {
  try {
    const budgetList = await listBudgets(spaceId);
    const results = [];
    for (const b of budgetList) {
      const progress = await computeBudgetProgress(spaceId, b);
      results.push({
        id: b.id,
        name: b.name,
        recurrence: b.recurrence,
        warnThreshold: b.warnThreshold,
        exceedThreshold: b.exceedThreshold,
        progress,
      });
    }
    return { tool: 'list_budgets', ok: true, budgets: results };
  } catch (err) {
    log.warn('TOOL_LIST_BUDGETS_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return unavailable('list_budgets', 'failed to load budgets');
  }
}

export interface ListWalletsResult {
  tool: 'list_wallets';
  ok: true;
  wallets: Array<{
    id: string;
    name: string;
    type: string;
    currency: string;
    balance: number;
  }>;
}

export async function list_wallets(
  spaceId: string,
): Promise<ListWalletsResult | ReturnType<typeof unavailable>> {
  try {
    const rows = await db
      .select({
        id: wallets.id,
        name: wallets.name,
        type: wallets.type,
        currency: wallets.currency,
        balance: drizzleSql<string>`
          coalesce(sum(
            case
              when ${transactions.deletedAt} is not null then 0
              when ${transactions.type} = 'income' then ${transactions.amount}
              when ${transactions.type} = 'opening_balance' then ${transactions.amount}
              when ${transactions.type} = 'expense' then -${transactions.amount}
              when ${transactions.type} = 'transfer' then
                case when (${transactions.metadata} ->> 'side') = 'to' then ${transactions.amount}
                     else -${transactions.amount}
                end
              else 0
            end
          ), 0)
        `,
      })
      .from(wallets)
      .leftJoin(transactions, eq(transactions.walletId, wallets.id))
      .where(eq(wallets.spaceId, spaceId))
      .groupBy(wallets.id);

    return {
      tool: 'list_wallets',
      ok: true,
      wallets: rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        currency: r.currency,
        balance: Number(r.balance),
      })),
    };
  } catch (err) {
    log.warn('TOOL_LIST_WALLETS_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return unavailable('list_wallets', 'failed to load wallets');
  }
}

interface ListTransactionsArgs {
  limit?: number;
  type?: 'income' | 'expense' | 'transfer';
  category?: string;
  walletId?: string;
}

export interface ListTransactionsResult {
  tool: 'list_transactions';
  ok: true;
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    currency: string;
    description: string;
    category: string | null;
    date: string;
    walletName: string;
  }>;
}

export async function list_transactions(
  spaceId: string,
  args: ListTransactionsArgs,
): Promise<ListTransactionsResult | ReturnType<typeof unavailable>> {
  try {
    const limitVal = Math.min(50, Math.max(1, args.limit ?? 10));
    const filters: SQL[] = [eq(transactions.spaceId, spaceId), isNull(transactions.deletedAt)];
    if (args.type) filters.push(eq(transactions.type, args.type));
    if (args.category) filters.push(eq(transactions.category, args.category));
    if (args.walletId) filters.push(eq(transactions.walletId, args.walletId));

    const rows = await db
      .select({
        id: transactions.id,
        type: transactions.type,
        amount: transactions.amount,
        currency: transactions.currency,
        description: transactions.description,
        category: transactions.category,
        date: transactions.date,
        walletName: wallets.name,
      })
      .from(transactions)
      .innerJoin(wallets, eq(transactions.walletId, wallets.id))
      .where(and(...filters))
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(limitVal);

    return {
      tool: 'list_transactions',
      ok: true,
      transactions: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: Number(r.amount),
        currency: r.currency,
        description: r.description,
        category: r.category,
        date: r.date,
        walletName: r.walletName,
      })),
    };
  } catch (err) {
    log.warn('TOOL_LIST_TRANSACTIONS_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return unavailable('list_transactions', 'failed to load transactions');
  }
}

export interface DeleteTransactionResult {
  tool: 'delete_transaction';
  ok: true;
  transactionId: string;
}

export async function delete_transaction(
  ctx: ToolContext,
  args: { transactionId?: string },
): Promise<DeleteTransactionResult | ReturnType<typeof unavailable>> {
  try {
    let targetId = args.transactionId;
    if (!targetId) {
      // Find the most recent transaction
      const [lastTx] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.spaceId, ctx.spaceId), isNull(transactions.deletedAt)))
        .orderBy(desc(transactions.date), desc(transactions.createdAt))
        .limit(1);
      if (!lastTx) {
        return unavailable('delete_transaction', 'no transactions found to delete');
      }
      targetId = lastTx.id;
    }

    const [row] = await db
      .update(transactions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(transactions.id, targetId),
          eq(transactions.spaceId, ctx.spaceId),
          isNull(transactions.deletedAt),
        ),
      )
      .returning();

    if (!row) {
      return unavailable('delete_transaction', 'transaction not found or already deleted');
    }

    emit(ctx.userId, {
      type: 'transaction.deleted',
      entityId: targetId,
      data: { transactionId: targetId },
    });
    void recomputeAffectedBudgets(ctx.userId, ctx.spaceId, row.category);

    return {
      tool: 'delete_transaction',
      ok: true,
      transactionId: targetId,
    };
  } catch (err) {
    log.warn('TOOL_DELETE_TRANSACTION_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return unavailable('delete_transaction', 'failed to delete transaction');
  }
}

export interface SetBudgetResult {
  tool: 'set_budget';
  ok: true;
  budget: { id: string; name: string };
}

export async function set_budget(
  ctx: ToolContext,
  args: { category: string; amount: number; name?: string; recurrence?: 'monthly' | 'custom' },
): Promise<SetBudgetResult | ReturnType<typeof unavailable>> {
  try {
    if (!isCategory(args.category)) {
      return unavailable('set_budget', 'invalid category: must be one of the known finance categories');
    }
    const name = args.name || `${args.category} budget`;
    const recurrence = args.recurrence || 'monthly';
    const amount = Number(args.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return unavailable('set_budget', 'amount must be a positive number');
    }

    const budgetList = await listBudgets(ctx.spaceId);
    let matchedBudget = budgetList.find((b) => b.name.toLowerCase() === name.toLowerCase());
    if (!matchedBudget) {
      matchedBudget = budgetList.find((b) => {
        const allocs = b.allocations as Record<string, number>;
        return allocs && args.category in allocs;
      });
    }

    let budgetRow;
    if (matchedBudget) {
      const allocs = { ...(matchedBudget.allocations as Record<string, number>), [args.category]: amount };
      budgetRow = await updateBudget(ctx.spaceId, matchedBudget.id, {
        allocations: allocs,
      });
    } else {
      budgetRow = await createBudget(ctx.spaceId, {
        name,
        recurrence,
        allocations: { [args.category]: amount },
        warnThreshold: 80,
        exceedThreshold: 100,
      });
    }

    await recomputeAffectedBudgets(ctx.userId, ctx.spaceId, args.category);

    return {
      tool: 'set_budget',
      ok: true,
      budget: {
        id: budgetRow.id,
        name: budgetRow.name,
      },
    };
  } catch (err) {
    log.warn('TOOL_SET_BUDGET_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return unavailable('set_budget', 'failed to set budget');
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
      description: 'Sum transactions in a date range. Optionally filter by category and/or type.',
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
      description: 'Per-category expense totals between from and to dates, sorted descending.',
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
          currency: {
            type: 'string',
            description: 'optional ISO code like INR/USD; omit for default',
          },
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
  {
    type: 'function' as const,
    function: {
      name: 'list_budgets',
      description: 'List all active budgets, allocations, and live progress/spent details.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_wallets',
      description: 'List all active wallets and their current live balances.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_transactions',
      description: 'List recent transactions in the space, optionally filtered by type, category, or walletId.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'max transactions to return, default 10, max 50' },
          type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
          category: { type: 'string', description: 'filter by category name' },
          walletId: { type: 'string', description: 'filter by wallet UUID' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_transaction',
      description: 'Delete or undo a transaction. If transactionId is not provided, it deletes the most recent transaction.',
      parameters: {
        type: 'object',
        properties: {
          transactionId: { type: 'string', description: 'the UUID of the transaction to delete' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_budget',
      description: 'Set or update a budget allocation for a category.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'the category name, e.g. "Groceries", "Restaurants"' },
          amount: { type: 'number', description: 'positive budget amount to allocate' },
          name: { type: 'string', description: 'optional name for the budget' },
          recurrence: { type: 'string', enum: ['monthly', 'custom'], description: 'default monthly' },
        },
        required: ['category', 'amount'],
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
    case 'list_budgets':
      return list_budgets(ctx.spaceId);
    case 'list_wallets':
      return list_wallets(ctx.spaceId);
    case 'list_transactions':
      return list_transactions(ctx.spaceId, args as unknown as ListTransactionsArgs);
    case 'delete_transaction':
      return delete_transaction(ctx, args as unknown as { transactionId?: string });
    case 'set_budget':
      return set_budget(ctx, args as unknown as { category: string; amount: number; name?: string; recurrence?: 'monthly' | 'custom' });
    default:
      return unavailable(name, 'unknown tool');
  }
}
