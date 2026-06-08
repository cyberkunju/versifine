/**
 * Budgets — CRUD plus progress computation and threshold alerting.
 *
 * Progress is always computed live from `transactions` (we never cache the
 * spent number on the budget row). For a `monthly` budget the period is
 * derived from "today" — first-of-month to last-day-of-month. For `custom`
 * we use the stored `period_start`/`period_end`.
 *
 * Threshold alerts: every time we recompute progress, we check each
 * category's percentage. If a category newly crosses `warnThreshold` (or
 * `exceedThreshold`) since the last cached snapshot, we emit
 * `budget.warning` (or `budget.exceeded`). The cache is per-process and
 * keyed by `<budgetId>:<category>:<periodStart>:<periodEnd>` so two
 * processes will both fire on first crossing — acceptable for a hackathon
 * single-instance API.
 */
import { and, eq, gte, isNull, lte, sql as drizzleSql } from 'drizzle-orm';
import {
  type BudgetCreateInput,
  type BudgetProgress,
  type Category,
  isCategory,
} from '@versifine/shared';
import { db } from '../../db/client.ts';
import { budgets, type Budget } from '../../db/schema/budgets.ts';
import { transactions } from '../../db/schema/transactions.ts';
import { errors } from '../../utils/errors.ts';
import { emit } from '../events/bus.ts';

type PerCategoryStatus = 'ok' | 'warn' | 'exceeded';

interface AlertCacheEntry {
  category: string;
  status: PerCategoryStatus;
}

const alertCache = new Map<string, AlertCacheEntry>();

function alertCacheKey(
  budgetId: string,
  category: string,
  period: { start: string; end: string },
): string {
  return `${budgetId}:${category}:${period.start}:${period.end}`;
}

function deriveMonthlyPeriod(today = new Date()): { start: string; end: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function periodFor(budget: Budget): { start: string; end: string } {
  if (budget.recurrence === 'monthly') return deriveMonthlyPeriod();
  if (!budget.periodStart || !budget.periodEnd) {
    throw errors.validation('Custom budget missing periodStart/periodEnd');
  }
  return { start: budget.periodStart, end: budget.periodEnd };
}

function statusFor(percentage: number, warn: number, exceed: number): PerCategoryStatus {
  if (percentage >= exceed) return 'exceeded';
  if (percentage >= warn) return 'warn';
  return 'ok';
}

export async function listBudgets(spaceId: string): Promise<Budget[]> {
  return await db.select().from(budgets).where(eq(budgets.spaceId, spaceId));
}

export async function getBudget(spaceId: string, budgetId: string): Promise<Budget | null> {
  const [row] = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.spaceId, spaceId)))
    .limit(1);
  return row ?? null;
}

export async function createBudget(spaceId: string, input: BudgetCreateInput): Promise<Budget> {
  const [row] = await db
    .insert(budgets)
    .values({
      spaceId,
      name: input.name,
      recurrence: input.recurrence,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      allocations: input.allocations,
      overallLimit: input.overallLimit != null ? input.overallLimit.toFixed(2) : null,
      warnThreshold: input.warnThreshold,
      exceedThreshold: input.exceedThreshold,
    })
    .returning();
  if (!row) throw errors.internal('Budget create failed');
  return row;
}

export async function updateBudget(
  spaceId: string,
  budgetId: string,
  patch: {
    name?: string;
    allocations?: Record<string, number>;
    overallLimit?: number | null;
    warnThreshold?: number;
    exceedThreshold?: number;
  },
): Promise<Budget> {
  const existing = await getBudget(spaceId, budgetId);
  if (!existing) throw errors.notFound('Budget not found');
  const updates: Partial<typeof budgets.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.allocations !== undefined) updates.allocations = patch.allocations;
  if (patch.overallLimit !== undefined)
    updates.overallLimit = patch.overallLimit === null ? null : patch.overallLimit.toFixed(2);
  if (patch.warnThreshold !== undefined) updates.warnThreshold = patch.warnThreshold;
  if (patch.exceedThreshold !== undefined) updates.exceedThreshold = patch.exceedThreshold;
  const [row] = await db
    .update(budgets)
    .set(updates)
    .where(and(eq(budgets.id, budgetId), eq(budgets.spaceId, spaceId)))
    .returning();
  if (!row) throw errors.internal('Budget update failed');
  return row;
}

export async function deleteBudget(spaceId: string, budgetId: string): Promise<void> {
  const result = await db
    .delete(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.spaceId, spaceId)))
    .returning({ id: budgets.id });
  if (result.length === 0) throw errors.notFound('Budget not found');
}

export async function computeBudgetProgress(
  spaceId: string,
  budget: Budget,
): Promise<BudgetProgress> {
  const period = periodFor(budget);
  const warn = budget.warnThreshold;
  const exceed = budget.exceedThreshold;

  // Aggregate expense spend per category in the period.
  const rows = await db
    .select({
      category: transactions.category,
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.spaceId, spaceId),
        eq(transactions.type, 'expense'),
        isNull(transactions.deletedAt),
        gte(transactions.date, period.start),
        lte(transactions.date, period.end),
      ),
    )
    .groupBy(transactions.category);

  const spentByCategory = new Map<string, number>();
  let totalPeriodSpend = 0;
  for (const r of rows) {
    if (r.category) spentByCategory.set(r.category, Number(r.total));
    totalPeriodSpend += Number(r.total);
  }

  const allocations = (budget.allocations ?? {}) as Record<string, number>;
  const perCategory: BudgetProgress['perCategory'] = {} as BudgetProgress['perCategory'];
  let totalAllocated = 0;
  let totalSpent = 0;
  for (const [rawCategory, allocated] of Object.entries(allocations)) {
    if (!isCategory(rawCategory)) continue;
    const category = rawCategory as Category;
    const spent = spentByCategory.get(category) ?? 0;
    const remaining = allocated - spent;
    const percentage = allocated > 0 ? (spent / allocated) * 100 : 0;
    const status = statusFor(percentage, warn, exceed);
    perCategory[category] = {
      allocated: Number(allocated),
      spent: round2(spent),
      remaining: round2(remaining),
      percentage: round2(percentage),
      status,
    };
    totalAllocated += allocated;
    totalSpent += spent;
  }

  // Overall (all-category) cap, when set. Measured against EVERY expense in the
  // period, not just allocated categories.
  let overall: BudgetProgress['overall'] = null;
  if (budget.overallLimit != null) {
    const limit = Number(budget.overallLimit);
    const percentage = limit > 0 ? (totalPeriodSpend / limit) * 100 : 0;
    overall = {
      limit: round2(limit),
      spent: round2(totalPeriodSpend),
      remaining: round2(limit - totalPeriodSpend),
      percentage: round2(percentage),
      status: statusFor(percentage, warn, exceed),
    };
  }

  return {
    budgetId: budget.id,
    periodStart: period.start,
    periodEnd: period.end,
    perCategory,
    overall,
    totals: {
      allocated: round2(totalAllocated),
      spent: round2(totalSpent),
      remaining: round2(totalAllocated - totalSpent),
    },
  };
}

/**
 * Recompute every budget that allocates the given category, and emit
 * `budget.warning` / `budget.exceeded` for any category that newly crossed
 * its threshold since the last computation. Idempotent: the per-process
 * `alertCache` ensures we only fire on the first transition.
 */
export async function recomputeAffectedBudgets(
  userId: string,
  spaceId: string,
  affectedCategory: string | null,
): Promise<void> {
  const all = await listBudgets(spaceId);
  for (const budget of all) {
    const allocations = (budget.allocations ?? {}) as Record<string, number>;
    const hasOverall = budget.overallLimit != null;
    // A per-category budget only needs recompute when the affected category is
    // one it allocates; an overall budget is touched by ANY expense.
    if (affectedCategory && !hasOverall && !(affectedCategory in allocations)) continue;
    let progress: BudgetProgress;
    try {
      progress = await computeBudgetProgress(spaceId, budget);
    } catch {
      continue;
    }
    const period = { start: progress.periodStart, end: progress.periodEnd };

    // Overall-cap crossing alerts (category key '__overall__').
    if (progress.overall) {
      const key = alertCacheKey(budget.id, '__overall__', period);
      const prior = alertCache.get(key);
      const status = progress.overall.status;
      alertCache.set(key, { category: '__overall__', status });
      if (prior?.status !== status) {
        if (status === 'warn' && (prior?.status ?? 'ok') === 'ok') {
          emit(userId, {
            type: 'budget.warning',
            entityId: budget.id,
            data: {
              budgetId: budget.id,
              category: 'Overall',
              allocated: progress.overall.limit,
              spent: progress.overall.spent,
              percentage: progress.overall.percentage,
            },
          });
        }
        if (status === 'exceeded' && prior?.status !== 'exceeded') {
          emit(userId, {
            type: 'budget.exceeded',
            entityId: budget.id,
            data: {
              budgetId: budget.id,
              category: 'Overall',
              allocated: progress.overall.limit,
              spent: progress.overall.spent,
              overBy: round2(progress.overall.spent - progress.overall.limit),
            },
          });
        }
      }
    }

    for (const [category, info] of Object.entries(progress.perCategory)) {
      if (!info) continue;
      const key = alertCacheKey(budget.id, category, period);
      const prior = alertCache.get(key);
      const status = info.status;
      alertCache.set(key, { category, status });
      if (prior?.status === status) continue;
      if (status === 'warn' && (prior?.status ?? 'ok') === 'ok') {
        emit(userId, {
          type: 'budget.warning',
          entityId: budget.id,
          data: {
            budgetId: budget.id,
            category,
            allocated: info.allocated,
            spent: info.spent,
            percentage: info.percentage,
          },
        });
      }
      if (status === 'exceeded' && prior?.status !== 'exceeded') {
        emit(userId, {
          type: 'budget.exceeded',
          entityId: budget.id,
          data: {
            budgetId: budget.id,
            category,
            allocated: info.allocated,
            spent: info.spent,
            overBy: round2(info.spent - info.allocated),
          },
        });
      }
    }
  }
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export type { Budget } from '../../db/schema/budgets.ts';
