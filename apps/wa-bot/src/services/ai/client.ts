/**
 * Lazy OpenAI client for the bot. Same shape as the API's client.ts but
 * keyed on the bot's env. Without a key, every AI surface degrades to a
 * deterministic mock so a developer can still pair their phone, drive
 * the simulator, and exercise the conversation engine end-to-end.
 */
import OpenAI from 'openai';
import { env } from '../../config.ts';
import { log } from '../../utils/logger.ts';

let cached: OpenAI | null | undefined;

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
  if (!env.OPENAI_API_KEY) {
    cached = null;
    return cached;
  }
  cached = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    maxRetries: 2,
    timeout: 30_000,
  });
  return cached;
}

export function isAIConfigured(): boolean {
  return Boolean((env.AZURE_AI_KEY && env.AZURE_AI_ENDPOINT) || env.OPENAI_API_KEY);
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
