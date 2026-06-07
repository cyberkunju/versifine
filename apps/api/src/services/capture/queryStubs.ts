/**
 * Inline query helpers for the capture pipeline.
 *
 * When the intent classifier identifies a query (`query_spending`,
 * `query_summary`, `query_forecast`) we want to answer in-place rather
 * than make the client open the copilot panel. The real implementations
 * live in services/transactions/query.ts and services/forecast/index.ts;
 * if those modules are missing we fall back to a placeholder shape so
 * the omnibar can still render a card.
 */
import { isCategory, type Category } from '@versifine/shared';
import { log } from '../../utils/logger.ts';
import { summarize, totalSpentByCategory } from '../transactions/query.ts';
import { computeForecast } from '../forecast/index.ts';

export interface QuerySummaryPayload {
  kind: 'spending' | 'summary' | 'forecast';
  total: number;
  currency: string;
  /** Stable period key the client can localise (today, this_month, …). */
  periodKey: PeriodKey | null;
  /** English period label — fallback when the client can't localise the key. */
  periodLabel: string;
  category: string | null;
  topCategory: { category: string; total: number } | null;
  horizonDays: number | null;
}

export interface QueryReply {
  message: string;
  /** Machine-readable summary so clients (bot) can render localised copy. */
  summary?: QuerySummaryPayload;
  data?: Record<string, unknown>;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STUB_MESSAGE = 'Query result unavailable: the underlying service is not yet ready.';

/* ----- Category canonicalisation -------------------------------------- */

/**
 * The intent classifier hands us a loose category hint ("food", "petrol").
 * `totalSpentByCategory` filters on the canonical category string, so a raw
 * hint like "food" would match nothing. Map the common aliases to canonical
 * categories; pass through anything already canonical; null when unknown
 * (which widens the query to "all spending", a sensible default).
 */
const CATEGORY_ALIASES: Record<string, Category> = {
  food: 'Restaurants',
  foods: 'Restaurants',
  restaurant: 'Restaurants',
  restaurants: 'Restaurants',
  dining: 'Restaurants',
  eating: 'Restaurants',
  grocery: 'Groceries',
  groceries: 'Groceries',
  delivery: 'Food Delivery',
  swiggy: 'Food Delivery',
  zomato: 'Food Delivery',
  transport: 'Transportation',
  transportation: 'Transportation',
  travel: 'Transportation',
  travelling: 'Transportation',
  traveling: 'Transportation',
  commute: 'Transportation',
  auto: 'Transportation',
  cab: 'Transportation',
  taxi: 'Transportation',
  uber: 'Transportation',
  ola: 'Transportation',
  fuel: 'Gas & Fuel',
  petrol: 'Gas & Fuel',
  diesel: 'Gas & Fuel',
  gas: 'Gas & Fuel',
  rent: 'Housing',
  housing: 'Housing',
  bills: 'Bills & Utilities',
  bill: 'Bills & Utilities',
  utilities: 'Bills & Utilities',
  shopping: 'Shopping & Retail',
  retail: 'Shopping & Retail',
  entertainment: 'Entertainment',
  subscription: 'Subscriptions',
  subscriptions: 'Subscriptions',
  coffee: 'Coffee & Beverages',
  tea: 'Coffee & Beverages',
  chai: 'Coffee & Beverages',
  beverages: 'Coffee & Beverages',
  beverage: 'Coffee & Beverages',
  drinks: 'Coffee & Beverages',
  snacks: 'Restaurants',
  lunch: 'Restaurants',
  dinner: 'Restaurants',
  breakfast: 'Restaurants',
  meals: 'Restaurants',
  health: 'Healthcare',
  healthcare: 'Healthcare',
  medical: 'Healthcare',
  medicine: 'Healthcare',
  education: 'Education',
};

export function canonicalizeCategory(hint: string | null | undefined): Category | null {
  if (!hint) return null;
  const trimmed = hint.trim();
  if (!trimmed) return null;
  if (isCategory(trimmed)) return trimmed as Category;
  const lower = trimmed.toLowerCase();
  if (CATEGORY_ALIASES[lower]) return CATEGORY_ALIASES[lower]!;
  // Fuzzy: the hint may be a phrase ("drinking tea", "on the taxi"). Match any
  // alias keyword appearing as a whole word.
  for (const alias of Object.keys(CATEGORY_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(lower)) return CATEGORY_ALIASES[alias]!;
  }
  return null;
}

/* ----- Period detection ------------------------------------------------ */

export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_year';

interface Period {
  key: PeriodKey;
  label: string;
  range: { from: string; to: string };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Resolve a spending period from free text. Defaults to "this month".
 * Understands English + Hindi/Malayalam period words.
 *
 * Order matters: more specific windows (yesterday, last week/month) are
 * checked before their broader siblings (today, this week/month) so a
 * substring like "ഇന്ന" (today) inside "ഇന്നലെ" (yesterday) can't shadow it.
 */
export function detectPeriod(text: string, now: Date = new Date()): Period {
  const t = (text ?? '').toLowerCase();
  const today = startOfDay(now);

  // ── Yesterday (before "today", which is a script prefix of it in ML) ──
  if (/\b(yesterday|kal)\b/.test(t) || /ഇന്നലെ/.test(text) || /कल/.test(text)) {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { key: 'yesterday', label: 'yesterday', range: { from: iso(y), to: iso(y) } };
  }
  // ── Last week / month (before "this week/month") ──
  if (/\b(last week|previous week|pichle hafte)\b/.test(t) || /കഴിഞ്ഞ ആഴ്ച/.test(text)) {
    const startThis = new Date(today);
    startThis.setDate(startThis.getDate() - ((startThis.getDay() + 6) % 7)); // Monday
    const startLast = new Date(startThis);
    startLast.setDate(startLast.getDate() - 7);
    const endLast = new Date(startThis);
    endLast.setDate(endLast.getDate() - 1);
    return {
      key: 'last_week',
      label: 'last week',
      range: { from: iso(startLast), to: iso(endLast) },
    };
  }
  if (/\b(last month|previous month|pichle mahine)\b/.test(t) || /കഴിഞ്ഞ മാസം/.test(text)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { key: 'last_month', label: 'last month', range: { from: iso(start), to: iso(end) } };
  }
  // ── Today ──
  if (/\b(today|aaj|today's)\b/.test(t) || /ഇന്ന/.test(text) || /आज/.test(text)) {
    return { key: 'today', label: 'today', range: { from: iso(today), to: iso(now) } };
  }
  if (/\b(this week|week|is hafte)\b/.test(t) || /ഈ ആഴ്ച|ആഴ്ച/.test(text)) {
    const start = new Date(today);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
    return { key: 'this_week', label: 'this week', range: { from: iso(start), to: iso(now) } };
  }
  if (/\b(this year|year|is saal)\b/.test(t) || /ഈ വർഷം/.test(text)) {
    const start = new Date(now.getFullYear(), 0, 1);
    return { key: 'this_year', label: 'this year', range: { from: iso(start), to: iso(now) } };
  }
  // default
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { key: 'this_month', label: 'this month', range: { from: iso(start), to: iso(now) } };
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export async function answerQuery(
  intent: 'query_spending' | 'query_summary' | 'query_forecast',
  spaceId: string,
  hint: { category: string | null; days?: number; text?: string },
): Promise<QueryReply> {
  try {
    const period = detectPeriod(hint.text ?? '');

    if (intent === 'query_summary') {
      const data = await summarize(spaceId, period.range);
      const expense = Number(
        (data as unknown as { totals?: { expense?: number } }).totals?.expense ?? 0,
      );
      const top = (
        data as unknown as { topCategories?: Array<{ category: string; total: number }> }
      ).topCategories?.[0];
      let message = `You've spent ${inr(expense)} ${period.label}.`;
      if (top && top.total > 0) {
        message += ` Biggest: ${top.category} (${inr(top.total)}).`;
      }
      if (expense === 0) message = `No spending recorded ${period.label} yet.`;
      return {
        message,
        summary: {
          kind: 'summary',
          total: expense,
          currency: 'INR',
          periodKey: period.key,
          periodLabel: period.label,
          category: null,
          topCategory: top && top.total > 0 ? top : null,
          horizonDays: null,
        },
        data: data as unknown as Record<string, unknown>,
      };
    }

    if (intent === 'query_forecast') {
      const days = hint.days ?? 30;
      const data = await computeForecast(spaceId, days);
      const total = Number((data as unknown as { total?: number }).total ?? 0);
      return {
        message: `You're projected to spend about ${inr(total)} over the next ${days} days.`,
        summary: {
          kind: 'forecast',
          total,
          currency: 'INR',
          periodKey: null,
          periodLabel: `next ${days} days`,
          category: null,
          topCategory: null,
          horizonDays: days,
        },
        data: data as unknown as Record<string, unknown>,
      };
    }

    // query_spending — a specific category over the detected period. Map the
    // loose hint ("food") to a canonical category; null widens to all spend.
    const category = canonicalizeCategory(hint.category);
    const data = await totalSpentByCategory(spaceId, category, period.range);
    const total = Number((data as unknown as { total?: number }).total ?? 0);
    const cat = category ? ` on ${category}` : '';
    const message =
      total > 0
        ? `You've spent ${inr(total)}${cat} ${period.label}.`
        : `No spending${cat} recorded ${period.label}.`;
    return {
      message,
      summary: {
        kind: 'spending',
        total,
        currency: 'INR',
        periodKey: period.key,
        periodLabel: period.label,
        category,
        topCategory: null,
        horizonDays: null,
      },
      data: data as unknown as Record<string, unknown>,
    };
  } catch (err) {
    log.warn('QUERY_RUNTIME_FALLBACK', {
      intent,
      error: err instanceof Error ? err.message : String(err),
    });
    return { message: STUB_MESSAGE };
  }
}
