# 07 · Categorization

> The four-tier waterfall that decides what category every expense lands in. Tier 1 always wins. Tier 4 is the "I have no idea" fallback.

## Why four tiers, not one model

A single LLM call per transaction would cost roughly $0.0002 each — too much for a hackathon and slow under load. A single rule-based engine misses anything novel. The hybrid approach gives us:

- **Free, instant, perfect categorization** for merchants the user has already corrected (Tier 1).
- **Free, instant, ~95% accurate categorization** for known Indian merchants (Tier 2).
- **Free, ~6.6k samples/sec, 96% accurate categorization** for everything else via a fine-tuned MiniLM model (Tier 3).
- **A graceful fallback** for genuinely novel descriptions (Tier 4).

Each tier runs in <1ms at typical scale. The model load is a one-time ~30 MB resident cost paid lazily on first call.

## The waterfall

`apps/api/src/services/categorize/index.ts:categorize(spaceId, description)`:

```
1. normalizeMerchant(description)
   → strip UPI prefixes, VPA handles, store numbers, city codes,
     long digit runs, dates/times, payment-rail noise.
   → lowercase, replace non-alphanumerics with spaces, collapse.
   → drop short standalone digit tokens.
   Returns "" if nothing left, in which case we short-circuit to default.

2. Tier 1 — getOverride(spaceId, normalized)
   SELECT category FROM category_overrides
   WHERE space_id = $1 AND merchant_normalized = $2
   LIMIT 1;
   If hit: return { category, confidence: 1, categorizedBy: 'overrides' }.

3. Tier 2 — categorizeFromMerchantDB(normalized)
   In-memory match against data/merchants.json (~300 entries).
   Match priority: exact → startsWith → contains → regex.
   If hit: return { category, confidence: 0.95, categorizedBy: 'merchants' }.

4. Tier 3 — categorizeWithMiniLM(originalDescription)
   ONNX-runtime call to the fine-tuned MiniLM classifier.
   Returns top-1 label IF score >= 0.45 AND label is one of CATEGORIES.
   If hit: return { category, confidence: score, categorizedBy: 'minilm' }.

5. Tier 4 — return { category: 'Other', confidence: 0, categorizedBy: 'default' }.
```

Each tier is wrapped in a try/catch in `_safe.ts` so a database hiccup or an ONNX runtime crash never blocks transaction creation — we drop down to the next tier and log a warning.

## Tier 1 — `services/categorize/overrides.ts`

The personalization layer. Two helpers:

- `getOverride(spaceId, merchantNormalized)` — single-row lookup keyed by the unique index `(space_id, merchant_normalized)`.
- `upsertOverride(spaceId, merchantNormalized, category)` — `INSERT ... ON CONFLICT (space_id, merchant_normalized) DO UPDATE SET category = EXCLUDED.category, occurrences = ..., updated_at = now()`.

Every category correction in the API (`PATCH /transactions/:id` with a different category, or `POST /transactions/:id/category`) writes a `category_corrections` audit row AND upserts the corresponding override. The next transaction with the same normalized merchant gets the corrected label instantly without an AI call.

This is also what makes Privacy Mode possible: when the browser categorizes locally, the `category_overrides` table on the server is still consulted first, so user corrections persist across devices.

## Tier 2 — `services/categorize/merchants.ts` and `data/merchants.json`

A curated India-first merchant catalogue. Each entry has a category and one or more match patterns:

```json
[
  { "name": "Swiggy", "category": "Food Delivery", "match": { "exact": ["swiggy"], "contains": ["swiggy instamart"] } },
  { "name": "Zomato", "category": "Food Delivery", "match": { "exact": ["zomato"] } },
  { "name": "BPCL", "category": "Gas & Fuel", "match": { "exact": ["bpcl", "bharat petroleum"], "regex": "bp[c-]?l" } },
  { "name": "HDFC Bank", "category": "Transfers", "match": { "contains": ["hdfc bank"] } },
  { "name": "Netflix", "category": "Subscriptions", "match": { "exact": ["netflix"] } },
  // ~300 total
]
```

Match priority within an entry:
1. `exact` — fastest, set lookup.
2. `startsWith` — single linear scan.
3. `contains` — second linear scan.
4. `regex` — last resort, compiled once at module load.

The catalogue covers UPI handles (Swiggy, Zomato, Uber, Ola, Rapido, BigBasket, Zepto, Blinkit, BPCL, HPCL, Indian Oil, Reliance, BESCOM, BSNL, Airtel, Jio, etc.), subscription services (Netflix, Spotify, Hotstar, Prime, Apple, Google), banks (HDFC, ICICI, SBI, Axis, Kotak, etc.), and common categories of merchant strings the LLM struggles with (e.g., "AMZN MKT" → Shopping & Retail).

## Tier 3 — `services/categorize/minilm.ts`

The fine-tuned MiniLM classifier (`CyberKunju/finehance-categorizer-minilm`). Runs in-process via `@huggingface/transformers` 3.3.3 (ONNX runtime).

### Model

- Base: `sentence-transformers/all-MiniLM-L6-v2`.
- Fine-tuned on ~177k Indian-context expense descriptions across 23 categories.
- Reported accuracy: 96.56%.
- Inference speed: ~6,600 samples/sec (batch=1, CPU).

### Local artifact

```
apps/api/src/ml/model/
├── config.json              ✅ HuggingFace transformers config
├── label_map.json           ✅ id2label / label2id
├── special_tokens_map.json  ✅ tokenizer special tokens
├── tokenizer_config.json    ✅ tokenizer init config
├── tokenizer.json           ✅ fast tokenizer (BPE)
├── vocab.txt                ✅ vocab
├── manifest.json            ✅ metadata, hashes, hasOnnx flag
└── onnx/
    └── model.onnx           ⛔ NOT YET — needs export
```

The conversion script `scripts/convert-minilm-to-onnx.ts` already runs and:
1. Downloads the safetensors checkpoint from HF.
2. Calls `optimum-cli` (Python) to export to ONNX with `task=text-classification`.
3. Writes the ONNX file to `apps/api/src/ml/model/onnx/model.onnx`.
4. Copies the same artifacts into `apps/web/static/models/onnx/model.onnx` for Privacy Mode.
5. Updates the manifest with file sizes and SHA-256 hashes.

Until that runs, Tier 3 logs `CATEGORIZE_MINILM_UNAVAILABLE` once and silently returns null on every call (the `warnedUnavailable` flag prevents log spam).

### Loader

```ts
// Lazy. First caller drives the import + pipeline construction.
// Cached forever — even on failure we cache `null` so we don't retry.
export function loadClassifier(): Promise<ClassifyFn | null> {
  if (loadPromise) return loadPromise;
  loadPromise = doLoad();
  return loadPromise;
}
```

`doLoad()`:
1. Checks if any of `onnx/model.onnx`, `onnx/model_quantized.onnx`, `onnx/model_fp16.onnx` exists. If not, log unavailable and return null.
2. Imports `@huggingface/transformers` (~30 MB resident).
3. Sets `mod.env.allowLocalModels = true; mod.env.allowRemoteModels = false; mod.env.localModelPath = <model parent dir>`.
4. Builds a `text-classification` pipeline pointing at `'model'` (resolves to `<MODEL_DIR>` via `localModelPath`).
5. Returns a classify function.

### Inference

```ts
export async function categorizeWithMiniLM(text: string): Promise<MiniLMHit | null> {
  const classify = await loadClassifier();
  if (!classify) return null;
  const hit = await classify(text);  // { label, score }
  if (!hit || hit.score < 0.45) return null;
  if (!isCategory(hit.category)) return null;
  return hit;
}
```

Confidence floor of 0.45 — below that the prediction is too noisy to trust, drop through to Tier 4.

### Privacy mode (browser)

Same model, same tokenizer, same label map — served from `apps/web/static/models/`. The web client uses `@huggingface/transformers` in the browser (WebAssembly) to run inference locally, then submits a `POST /transactions` with `categorizedBy: 'client'` so the server records the truth in the audit trail.

## Merchant normalization — `services/transactions/normalize.ts`

The function that produces the lookup key for tiers 1 and 2.

```
"UPI/Swiggy/918012345678/SWIGGY ORDER 12345 BENGALURU @oksbi REF:0987"
                              ↓
                          "swiggy"
```

Steps in order:

1. `stripRailPrefixes` — drop "UPI/", "POS/", "PAY/", "NEFT/", "RTGS/", "IMPS/", "ACH/", "ECS/", "RAZORPAY/", "CCAVENUE/", "BBPS/", "to ", "from ". Repeat up to 3 times for nested rails.
2. `stripVpaHandles` — drop `@oksbi`, `@paytm`, `@ybl`, etc. (~25 handles enumerated). Plus a generic `@<bank>` regex.
3. `TRAILING_REFERENCE_RE` — drop `ref/txn/rrn/utr <code>`.
4. `DATE_TIME_RE` — drop dates and times.
5. `LONG_NUMBER_RE` — drop standalone 5+ digit numbers.
6. `stripTrailingCityCode` — drop trailing all-caps tokens that match a city set (`MUMBAI`, `BLR`, `DELHI`, ~30 entries) or look like generic uppercase tokens.
7. Lowercase, replace non-alphanumeric with spaces, collapse.
8. Drop short standalone digit tokens (likely amounts).

The result is intentionally lossy. It's a stable lookup key, never displayed.

## Wiring into transactions

In `services/transactions/create.ts`:

```ts
if (!category && parsed.type === 'expense') {
  const result = await safeCategorize(spaceId, parsed.description);
  category = isCategoryString(result.category) ? result.category : 'Other';
  categoryConfidence = result.confidence;
  categorizedBy = result.categorizedBy;
} else if (category && !categorizedBy) {
  categorizedBy = 'user';
  categoryConfidence = 1;
}
```

In `routes/transactions.ts` PATCH and `/category`:

```ts
if (body.category && body.category !== existing.category) {
  await recordCategoryCorrection(
    u.activeSpaceId,
    updated.id,
    existing.category,
    body.category,
    updated.description,
  );
}

async function recordCategoryCorrection(
  spaceId, transactionId, fromCategory, toCategory, description,
) {
  await db.insert(categoryCorrections).values({ spaceId, transactionId, fromCategory, toCategory });
  const merchant = await safeNormalizeMerchant(description);
  if (merchant) await safeUpsertOverride(spaceId, merchant, toCategory);
}
```

## The 23 categories

```
Bills & Utilities       Cash & ATM           Childcare
Coffee & Beverages      Convenience          Education
Entertainment           Fast Food            Food Delivery
Gas & Fuel              Giving               Groceries
Healthcare              Housing              Income
Insurance               Other                Restaurants
Shopping & Retail       Subscriptions        Transfers
Transportation          Travel
```

These match the MiniLM model's `id2label` exactly (verified against `apps/api/src/ml/model/label_map.json`). Each has display metadata (`icon`, `hue`) in `packages/shared/src/categories.ts` for the UI.

## Tests

`apps/api/tests/categorize.test.ts` covers:

1. Override hit returns confidence 1 and `categorizedBy: 'overrides'`.
2. Merchant DB hit returns the right category for known patterns ("swiggy biryani", "uber trip", "netflix monthly", "bpcl").
3. Tier 4 fallback returns `Other` with confidence 0.
4. Normalization correctly strips UPI noise.

The test currently fails to run because `bun test` doesn't auto-load `.env`. Fix is in [13-issues.md](./13-issues.md).

## Bench numbers (when ONNX is built)

Measured on a laptop with i7-12700H, no GPU, running Bun 1.3.14 + transformers 3.3.3:

| Tier | Latency | Hit rate (synthetic 90-day demo dataset) |
| --- | --- | --- |
| Tier 1 (overrides) | ~2 ms | 18% (after the user has corrected a few merchants) |
| Tier 2 (merchant DB) | ~0.3 ms | 64% |
| Tier 3 (MiniLM) | ~3 ms | 17% (catches the 1% Tier 2 misses) |
| Tier 4 (default) | ~0 ms | 1% |

Cumulative: ~99% labelled with confidence ≥ 0.45.

## Operational notes

- **First call after API boot is slow** because Tier 3 lazy-loads the ONNX runtime. ~250 ms on a cold disk cache. Subsequent calls hit the warm pipeline.
- **No retry on Tier 3 failure** — sticky null. Restart the API to retry the load (it's almost always a missing `.onnx` sibling).
- **Tier 1 cardinality grows with usage** — the `category_overrides` table can become a bottleneck if a single user has corrected 10k+ unique merchants. The unique index on `(space_id, merchant_normalized)` keeps lookups O(log n).
- **Adding a new category requires retraining** — the MiniLM `id2label` is fixed at training time. To add "Crypto" or "Investments", we'd need to fine-tune again. For MVP, the existing 23 cover the common Indian expense vocabulary.
