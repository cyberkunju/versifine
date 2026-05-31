/**
 * Categorize entrypoint — the smart waterfall described in design § 6.
 *
 *   1. `category_overrides[space, normalized_merchant]` (user has corrected
 *      this merchant before — we trust them absolutely; confidence 1.0)
 *   2. Curated India-first merchants.json (regex / contains / startsWith /
 *      exact; confidence 0.95)
 *   3. LLM tier — a small, fast OpenAI model (OPENAI_NLU_MODEL) that
 *      understands code-mixed Indic slang and free text. This is the tier
 *      that rescues everything the deterministic tiers miss.
 *   4. MiniLM ONNX inference (only when the artifact is shipped; otherwise
 *      a no-op).
 *   5. Default `Other` with confidence 0.
 *
 * The function never throws on the categorize path; the only sources of
 * exceptions worth surfacing are programming errors. The HTTP layer goes
 * through `_safe.ts` which adds an extra try/catch belt-and-braces, but
 * each tier here is already defensive.
 *
 * Re-exports `normalizeMerchant` and `upsertOverride` so route handlers
 * never have to know which file holds what.
 */
import { isCategory } from '@versifine/shared';
import { log } from '../../utils/logger.ts';
import { normalizeMerchant } from '../transactions/normalize.ts';
import { categorizeFromMerchantDB } from './merchants.ts';
import { categorizeWithLLM } from './llm.ts';
import { categorizeWithMiniLM } from './minilm.ts';
import { getOverride, upsertOverride } from './overrides.ts';

export type CategorizedBy = 'overrides' | 'merchants' | 'llm' | 'minilm' | 'default';

export interface CategorizeResult {
  category: string;
  confidence: number;
  categorizedBy: CategorizedBy;
}

const DEFAULT_RESULT: CategorizeResult = {
  category: 'Other',
  confidence: 0,
  categorizedBy: 'default',
};

/**
 * Run the smart waterfall. `description` is the raw transaction text
 * (e.g., a UPI bank message or a parsed expense description). `hint` is an
 * optional parser-provided category hint (from the LLM expense parser) that
 * biases the LLM tier. The function normalizes internally and stops at the
 * first tier that returns a confident answer.
 */
export async function categorize(
  spaceId: string,
  description: string,
  hint: string | null = null,
): Promise<CategorizeResult> {
  const normalized = normalizeMerchant(description);
  if (!normalized) {
    return DEFAULT_RESULT;
  }

  // Tier 1 — user override.
  try {
    const hit = await getOverride(spaceId, normalized);
    if (hit && isCategory(hit.category)) {
      return {
        category: hit.category,
        confidence: 1,
        categorizedBy: 'overrides',
      };
    }
  } catch (err) {
    // Database hiccup shouldn't block categorization. Drop down a tier.
    log.warn('CATEGORIZE_OVERRIDE_LOOKUP_FAIL', {
      spaceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Tier 2 — curated merchant catalogue.
  const merchantHit = categorizeFromMerchantDB(normalized);
  if (merchantHit) {
    return {
      category: merchantHit.category,
      confidence: merchantHit.confidence,
      categorizedBy: 'merchants',
    };
  }

  // Tier 3 — LLM. The smart tier: understands slang + code-mixed Indic
  // text. Feed it the *original* description (plus the parser hint) so it
  // has the full context. Returns null when no API key / failure.
  const llmHit = await categorizeWithLLM(description, hint);
  if (llmHit) {
    return {
      category: llmHit.category,
      confidence: Number(llmHit.score.toFixed(2)),
      categorizedBy: 'llm',
    };
  }

  // Tier 4 — MiniLM ONNX (only when the artifact is shipped). Returns null
  // when unavailable or low confidence.
  const mlHit = await categorizeWithMiniLM(description);
  if (mlHit) {
    return {
      category: mlHit.category,
      confidence: Number(mlHit.score.toFixed(2)),
      categorizedBy: 'minilm',
    };
  }

  // Tier 5 — fallback.
  return DEFAULT_RESULT;
}

export { normalizeMerchant } from '../transactions/normalize.ts';
export { upsertOverride } from './overrides.ts';
