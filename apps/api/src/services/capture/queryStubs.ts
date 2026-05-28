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

export interface QueryReply {
  message: string;
  data?: Record<string, unknown>;
}

type SummaryFn = (spaceId: string, opts?: Record<string, unknown>) => Promise<unknown>;
type ForecastFn = (spaceId: string, days?: number) => Promise<unknown>;
type SpendingFn = (
  spaceId: string,
  category: string | null,
  range: { from: string; to: string },
) => Promise<unknown>;

let summaryFn: SummaryFn | null | undefined;
let forecastFn: ForecastFn | null | undefined;
let spendingFn: SpendingFn | null | undefined;

async function loadSummary(): Promise<SummaryFn | null> {
  if (summaryFn !== undefined) return summaryFn;
  try {
    const path = '../transactions/' + 'query.ts';
    const mod = (await import(path)) as { summarize?: SummaryFn };
    summaryFn = typeof mod.summarize === 'function' ? mod.summarize : null;
  } catch {
    summaryFn = null;
  }
  return summaryFn ?? null;
}

async function loadForecast(): Promise<ForecastFn | null> {
  if (forecastFn !== undefined) return forecastFn;
  try {
    const path = '../forecast/' + 'index.ts';
    const mod = (await import(path)) as { computeForecast?: ForecastFn };
    forecastFn = typeof mod.computeForecast === 'function' ? mod.computeForecast : null;
  } catch {
    forecastFn = null;
  }
  return forecastFn ?? null;
}

async function loadSpending(): Promise<SpendingFn | null> {
  if (spendingFn !== undefined) return spendingFn;
  try {
    const path = '../transactions/' + 'query.ts';
    const mod = (await import(path)) as { totalSpentByCategory?: SpendingFn };
    spendingFn = typeof mod.totalSpentByCategory === 'function' ? mod.totalSpentByCategory : null;
  } catch {
    spendingFn = null;
  }
  return spendingFn ?? null;
}

function thisMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: iso(from), to: iso(now) };
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STUB_MESSAGE = 'Query result unavailable: the underlying service is not yet ready.';

export async function answerQuery(
  intent: 'query_spending' | 'query_summary' | 'query_forecast',
  spaceId: string,
  hint: { category: string | null; days?: number },
): Promise<QueryReply> {
  try {
    if (intent === 'query_summary') {
      const fn = await loadSummary();
      if (!fn) {
        log.warn('QUERY_STUB', { intent });
        return { message: STUB_MESSAGE };
      }
      const data = await fn(spaceId, thisMonthRange());
      return { message: 'Summary ready.', data: data as Record<string, unknown> };
    }
    if (intent === 'query_forecast') {
      const fn = await loadForecast();
      if (!fn) {
        log.warn('QUERY_STUB', { intent });
        return { message: STUB_MESSAGE };
      }
      const data = await fn(spaceId, hint.days ?? 30);
      return { message: 'Forecast ready.', data: data as Record<string, unknown> };
    }
    // query_spending
    const fn = await loadSpending();
    if (!fn) {
      log.warn('QUERY_STUB', { intent });
      return { message: STUB_MESSAGE };
    }
    const data = await fn(spaceId, hint.category, thisMonthRange());
    return { message: 'Total ready.', data: data as Record<string, unknown> };
  } catch (err) {
    log.warn('QUERY_RUNTIME_FALLBACK', {
      intent,
      error: err instanceof Error ? err.message : String(err),
    });
    return { message: STUB_MESSAGE };
  }
}
