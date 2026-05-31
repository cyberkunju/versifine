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
import { log } from '../../utils/logger.ts';
import { summarize, totalSpentByCategory } from '../transactions/query.ts';
import { computeForecast } from '../forecast/index.ts';

export interface QueryReply {
  message: string;
  data?: Record<string, unknown>;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STUB_MESSAGE = 'Query result unavailable: the underlying service is not yet ready.';

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
 * Understands English + light Hindi/Malayalam period words.
 */
export function detectPeriod(text: string, now: Date = new Date()): Period {
  const t = (text ?? '').toLowerCase();
  const today = startOfDay(now);

  if (/\b(today|aaj|today's)\b/.test(t) || /ഇന്ന/.test(text) || /इंडे/.test(text)) {
    return { key: 'today', label: 'today', range: { from: iso(today), to: iso(now) } };
  }
  if (/\b(yesterday|kal)\b/.test(t) || /ഇന്നലെ/.test(text)) {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { key: 'yesterday', label: 'yesterday', range: { from: iso(y), to: iso(y) } };
  }
  if (/\b(last week|previous week|pichle hafte)\b/.test(t)) {
    const startThis = new Date(today);
    startThis.setDate(startThis.getDate() - ((startThis.getDay() + 6) % 7)); // Monday
    const startLast = new Date(startThis);
    startLast.setDate(startLast.getDate() - 7);
    const endLast = new Date(startThis);
    endLast.setDate(endLast.getDate() - 1);
    return { key: 'last_week', label: 'last week', range: { from: iso(startLast), to: iso(endLast) } };
  }
  if (/\b(this week|week|is hafte)\b/.test(t)) {
    const start = new Date(today);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
    return { key: 'this_week', label: 'this week', range: { from: iso(start), to: iso(now) } };
  }
  if (/\b(last month|previous month|pichle mahine)\b/.test(t)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { key: 'last_month', label: 'last month', range: { from: iso(start), to: iso(end) } };
  }
  if (/\b(this year|year|is saal)\b/.test(t)) {
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
      const top = (data as unknown as { topCategories?: Array<{ category: string; total: number }> })
        .topCategories?.[0];
      let message = `You've spent ${inr(expense)} ${period.label}.`;
      if (top && top.total > 0) {
        message += ` Biggest: ${top.category} (${inr(top.total)}).`;
      }
      if (expense === 0) message = `No spending recorded ${period.label} yet.`;
      return { message, data: data as unknown as Record<string, unknown> };
    }

    if (intent === 'query_forecast') {
      const data = await computeForecast(spaceId, hint.days ?? 30);
      const total = Number((data as unknown as { total?: number }).total ?? 0);
      return {
        message: `You're projected to spend about ${inr(total)} over the next ${hint.days ?? 30} days.`,
        data: data as unknown as Record<string, unknown>,
      };
    }

    // query_spending — a specific category over the detected period.
    const data = await totalSpentByCategory(spaceId, hint.category, period.range);
    const total = Number((data as unknown as { total?: number }).total ?? 0);
    const cat = hint.category ? ` on ${hint.category}` : '';
    const message =
      total > 0
        ? `You've spent ${inr(total)}${cat} ${period.label}.`
        : `No spending${cat} recorded ${period.label}.`;
    return { message, data: data as unknown as Record<string, unknown> };
  } catch (err) {
    log.warn('QUERY_RUNTIME_FALLBACK', {
      intent,
      error: err instanceof Error ? err.message : String(err),
    });
    return { message: STUB_MESSAGE };
  }
}
