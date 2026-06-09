/**
 * Lazy Azure AI client.
 *
 * The whole AI surface is opt-in: when Azure AI Foundry isn't configured
 * every service degrades to a deterministic mock so the API still boots and
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

/**
 * AI client — Azure AI Foundry ONLY (policy 2026-06-08: no direct OpenAI).
 *
 * The OpenAI SDK is pointed at `<endpoint>/models` with the `api-key` header
 * and `api-version` query — the OpenAI-compatible Azure Model Inference
 * surface. Chat completions and embeddings both route through it; the `model`
 * field carries the Azure deployment name. Returns null (→ deterministic mock)
 * only when Azure isn't configured, so local dev/tests still boot.
 */
export function getOpenAI(): OpenAI | null {
  if (cached !== undefined) return cached;
  if (env.AZURE_AI_KEY && env.AZURE_AI_ENDPOINT) {
    cached = new OpenAI({
      baseURL: `${env.AZURE_AI_ENDPOINT}/models`,
      apiKey: env.AZURE_AI_KEY,
      defaultQuery: { 'api-version': env.AZURE_AI_API_VERSION },
      defaultHeaders: { 'api-key': env.AZURE_AI_KEY },
      maxRetries: 2,
      timeout: 30_000,
    });
    return cached;
  }
  cached = null;
  return cached;
}

export function isAIConfigured(): boolean {
  return Boolean(env.AZURE_AI_KEY && env.AZURE_AI_ENDPOINT);
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
  // GPT-5 family are reasoning models: left at the default (medium) effort they
  // spend seconds on hidden chain-of-thought even for trivial structured
  // extraction (intent, expense parse, categorise), which is the dominant
  // source of end-to-end latency. `minimal` keeps the GPT-5 quality we
  // benchmarked while bringing latency back in line with gpt-4o-mini. Callers
  // that genuinely need deeper reasoning can pass their own `reasoning_effort`.
  if (/^gpt-5/.test(model) && !('reasoning_effort' in next)) {
    next.reasoning_effort = 'minimal';
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
