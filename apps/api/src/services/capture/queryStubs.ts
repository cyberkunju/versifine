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
      const data = await summarize(spaceId, thisMonthRange());
      return { message: 'Summary ready.', data: data as unknown as Record<string, unknown> };
    }
    if (intent === 'query_forecast') {
      const data = await computeForecast(spaceId, hint.days ?? 30);
      return { message: 'Forecast ready.', data: data as unknown as Record<string, unknown> };
    }
    // query_spending
    const data = await totalSpentByCategory(spaceId, hint.category, thisMonthRange());
    return { message: 'Total ready.', data: data as unknown as Record<string, unknown> };
  } catch (err) {
    log.warn('QUERY_RUNTIME_FALLBACK', {
      intent,
      error: err instanceof Error ? err.message : String(err),
    });
    return { message: STUB_MESSAGE };
  }
}
