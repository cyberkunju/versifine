/**
 * Curated India-first merchant lookup — tier 2 of the categorizer.
 *
 * The catalogue lives at `apps/api/src/data/merchants.json` and is shipped
 * with the API (no DB query, no network). Each row maps a substring,
 * prefix, exact phrase, or regex against the *normalized* merchant string
 * (lower-cased, UPI rails stripped, see `transactions/normalize.ts`).
 *
 * Match priority, applied once at compile time and preserved by sort:
 *   1. `exact`        — normalized string equals the pattern
 *   2. `startsWith`   — normalized string begins with the pattern
 *   3. `regex`        — case-insensitive regex matches the normalized string
 *   4. `contains`     — normalized string contains the pattern
 *   5. `keyword`      — normalized string contains the pattern as a whole
 *                       WORD (word-boundary match). This is the lowest
 *                       priority tier and is reserved for generic Indian
 *                       dish / beverage / grocery vocabulary ("mandi",
 *                       "biryani", "sabzi", "lassi"). Ranking it below
 *                       `contains` guarantees a specific brand always wins
 *                       over a generic food word — e.g. "swiggy biryani"
 *                       still resolves to Food Delivery (swiggy) rather than
 *                       Restaurants (biryani). Word-boundary matching avoids
 *                       false positives like "rice" inside "price" or "dal"
 *                       inside "sandal".
 * Within the same kind, longer patterns win (more specific). This is why
 * "swiggy instamart" → Groceries beats "swiggy" → Food Delivery for an
 * Instamart line item.
 *
 * Confidence is a flat 0.95 because the catalogue is hand-curated; we trust
 * an exact regional name more than the generic ML tier but reserve 1.0 for
 * the user's own corrections.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCategory, type Category } from '@versifine/shared';
import { log } from '../../utils/logger.ts';

type MatchKind = 'exact' | 'startsWith' | 'regex' | 'contains' | 'keyword';

interface RawMerchantEntry {
  pattern: string;
  category: string;
  displayName?: string;
  match?: MatchKind;
}

interface CompiledMerchant {
  pattern: string;
  patternLower: string;
  match: MatchKind;
  regex: RegExp | null;
  category: Category;
  displayName: string | undefined;
}

export interface MerchantHit {
  category: Category;
  displayName: string | undefined;
  confidence: 0.95;
}

const MERCHANTS_PATH = resolve(import.meta.dirname, '../../data/merchants.json');
const MATCH_PRIORITY: Record<MatchKind, number> = {
  exact: 0,
  startsWith: 1,
  regex: 2,
  contains: 3,
  keyword: 4,
};

const COMPILED: ReadonlyArray<CompiledMerchant> = compile();

/**
 * Read merchants.json, tolerating both the dev layout (source files run
 * directly, dirname = src/services/categorize) and the bundled layout
 * (dist/index.js, dirname = apps/api/dist). We try a few candidate paths
 * and use the first that exists.
 */
function readMerchantsRaw(): string | null {
  const candidates = [
    MERCHANTS_PATH, // src/services/categorize → src/data (dev)
    resolve(import.meta.dirname, '../data/merchants.json'), // dist → src? unlikely but cheap
    resolve(import.meta.dirname, 'data/merchants.json'),
    resolve(import.meta.dirname, '../src/data/merchants.json'), // dist → src/data (bundle)
    resolve(import.meta.dirname, '../../src/data/merchants.json'),
    resolve(process.cwd(), 'src/data/merchants.json'),
    resolve(process.cwd(), 'apps/api/src/data/merchants.json'),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function compile(): CompiledMerchant[] {
  let raw: { merchants?: RawMerchantEntry[] } | null = null;
  const text = readMerchantsRaw();
  if (text === null) {
    log.warn('CATEGORIZE_MERCHANTS_LOAD_FAIL', {
      path: MERCHANTS_PATH,
      error: 'merchants.json not found in any candidate path',
    });
    return [];
  }
  try {
    raw = JSON.parse(text) as { merchants?: RawMerchantEntry[] };
  } catch (err) {
    log.warn('CATEGORIZE_MERCHANTS_LOAD_FAIL', {
      path: MERCHANTS_PATH,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const entries = Array.isArray(raw.merchants) ? raw.merchants : [];
  const out: CompiledMerchant[] = [];
  let skipped = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.pattern !== 'string' || entry.pattern.length === 0) {
      skipped++;
      continue;
    }
    if (!isCategory(entry.category)) {
      skipped++;
      continue;
    }
    const match: MatchKind = entry.match ?? 'contains';
    let regex: RegExp | null = null;
    if (match === 'regex') {
      try {
        regex = new RegExp(entry.pattern, 'i');
      } catch {
        skipped++;
        continue;
      }
    } else if (match === 'keyword') {
      // Precompile a whole-word matcher. The normalized merchant string is
      // already lowercased and space-delimited (non-alphanumerics become
      // spaces), so a multi-word keyword like "fried rice" is matched as a
      // contiguous token sequence bounded by word boundaries.
      try {
        const escaped = entry.pattern
          .toLowerCase()
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i');
      } catch {
        skipped++;
        continue;
      }
    }
    out.push({
      pattern: entry.pattern,
      patternLower: entry.pattern.toLowerCase(),
      match,
      regex,
      category: entry.category,
      displayName: entry.displayName,
    });
  }

  // Stable sort: more specific matchers first, longer patterns first within
  // the same kind. This means a single linear scan returns the best hit.
  out.sort((a, b) => {
    const byKind = MATCH_PRIORITY[a.match] - MATCH_PRIORITY[b.match];
    if (byKind !== 0) return byKind;
    return b.patternLower.length - a.patternLower.length;
  });

  log.debug('CATEGORIZE_MERCHANTS_LOADED', {
    loaded: out.length,
    skipped,
  });
  return out;
}

/**
 * Look up a merchant in the curated catalogue. Returns null on miss.
 *
 * Caller is expected to pass the *already normalized* merchant string —
 * the same key we use for `category_overrides`. Passing a raw description
 * will silently miss most patterns.
 */
export function categorizeFromMerchantDB(normalizedMerchant: string): MerchantHit | null {
  if (!normalizedMerchant) return null;
  const haystack = normalizedMerchant.toLowerCase();

  for (const m of COMPILED) {
    if (matches(haystack, m)) {
      return {
        category: m.category,
        displayName: m.displayName,
        confidence: 0.95,
      };
    }
  }
  return null;
}

function matches(haystack: string, m: CompiledMerchant): boolean {
  switch (m.match) {
    case 'exact':
      return haystack === m.patternLower;
    case 'startsWith':
      return haystack.startsWith(m.patternLower);
    case 'regex':
      return m.regex !== null && m.regex.test(haystack);
    case 'contains':
      return haystack.includes(m.patternLower);
    case 'keyword':
      return m.regex !== null && m.regex.test(haystack);
  }
}

/** Exposed for diagnostics + the smoke script. */
export function merchantCatalogueSize(): number {
  return COMPILED.length;
}
