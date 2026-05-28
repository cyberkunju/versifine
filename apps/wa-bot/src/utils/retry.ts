/**
 * Exponential-backoff retry with jitter. Used wherever we call OpenAI or
 * the API and want a single retry cycle without pulling in a library.
 *
 * The signature is intentionally narrow: pass an async fn, get the result
 * or the last error. We don't try to classify errors here — callers know
 * their own domain (auth fails differently from a 5xx).
 */
import { log } from './logger.ts';

export interface RetryOptions {
  attempts: number;
  baseMs: number;
  /** Hard cap so a buggy backoff can never block beyond a short window. */
  maxMs?: number;
  /** Optional label for log lines so failures are attributable. */
  label?: string;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { attempts, baseMs } = options;
  const maxMs = options.maxMs ?? 8_000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      const delay = Math.min(maxMs, baseMs * 2 ** i) + Math.floor(Math.random() * baseMs);
      log.warn('RETRY_BACKOFF', {
        label: options.label ?? 'retry',
        attempt: i + 1,
        delayMs: delay,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
