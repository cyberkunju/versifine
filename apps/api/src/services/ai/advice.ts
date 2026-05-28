/**
 * Advice generator.
 *
 * Builds a compact context block — this month vs last month, top categories,
 * active recurring items, active goals — and asks `gpt-4o-mini` to surface
 * 3-5 ranked items the user can act on. Temperature is 0.3 because the job
 * is interpretation, not creativity, and we ask for JSON so parsing is
 * deterministic.
 *
 * If OpenAI isn't configured we fall back to a small rule-based set: flag
 * the largest overspending category vs last month and suggest a savings
 * target proportional to current income. The rule-based path keeps the
 * dashboard's "Advice" panel populated for offline development and keeps
 * the API testable without a key.
 *
 * IDs are deterministic hashes of the headline so the UI can reconcile
 * across refreshes — a stable id means a stable card position even if a
 * new round of advice reorders the surrounding items.
 */
import { createHash } from 'node:crypto';
import {
  and,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  sql as drizzleSql,
} from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { goals, type Goal } from '../../db/schema/goals.ts';
import { recurringItems, type RecurringItem } from '../../db/schema/recurring.ts';
import { transactions } from '../../db/schema/transactions.ts';
import { env } from '../../env.ts';
import { log } from '../../utils/logger.ts';
import { getOpenAI, isAIConfigured, withLatency } from './client.ts';

export type AdviceKind = 'cut_back' | 'goal' | 'recurring' | 'forecast' | 'savings';
export type AdvicePriority = 'high' | 'medium' | 'low';

export interface AdviceItem {
  id: string;
  kind: AdviceKind;
  headline: string;
  detail: string;
  priority: AdvicePriority;
  deltaInr?: number;
}

export interface AdviceEnvelope {
  items: AdviceItem[];
  source: 'ai' | 'rules';
}

interface ContextBlock {
  thisMonth: { income: number; expense: number; savings: number };
  lastMonth: { income: number; expense: number; savings: number };
  topCategories: Array<{ category: string; total: number }>;
  biggestDeltas: Array<{ category: string; delta: number; previous: number; current: number }>;
  recurring: Array<{ displayName: string; averageAmount: number; frequencyDays: number }>;
  goals: Array<{ name: string; target: number; current: number; progress: number; deadline: string | null }>;
  recurringMonthlyBurn: number;
}

export async function generateAdvice(spaceId: string): Promise<AdviceEnvelope> {
  const context = await buildContext(spaceId);

  if (!isAIConfigured()) {
    return { items: rulesBasedAdvice(context), source: 'rules' };
  }

  try {
    const items = await llmAdvice(context);
    if (items.length === 0) {
      return { items: rulesBasedAdvice(context), source: 'rules' };
    }
    return { items, source: 'ai' };
  } catch (err) {
    log.warn('ADVICE_LLM_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { items: rulesBasedAdvice(context), source: 'rules' };
  }
}

async function buildContext(spaceId: string): Promise<ContextBlock> {
  const today = new Date();
  const thisMonth = monthRange(today);
  const previous = new Date(today);
  previous.setUTCDate(1);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const lastMonth = monthRange(previous);

  const [thisTotals, lastTotals] = await Promise.all([
    aggregateTotals(spaceId, thisMonth),
    aggregateTotals(spaceId, lastMonth),
  ]);

  const [thisCategories, lastCategories] = await Promise.all([
    aggregateByCategory(spaceId, thisMonth),
    aggregateByCategory(spaceId, lastMonth),
  ]);

  const topCategories = [...thisCategories]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const allCategoryKeys = new Set<string>([
    ...thisCategories.map((r) => r.category),
    ...lastCategories.map((r) => r.category),
  ]);
  const lastByCategory = new Map(lastCategories.map((r) => [r.category, r.total]));
  const thisByCategory = new Map(thisCategories.map((r) => [r.category, r.total]));

  const biggestDeltas: ContextBlock['biggestDeltas'] = [];
  for (const cat of allCategoryKeys) {
    const current = thisByCategory.get(cat) ?? 0;
    const prev = lastByCategory.get(cat) ?? 0;
    if (current === 0 && prev === 0) continue;
    biggestDeltas.push({ category: cat, delta: round2(current - prev), previous: round2(prev), current: round2(current) });
  }
  biggestDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const trimmedDeltas = biggestDeltas.slice(0, 5);

  const recurringRows = await db
    .select()
    .from(recurringItems)
    .where(and(eq(recurringItems.spaceId, spaceId), eq(recurringItems.status, 'active')));
  const recurring = recurringRows.map((r: RecurringItem) => ({
    displayName: r.displayName,
    averageAmount: Number(r.averageAmount),
    frequencyDays: r.frequencyDays,
  }));
  const recurringMonthlyBurn = recurring.reduce(
    (acc, r) => acc + (r.averageAmount * 30) / Math.max(1, r.frequencyDays),
    0,
  );

  const goalRows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.spaceId, spaceId), eq(goals.status, 'active')));
  const goalSummaries = goalRows.map((g: Goal) => {
    const target = Number(g.targetAmount);
    const current = Number(g.currentAmount);
    const progress = target > 0 ? round2((current / target) * 100) : 0;
    return {
      name: g.name,
      target: round2(target),
      current: round2(current),
      progress,
      deadline: g.deadline,
    };
  });

  return {
    thisMonth: thisTotals,
    lastMonth: lastTotals,
    topCategories,
    biggestDeltas: trimmedDeltas,
    recurring,
    goals: goalSummaries,
    recurringMonthlyBurn: round2(recurringMonthlyBurn),
  };
}

interface MonthRange {
  from: string;
  to: string;
  label: string;
}

function monthRange(date: Date): MonthRange {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    label: `${y}-${String(m + 1).padStart(2, '0')}`,
  };
}

async function aggregateTotals(
  spaceId: string,
  range: MonthRange,
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
  for (const row of rows) {
    if (row.type === 'income') income += Number(row.total);
    else if (row.type === 'expense') expense += Number(row.total);
  }
  return { income: round2(income), expense: round2(expense), savings: round2(income - expense) };
}

async function aggregateByCategory(
  spaceId: string,
  range: MonthRange,
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
    .groupBy(transactions.category);

  return rows
    .filter((r) => r.category !== null)
    .map((r) => ({ category: r.category as string, total: round2(Number(r.total)) }));
}

async function llmAdvice(ctx: ContextBlock): Promise<AdviceItem[]> {
  const client = getOpenAI();
  if (!client) return [];

  const systemPrompt = [
    "You are Vivien, Finehance's finance copilot.",
    'Output 3 to 5 prioritised, actionable advice items as JSON.',
    'Schema: {"items":[{"kind":"cut_back|goal|recurring|forecast|savings","headline":"string (max 90 chars)","detail":"string (max 240 chars)","priority":"high|medium|low","deltaInr":number?}]}',
    'Rules:',
    '- Headlines are short and concrete.',
    '- Never invent numbers; only cite values present in the context.',
    '- Use Indian rupee shorthand (e.g. ₹4,200) inside detail strings.',
    '- Pick "high" only when the user is overspending vs last month or missing a goal pace.',
    '- Skip generic "save more" advice unless tied to a specific category or recurring item.',
  ].join('\n');

  const userPayload = {
    summary: {
      thisMonth: ctx.thisMonth,
      lastMonth: ctx.lastMonth,
      recurringMonthlyBurn: ctx.recurringMonthlyBurn,
    },
    topCategories: ctx.topCategories,
    biggestDeltas: ctx.biggestDeltas,
    recurring: ctx.recurring,
    goals: ctx.goals,
  };

  const completion = await withLatency('advice_completion', async () =>
    client.chat.completions.create({
      model: env.OPENAI_NLU_MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
  );

  const text = completion.choices[0]?.message?.content ?? '';
  if (!text) return [];

  const parsed = parseLlmJson(text);
  if (!parsed || !Array.isArray(parsed.items)) return [];

  const items: AdviceItem[] = [];
  for (const raw of parsed.items.slice(0, 5)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const headline = typeof r.headline === 'string' ? r.headline.slice(0, 90) : '';
    const detail = typeof r.detail === 'string' ? r.detail.slice(0, 240) : '';
    const kind = isAdviceKind(r.kind) ? r.kind : 'cut_back';
    const priority = isAdvicePriority(r.priority) ? r.priority : 'medium';
    if (!headline || !detail) continue;
    const item: AdviceItem = {
      id: idFromHeadline(headline),
      kind,
      headline,
      detail,
      priority,
    };
    if (typeof r.deltaInr === 'number' && Number.isFinite(r.deltaInr)) {
      item.deltaInr = round2(r.deltaInr);
    }
    items.push(item);
  }
  return items;
}

function rulesBasedAdvice(ctx: ContextBlock): AdviceItem[] {
  const out: AdviceItem[] = [];

  // 1. Largest overspending category vs last month, if any.
  const overspending = ctx.biggestDeltas
    .filter((d) => d.delta > 0)
    .sort((a, b) => b.delta - a.delta)[0];
  if (overspending && overspending.delta >= 200) {
    const headline = `Watch ${overspending.category} — up ₹${formatInr(overspending.delta)} this month`;
    out.push({
      id: idFromHeadline(headline),
      kind: 'cut_back',
      headline,
      detail: `You spent ₹${formatInr(overspending.current)} on ${overspending.category} this month, against ₹${formatInr(overspending.previous)} last month. Trim about ${Math.min(20, Math.round((overspending.delta / overspending.current) * 100))}% to bring it back in line.`,
      priority: overspending.delta > overspending.previous * 0.5 ? 'high' : 'medium',
      deltaInr: round2(overspending.delta),
    });
  }

  // 2. Savings suggestion proportional to current income.
  if (ctx.thisMonth.income > 0) {
    const targetRate = 20;
    const currentRate =
      ctx.thisMonth.income > 0 ? (ctx.thisMonth.savings / ctx.thisMonth.income) * 100 : 0;
    if (currentRate < targetRate) {
      const targetSaving = round2((ctx.thisMonth.income * targetRate) / 100);
      const headline = `Aim to save ₹${formatInr(targetSaving)} this month`;
      out.push({
        id: idFromHeadline(headline),
        kind: 'savings',
        headline,
        detail: `At a ${Math.round(currentRate)}% savings rate you're below the 20% target. Cutting one or two of your top recurring items could free up ₹${formatInr(Math.max(0, targetSaving - ctx.thisMonth.savings))}.`,
        priority: currentRate < 5 ? 'high' : 'medium',
      });
    }
  }

  // 3. Recurring burn callout if it's a meaningful share of income.
  if (ctx.recurringMonthlyBurn > 0 && ctx.thisMonth.income > 0) {
    const share = ctx.recurringMonthlyBurn / ctx.thisMonth.income;
    if (share >= 0.25) {
      const headline = `Subscriptions take ${Math.round(share * 100)}% of your income`;
      out.push({
        id: idFromHeadline(headline),
        kind: 'recurring',
        headline,
        detail: `Your active recurring items add up to ₹${formatInr(ctx.recurringMonthlyBurn)} a month. Audit ${ctx.recurring.length} subscription${ctx.recurring.length === 1 ? '' : 's'} and dismiss any you no longer use.`,
        priority: share >= 0.4 ? 'high' : 'medium',
      });
    }
  }

  // 4. Goals at risk: progress < expected pace by deadline.
  for (const goal of ctx.goals.slice(0, 2)) {
    if (!goal.deadline) continue;
    const today = new Date();
    const deadline = new Date(`${goal.deadline}T00:00:00Z`);
    if (deadline.getTime() <= today.getTime()) continue;
    const totalDays = Math.max(
      1,
      (deadline.getTime() - new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`).getTime()) /
        86_400_000,
    );
    const remaining = goal.target - goal.current;
    if (remaining <= 0) continue;
    const monthlyNeeded = (remaining / totalDays) * 30;
    if (monthlyNeeded > ctx.thisMonth.savings && ctx.thisMonth.savings >= 0) {
      const headline = `Goal "${goal.name}" needs ₹${formatInr(monthlyNeeded)}/month`;
      out.push({
        id: idFromHeadline(headline),
        kind: 'goal',
        headline,
        detail: `To hit "${goal.name}" by ${goal.deadline} you'll need to save ₹${formatInr(monthlyNeeded)} a month. You're currently saving ₹${formatInr(ctx.thisMonth.savings)} — close the gap by ${Math.round(((monthlyNeeded - ctx.thisMonth.savings) / monthlyNeeded) * 100)}%.`,
        priority: 'medium',
        deltaInr: round2(monthlyNeeded),
      });
    }
  }

  if (out.length === 0) {
    // Default cheerful note so the UI is never empty.
    const headline = 'You are tracking well this month';
    out.push({
      id: idFromHeadline(headline),
      kind: 'savings',
      headline,
      detail:
        ctx.thisMonth.income > 0
          ? `Income ₹${formatInr(ctx.thisMonth.income)} against expense ₹${formatInr(ctx.thisMonth.expense)}. Keep adding transactions and the copilot will surface cuts as soon as it spots them.`
          : 'Add a few transactions and the copilot will start spotting trends, recurring items, and savings opportunities.',
      priority: 'low',
    });
  }

  return out.slice(0, 5);
}

function parseLlmJson(text: string): { items?: unknown } | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return value;
  } catch {
    // Some models prefix with markdown fences. Try to recover.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function isAdviceKind(value: unknown): value is AdviceKind {
  return (
    value === 'cut_back' ||
    value === 'goal' ||
    value === 'recurring' ||
    value === 'forecast' ||
    value === 'savings'
  );
}

function isAdvicePriority(value: unknown): value is AdvicePriority {
  return value === 'high' || value === 'medium' || value === 'low';
}

function idFromHeadline(headline: string): string {
  // Stable, short hash so the UI can reconcile across responses without
  // fancy diffing. Sixteen hex chars is plenty for the few items we ever
  // surface in one envelope.
  return createHash('sha1').update(headline).digest('hex').slice(0, 16);
}

function formatInr(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Math.round(value).toLocaleString('en-IN');
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
