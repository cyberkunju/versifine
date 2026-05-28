/**
 * Transaction list query.
 *
 * Filters mirror `transactionListQuery` in `@finehance/shared`. All queries
 * are scoped to the caller's `space_id` and exclude soft-deleted rows by
 * default. Search uses Postgres trigram on the description; the GIN index
 * on `transactions.description` keeps this snappy for the demo dataset.
 */
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  sql as drizzleSql,
  type SQL,
} from 'drizzle-orm';
import {
  type TransactionListQuery,
  transactionListQuery,
  type TransactionSummary,
} from '@finehance/shared';
import { db } from '../../db/client.ts';
import { transactions, type Transaction } from '../../db/schema/transactions.ts';

export interface ListResult {
  items: TransactionSummary[];
  total: number;
  limit: number;
  offset: number;
}

export async function listTransactions(
  spaceId: string,
  rawQuery: Record<string, unknown>,
  options: { includeDeleted?: boolean } = {},
): Promise<ListResult> {
  const q: TransactionListQuery = transactionListQuery.parse(rawQuery);

  const filters: SQL[] = [eq(transactions.spaceId, spaceId)];
  if (!options.includeDeleted) filters.push(isNull(transactions.deletedAt));
  if (q.from) filters.push(gte(transactions.date, q.from));
  if (q.to) filters.push(lte(transactions.date, q.to));
  if (q.type) filters.push(eq(transactions.type, q.type));
  if (q.category) filters.push(eq(transactions.category, q.category));
  if (q.walletId) filters.push(eq(transactions.walletId, q.walletId));
  if (q.search) filters.push(ilike(transactions.description, `%${escapeLike(q.search)}%`));
  if (q.tag) filters.push(drizzleSql`${q.tag} = any(${transactions.tags})`);

  const where = and(...filters);

  const countRows = await db
    .select({ count: drizzleSql<number>`count(*)::int` })
    .from(transactions)
    .where(where);
  const total = Number(countRows[0]?.count ?? 0);

  const rows = await db
    .select()
    .from(transactions)
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(q.limit)
    .offset(q.offset);

  return {
    items: rows.map(serializeTransaction),
    total,
    limit: q.limit,
    offset: q.offset,
  };
}

export async function getTransactionById(
  spaceId: string,
  transactionId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<Transaction | null> {
  const filters: SQL[] = [eq(transactions.spaceId, spaceId), eq(transactions.id, transactionId)];
  if (!options.includeDeleted) filters.push(isNull(transactions.deletedAt));
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(...filters))
    .limit(1);
  return row ?? null;
}

export function serializeTransaction(row: Transaction): TransactionSummary {
  return {
    id: row.id,
    type: row.type as TransactionSummary['type'],
    amount: Number(row.amount),
    currency: row.currency as TransactionSummary['currency'],
    baseAmount: Number(row.baseAmount),
    date: row.date,
    description: row.description,
    category: (row.category as TransactionSummary['category']) ?? null,
    categoryConfidence:
      row.categoryConfidence !== null ? Number(row.categoryConfidence) : null,
    categorizedBy: (row.categorizedBy as TransactionSummary['categorizedBy']) ?? null,
    walletId: row.walletId,
    notes: row.notes,
    tags: row.tags,
    source: row.source as TransactionSummary['source'],
    transferId: row.transferId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Sum non-deleted transactions in a window, optionally filtered by category.
 *
 * Used by the omnibar's `query_spending` intent path so the user can ask
 * "how much did I spend on food this month" and get the answer without
 * opening the copilot panel. Returns the total in `base_amount` (already
 * converted to wallet currency at write time) so multi-currency wallets
 * sum sensibly.
 */
export interface TotalSpentResult {
  total: number;
  count: number;
  category: string | null;
  range: { from: string; to: string };
}

export async function totalSpentByCategory(
  spaceId: string,
  category: string | null,
  range: { from: string; to: string },
): Promise<TotalSpentResult> {
  const filters: SQL[] = [
    eq(transactions.spaceId, spaceId),
    isNull(transactions.deletedAt),
    eq(transactions.type, 'expense'),
    gte(transactions.date, range.from),
    lte(transactions.date, range.to),
  ];
  if (category) filters.push(eq(transactions.category, category));

  const [row] = await db
    .select({
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
      count: drizzleSql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...filters));

  return {
    total: Number(row?.total ?? 0),
    count: Number(row?.count ?? 0),
    category,
    range,
  };
}

/**
 * High-level monthly summary: income, expense, savings, top categories.
 *
 * Drives the omnibar's `query_summary` answer card. A single grouped query
 * gives totals by type; a second query gets the top five expense categories
 * by base amount.
 */
export interface SummaryResult {
  range: { from: string; to: string };
  totals: { income: number; expense: number; savings: number };
  topCategories: Array<{ category: string; total: number }>;
  transactionCount: number;
}

export async function summarize(
  spaceId: string,
  rangeOpt?: { from: string; to: string },
): Promise<SummaryResult> {
  const range = rangeOpt ?? thisMonthRange();
  const baseFilters: SQL[] = [
    eq(transactions.spaceId, spaceId),
    isNull(transactions.deletedAt),
    gte(transactions.date, range.from),
    lte(transactions.date, range.to),
  ];

  const totalsRows = await db
    .select({
      type: transactions.type,
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
      count: drizzleSql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...baseFilters))
    .groupBy(transactions.type);

  let income = 0;
  let expense = 0;
  let count = 0;
  for (const r of totalsRows) {
    count += Number(r.count);
    if (r.type === 'income') income += Number(r.total);
    else if (r.type === 'expense') expense += Number(r.total);
  }

  const catRows = await db
    .select({
      category: transactions.category,
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
    })
    .from(transactions)
    .where(and(...baseFilters, eq(transactions.type, 'expense')))
    .groupBy(transactions.category)
    .orderBy(desc(drizzleSql`sum(${transactions.baseAmount})`))
    .limit(5);

  return {
    range,
    totals: {
      income: round2(income),
      expense: round2(expense),
      savings: round2(income - expense),
    },
    topCategories: catRows
      .filter((r) => r.category !== null)
      .map((r) => ({ category: r.category as string, total: round2(Number(r.total)) })),
    transactionCount: count,
  };
}

function thisMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return { from: iso(from), to: iso(now) };
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
