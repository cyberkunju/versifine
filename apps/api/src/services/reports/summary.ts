/**
 * Report summary builder.
 *
 * The dashboard's monthly review and the CSV export both lean on the same
 * shape: totals, category breakdown, top merchants, per-wallet spend, and
 * budget adherence. We compute everything in a handful of grouped SQL
 * queries — cheap on the demo dataset, and easier to reason about than a
 * single mega-query that returns every roll-up at once.
 *
 * `from`/`to` are inclusive ISO dates. Budget adherence is computed against
 * each budget's allocations using the same period as the report; we do not
 * filter by the budget's own period boundaries because the user is asking
 * "how did I do in *this* window?" not "how is this budget cycle looking?".
 */
import { and, desc, eq, gte, isNotNull, isNull, lte, sql as drizzleSql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { budgets, type Budget } from '../../db/schema/budgets.ts';
import { transactions } from '../../db/schema/transactions.ts';
import { wallets } from '../../db/schema/wallets.ts';
import { errors } from '../../utils/errors.ts';
import { normalizeMerchant } from '../transactions/normalize.ts';

export interface ReportRange {
  from: string;
  to: string;
}

export interface ReportSummary {
  range: ReportRange;
  totals: {
    income: number;
    expense: number;
    savings: number;
    savingsRate: number;
  };
  byCategory: Array<{ category: string; total: number }>;
  byMerchant: Array<{ merchant: string; total: number }>;
  byWallet: Array<{
    walletId: string;
    walletName: string;
    currency: string;
    total: number;
  }>;
  budgetAdherence: Array<{
    budgetId: string;
    name: string;
    allocated: number;
    spent: number;
    percentage: number;
  }>;
  dayCount: number;
  transactionCount: number;
}

export async function computeSummary(spaceId: string, range: ReportRange): Promise<ReportSummary> {
  validateRange(range);

  const totalsRows = await db
    .select({
      type: transactions.type,
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
      count: drizzleSql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(rangeFilter(spaceId, range))
    .groupBy(transactions.type);

  let income = 0;
  let expense = 0;
  let transactionCount = 0;
  for (const row of totalsRows) {
    transactionCount += Number(row.count);
    if (row.type === 'income') income += Number(row.total);
    else if (row.type === 'expense') expense += Number(row.total);
    // Transfers and opening balances don't move the savings needle.
  }
  const savings = income - expense;
  const savingsRate = income > 0 ? round2((savings / income) * 100) : 0;

  const byCategory = await db
    .select({
      category: transactions.category,
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        rangeFilter(spaceId, range),
        eq(transactions.type, 'expense'),
        isNotNull(transactions.category),
      ),
    )
    .groupBy(transactions.category)
    .orderBy(desc(drizzleSql`sum(${transactions.baseAmount})`));

  const merchantRows = await db
    .select({
      description: transactions.description,
      amount: transactions.baseAmount,
    })
    .from(transactions)
    .where(and(rangeFilter(spaceId, range), eq(transactions.type, 'expense')));

  const merchantTotals = new Map<string, number>();
  for (const row of merchantRows) {
    const merchant = normalizeMerchant(row.description) || row.description.trim().slice(0, 80);
    if (!merchant) continue;
    merchantTotals.set(merchant, (merchantTotals.get(merchant) ?? 0) + Number(row.amount));
  }
  const byMerchant = Array.from(merchantTotals.entries())
    .map(([merchant, total]) => ({ merchant, total: round2(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const walletRows = await db
    .select({
      walletId: wallets.id,
      walletName: wallets.name,
      currency: wallets.currency,
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
    })
    .from(wallets)
    .leftJoin(
      transactions,
      and(
        eq(transactions.walletId, wallets.id),
        eq(transactions.type, 'expense'),
        isNull(transactions.deletedAt),
        gte(transactions.date, range.from),
        lte(transactions.date, range.to),
      ),
    )
    .where(eq(wallets.spaceId, spaceId))
    .groupBy(wallets.id, wallets.name, wallets.currency)
    .orderBy(desc(drizzleSql`sum(${transactions.baseAmount})`));

  const byWallet = walletRows.map((r) => ({
    walletId: r.walletId,
    walletName: r.walletName,
    currency: r.currency,
    total: round2(Number(r.total)),
  }));

  const budgetAdherence = await computeBudgetAdherence(spaceId, range);

  const dayCount = Math.max(1, Math.round(diffDays(range.from, range.to))) + 0;

  return {
    range,
    totals: {
      income: round2(income),
      expense: round2(expense),
      savings: round2(savings),
      savingsRate,
    },
    byCategory: byCategory
      .filter((r) => r.category !== null)
      .map((r) => ({ category: r.category as string, total: round2(Number(r.total)) })),
    byMerchant,
    byWallet,
    budgetAdherence,
    dayCount,
    transactionCount,
  };
}

async function computeBudgetAdherence(
  spaceId: string,
  range: ReportRange,
): Promise<ReportSummary['budgetAdherence']> {
  const allBudgets = await db.select().from(budgets).where(eq(budgets.spaceId, spaceId));
  if (allBudgets.length === 0) return [];

  const categorySpend = await db
    .select({
      category: transactions.category,
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        rangeFilter(spaceId, range),
        eq(transactions.type, 'expense'),
        isNotNull(transactions.category),
      ),
    )
    .groupBy(transactions.category);

  const spentByCategory = new Map<string, number>();
  for (const row of categorySpend) {
    if (row.category) spentByCategory.set(row.category, Number(row.total));
  }

  return allBudgets.map((b: Budget) => {
    const allocations = (b.allocations ?? {}) as Record<string, number>;
    let allocated = 0;
    let spent = 0;
    for (const [category, allocation] of Object.entries(allocations)) {
      allocated += Number(allocation);
      spent += spentByCategory.get(category) ?? 0;
    }
    const percentage = allocated > 0 ? round2((spent / allocated) * 100) : 0;
    return {
      budgetId: b.id,
      name: b.name,
      allocated: round2(allocated),
      spent: round2(spent),
      percentage,
    };
  });
}

function rangeFilter(spaceId: string, range: ReportRange) {
  return and(
    eq(transactions.spaceId, spaceId),
    isNull(transactions.deletedAt),
    gte(transactions.date, range.from),
    lte(transactions.date, range.to),
  );
}

function validateRange(range: ReportRange): void {
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoRe.test(range.from) || !isoRe.test(range.to)) {
    throw errors.validation('range.from and range.to must be ISO dates (YYYY-MM-DD)');
  }
  if (range.from > range.to) {
    throw errors.validation('range.from must be on or before range.to');
  }
}

function diffDays(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return (b - a) / 86_400_000 + 1;
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
