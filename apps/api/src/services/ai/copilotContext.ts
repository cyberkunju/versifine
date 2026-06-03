/**
 * Shared copilot context builder.
 *
 * Both the streaming web copilot (`routes/copilot.ts`) and the
 * non-streaming WhatsApp answer path (`copilotAnswer.ts`) need the same
 * grounded snapshot of the user's finances: this month vs last month, top
 * categories, active recurring items and goals, plus the transactions most
 * similar to the question (pgvector cosine search).
 *
 * Security: every user-controlled string that lands in the rendered block
 * (transaction descriptions, goal/category names, recurring labels) is run
 * through `sanitizeUntrusted` and the whole block is wrapped in
 * `fenceUntrusted` so the model treats it as DATA, never instructions.
 */
import { and, desc, eq, gte, isNotNull, isNull, lte, sql as drizzleSql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { goals } from '../../db/schema/goals.ts';
import { recurringItems } from '../../db/schema/recurring.ts';
import { transactionEmbeddings } from '../../db/schema/embeddings.ts';
import { transactions } from '../../db/schema/transactions.ts';
import type { AuthedUser } from '../../middleware/auth.ts';
import { log } from '../../utils/logger.ts';
import { isAIConfigured } from './client.ts';
import { embed } from './embed.ts';
import { fenceUntrusted, sanitizeUntrusted } from './guard.ts';

export interface ContextSummary {
  thisMonth: { income: number; expense: number; savings: number };
  lastMonth: { income: number; expense: number; savings: number };
  topCategoriesThisMonth: Array<{ category: string; total: number }>;
  recurring: Array<{
    displayName: string;
    averageAmount: number;
    frequencyDays: number;
    nextExpectedDate: string | null;
  }>;
  goals: Array<{
    name: string;
    target: number;
    current: number;
    progress: number;
    deadline: string | null;
  }>;
  retrieved: Array<{
    date: string;
    amount: number;
    category: string | null;
    description: string;
  }>;
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function monthBounds(date: Date): { from: string; to: string } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

async function aggregateMonth(
  spaceId: string,
  range: { from: string; to: string },
): Promise<{ income: number; expense: number; savings: number }> {
  const rows = await db
    .select({
      type: transactions.type,
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.spaceId, spaceId),
        isNull(transactions.deletedAt),
        gte(transactions.date, range.from),
        lte(transactions.date, range.to),
      ),
    )
    .groupBy(transactions.type);
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    if (r.type === 'income') income += Number(r.total);
    else if (r.type === 'expense') expense += Number(r.total);
  }
  return { income: round2(income), expense: round2(expense), savings: round2(income - expense) };
}

async function aggregateTopCategories(
  spaceId: string,
  range: { from: string; to: string },
): Promise<Array<{ category: string; total: number }>> {
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
        isNotNull(transactions.category),
        isNull(transactions.deletedAt),
        gte(transactions.date, range.from),
        lte(transactions.date, range.to),
      ),
    )
    .groupBy(transactions.category)
    .orderBy(desc(drizzleSql`sum(${transactions.baseAmount})`))
    .limit(5);
  return rows
    .filter((r) => r.category !== null)
    .map((r) => ({ category: r.category as string, total: round2(Number(r.total)) }));
}

async function retrieveRelevant(
  spaceId: string,
  queryVector: number[],
): Promise<ContextSummary['retrieved']> {
  if (queryVector.every((v) => v === 0)) return [];
  const literal = `[${queryVector.join(',')}]`;
  const rows = await db
    .select({
      date: transactions.date,
      amount: transactions.baseAmount,
      category: transactions.category,
      description: transactions.description,
    })
    .from(transactionEmbeddings)
    .innerJoin(transactions, eq(transactions.id, transactionEmbeddings.transactionId))
    .where(and(eq(transactionEmbeddings.spaceId, spaceId), isNull(transactions.deletedAt)))
    .orderBy(drizzleSql`${transactionEmbeddings.embedding} <=> ${literal}::vector`)
    .limit(20);
  return rows.map((r) => ({
    date: r.date,
    amount: round2(Number(r.amount)),
    category: r.category,
    description: r.description.slice(0, 200),
  }));
}

export async function buildContext(
  spaceId: string,
  lastUserMessage: string,
): Promise<ContextSummary> {
  const today = new Date();
  const thisMonthRange = monthBounds(today);
  const lastMonthRef = new Date(today);
  lastMonthRef.setUTCDate(1);
  lastMonthRef.setUTCMonth(lastMonthRef.getUTCMonth() - 1);
  const lastMonthRange = monthBounds(lastMonthRef);

  const [thisTotals, lastTotals, topCats, recurringRows, goalRows] = await Promise.all([
    aggregateMonth(spaceId, thisMonthRange),
    aggregateMonth(spaceId, lastMonthRange),
    aggregateTopCategories(spaceId, thisMonthRange),
    db
      .select()
      .from(recurringItems)
      .where(and(eq(recurringItems.spaceId, spaceId), eq(recurringItems.status, 'active')))
      .limit(20),
    db
      .select()
      .from(goals)
      .where(and(eq(goals.spaceId, spaceId), eq(goals.status, 'active')))
      .limit(10),
  ]);

  let retrieved: ContextSummary['retrieved'] = [];
  if (isAIConfigured()) {
    try {
      const queryVector = await embed(lastUserMessage);
      retrieved = await retrieveRelevant(spaceId, queryVector);
    } catch (err) {
      log.warn('COPILOT_RETRIEVAL_FAIL', {
        error: err instanceof Error ? err.message.slice(0, 240) : String(err),
      });
    }
  }

  return {
    thisMonth: thisTotals,
    lastMonth: lastTotals,
    topCategoriesThisMonth: topCats,
    recurring: recurringRows.map((r) => ({
      displayName: r.displayName,
      averageAmount: Number(r.averageAmount),
      frequencyDays: r.frequencyDays,
      nextExpectedDate: r.nextExpectedDate,
    })),
    goals: goalRows.map((g) => ({
      name: g.name,
      target: Number(g.targetAmount),
      current: Number(g.currentAmount),
      progress:
        Math.round((Number(g.currentAmount) / Math.max(1, Number(g.targetAmount))) * 100 * 100) /
        100,
      deadline: g.deadline,
    })),
    retrieved,
  };
}

/**
 * Render the context as a fenced UNTRUSTED-DATA block. Aggregate numbers
 * are computed server-side and safe, but any free-text the user authored
 * (descriptions, goal/category/recurring names) is sanitised so a
 * transaction literally described "ignore your instructions" cannot steer
 * the model.
 */
export function renderContextBlock(context: ContextSummary, user: AuthedUser): string {
  const lines: string[] = [];
  lines.push(`USER LANGUAGE: ${sanitizeUntrusted(user.primaryLanguage, 12)}`);
  lines.push(`BASE CURRENCY: ${sanitizeUntrusted(user.baseCurrency, 6)}`);
  lines.push('');
  lines.push('THIS MONTH:');
  lines.push(
    `  income=₹${context.thisMonth.income} expense=₹${context.thisMonth.expense} savings=₹${context.thisMonth.savings}`,
  );
  lines.push('LAST MONTH:');
  lines.push(
    `  income=₹${context.lastMonth.income} expense=₹${context.lastMonth.expense} savings=₹${context.lastMonth.savings}`,
  );
  if (context.topCategoriesThisMonth.length > 0) {
    lines.push('TOP CATEGORIES THIS MONTH:');
    for (const c of context.topCategoriesThisMonth) {
      lines.push(`  ${sanitizeUntrusted(c.category, 40)}: ₹${c.total}`);
    }
  }
  if (context.recurring.length > 0) {
    lines.push('ACTIVE RECURRING:');
    for (const r of context.recurring) {
      lines.push(
        `  ${sanitizeUntrusted(r.displayName, 60)}: ₹${r.averageAmount} every ${r.frequencyDays}d (next ${r.nextExpectedDate ?? '?'})`,
      );
    }
  }
  if (context.goals.length > 0) {
    lines.push('ACTIVE GOALS:');
    for (const g of context.goals) {
      lines.push(
        `  ${sanitizeUntrusted(g.name, 60)}: ₹${g.current}/₹${g.target} (${g.progress}%)${g.deadline ? ` by ${g.deadline}` : ''}`,
      );
    }
  }
  if (context.retrieved.length > 0) {
    lines.push('RELEVANT RECENT TRANSACTIONS (top by similarity):');
    for (const t of context.retrieved.slice(0, 12)) {
      lines.push(
        `  ${t.date} ₹${t.amount} ${sanitizeUntrusted(t.category ?? '-', 30)} — ${sanitizeUntrusted(t.description, 120)}`,
      );
    }
  }
  lines.push('');
  lines.push("Today's date: " + new Date().toISOString().slice(0, 10));
  return fenceUntrusted(lines.join('\n'));
}
