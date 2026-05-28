/**
 * Defensive shim for the categorize service.
 *
 * Even though the real pipeline at `./index.ts` is itself defensive, the
 * HTTP layer never wants to fail a transaction write because of a flaky
 * model load or a Postgres connection hiccup in the override lookup. So
 * everything that crosses this boundary is wrapped in try/catch, and any
 * exception is downgraded to a structured warn + a sane fallback.
 *
 * The public surface intentionally matches what the rest of the codebase
 * already imports — keep it stable, the call sites in `routes/transactions`
 * and `services/transactions/create` should not need to change when this
 * file evolves.
 */
import { log } from '../../utils/logger.ts';
import {
  categorize,
  normalizeMerchant,
  upsertOverride,
  type CategorizeResult,
} from './index.ts';

export type { CategorizeResult } from './index.ts';

const DEFAULT_RESULT: CategorizeResult = {
  category: 'Other',
  confidence: 0,
  categorizedBy: 'default',
};

/** Run the categorizer with a guaranteed return value. */
export async function safeCategorize(
  spaceId: string,
  description: string,
): Promise<CategorizeResult> {
  try {
    const result = await categorize(spaceId, description);
    if (
      !result ||
      typeof result.category !== 'string' ||
      typeof result.confidence !== 'number'
    ) {
      return DEFAULT_RESULT;
    }
    return result;
  } catch (err) {
    log.warn('CATEGORIZE_RUNTIME_FALLBACK', {
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULT_RESULT;
  }
}

/** Idempotent upsert of a corrected category. Best-effort; never throws. */
export async function safeUpsertOverride(
  spaceId: string,
  merchantNormalized: string,
  category: string,
): Promise<void> {
  try {
    await upsertOverride(spaceId, merchantNormalized, category);
  } catch (err) {
    log.warn('CATEGORIZE_OVERRIDE_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Merchant normalization. Pure function, but we still belt-and-braces it
 * because the call sites use the result as a DB key — a thrown exception
 * here would manifest as a 500 on a transaction write, which is exactly
 * what this shim exists to prevent.
 */
export function safeNormalizeMerchant(description: string): string {
  try {
    return normalizeMerchant(description);
  } catch (err) {
    log.warn('CATEGORIZE_NORMALIZE_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return '';
  }
}
