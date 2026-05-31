/**
 * Lazy OpenAI client.
 *
 * The whole AI surface is opt-in: when `OPENAI_API_KEY` is empty every
 * service degrades to a deterministic mock so the API still boots and
 * tests in environments without keys. We construct the client at most
 * once per process and reuse the same instance everywhere.
 *
 * `withLatency` is the tiny wrapper every AI call funnels through. It
 * times the request, logs a structured line, and surfaces the underlying
 * error if any without leaking the API key.
 */
import OpenAI from 'openai';
import { env } from '../../env.ts';
import { log } from '../../utils/logger.ts';

let cached: OpenAI | null | undefined;

export function getOpenAI(): OpenAI | null {
  if (cached !== undefined) return cached;
  if (!env.OPENAI_API_KEY) {
    cached = null;
    return cached;
  }
  cached = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    // The SDK retries 429s and connection errors twice by default; give it
    // a short total budget so a stuck request can't park a capture call.
    maxRetries: 2,
    timeout: 30_000,
  });
  return cached;
}

export function isAIConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

/**
 * Normalise chat-completion params across model families.
 *
 * The GPT-5 family (gpt-5, gpt-5-mini, gpt-5-nano, o1/o3 reasoning models)
 * renamed `max_tokens` → `max_completion_tokens` and only accepts the
 * default temperature (1). Older models (gpt-4o, gpt-4o-mini) keep the
 * classic params. Callers always write the classic shape; this shim
 * rewrites it to whatever the target model expects, so we don't sprinkle
 * model checks across every service.
 *
 * Typed as a transparent pass-through over the SDK param union so the
 * `.create()` overloads still resolve at the call site.
 */
export function normalizeChatParams<
  T extends
    | OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    | OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
>(params: T): T {
  const model = String(params.model ?? '');
  const isNextGen = /^(gpt-5|o1|o3|o4)/.test(model);
  if (!isNextGen) return params;

  const next = { ...params } as Record<string, unknown>;
  if ('max_tokens' in next) {
    next.max_completion_tokens = next.max_tokens;
    delete next.max_tokens;
  }
  if ('temperature' in next && next.temperature !== 1) {
    delete next.temperature;
  }
  if ('top_p' in next && next.top_p !== 1) {
    delete next.top_p;
  }
  return next as unknown as T;
}

/**
 * Wrap an async AI call and log its outcome with duration.
 * The label is the only field that lands in INFO logs by default; raw
 * inputs and outputs stay at DEBUG to keep PII off shared dashboards.
 */
export async function withLatency<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - startedAt);
    log.info('AI_CALL_OK', { label, ms });
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - startedAt);
    const message = err instanceof Error ? err.message : String(err);
    log.warn('AI_CALL_FAIL', { label, ms, error: message.slice(0, 240) });
    throw err;
  }
}

/**
 * Reset the cached client. Only used by tests when they need to swap
 * environments. Not part of the public-facing surface.
 */
export function __resetOpenAIClientForTests(): void {
  cached = undefined;
}
