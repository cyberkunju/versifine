/**
 * Bot AI client — Azure AI Foundry ONLY.
 *
 * Policy (set 2026-06-08): no direct OpenAI API, no fallbacks. The bot's
 * language model surface routes through the API (copilot) and Sarvam
 * (translate/STT/TTS); the only thing kept here is the latency wrapper every
 * provider call funnels through. `getOpenAI` is retained as an Azure-only
 * accessor in case a future bot path needs a direct Foundry chat call.
 */
import OpenAI from 'openai';
import { env } from '../../config.ts';
import { log } from '../../utils/logger.ts';

let cached: OpenAI | null | undefined;

/** Azure AI Foundry chat client, or null when Azure isn't configured. */
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
