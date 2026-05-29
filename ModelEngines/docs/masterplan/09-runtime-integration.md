# 09 · Runtime Integration

How the Versifine API (server) and the web app (in-browser Privacy Mode) consume
the model, and how the flywheel closes the loop. Same bundle, two runtimes.

## The bundle

Installed by `local/package.py` (pulled from HF) into:
- `apps/api/src/ml/cat-v1/` (server, onnxruntime-node)
- `apps/web/static/models/cat-v1/` (browser, onnxruntime-web)

```
biencoder/          INT8 ONNX + tokenizer
crossencoder/       INT8 ONNX + tokenizer   (server only)
label_sentences.json
label_embeddings.npy
example_bank.parquet
conformal.json      { threshold, retained_accuracy, coverage }
manifest.json       labels, legacy_map, kind_map, language matrix, thresholds, version
eval_report.json
```
API reads the label set + thresholds from `manifest.json` → model and app never
disagree.

## Server engine (replaces the dead v1 MiniLM tier in services/categorize)

The existing cascade shape stays; the ML tier becomes retrieve→rerank→gate.

```ts
categorize(text, userSpaceId):
  norm = normalize(text)                      // script-detect, NFC, de-noise, digits
  if hit = overrides[space, norm]: return hit (1.0, 'overrides')
  if hit = merchantDB(norm):       return hit (0.95, 'merchants')

  qv = biEncoder.embed("query: " + norm)              // 384-d, mean-pool, L2-norm
  sims = cosine(qv, labelEmb ∪ exampleBankVecs)        // include flywheel vectors
  cand = topK(sims, manifest.retrieve_top_k)

  pairs = cand.map(c => [norm, labelSentences[c]])
  scores = crossEncoder.score(pairs)
  winner = argmax(scores); winnerSim = sims[winner]

  if winnerSim >= conformal.threshold:
     return { leaf: winner, legacy: legacyMap[winner], confidence: winnerSim, source: 'model-v1' }
  else:
     ctx = resolveFromUserHistory(norm, space)         // ambiguity → context
     if ctx: return ctx
     return { leaf: 'other', needsConfirm: true, candidates: cand.slice(0,3) }  // micro-question
```
Notes:
- **onnxruntime-node** on the EC2 box; mean-pool + L2-normalize (e5 convention);
  honour `query:`/`passage:` prefixes.
- **Lazy + sticky load** (load once, cache; missing bundle → degrade to merchant
  DB + Other, never crash a capture).
- **Path robustness:** resolve model dir against multiple candidates (the v1 bug
  was a bundled-dist path mismatch — use the fixed multi-candidate loader).
- Return **legacy** category too (backward compat); store both leaf (v1) +
  category (legacy) during migration.

## Browser engine (Privacy Mode, optional)

`apps/web/static/models/cat-v1/` + **onnxruntime-web** (WebGPU→WASM fallback),
cached in IndexedDB after first load. Runs tiers 0,1,2,3a + gate (e5-small +
lookups). Cross-encoder is server-only; browser uses bi-encoder top-1 with a
stricter threshold. Raw text never leaves the device; only the category is
stored. This is a *mode*, not the default (the app is already server-connected,
so server categorization adds no privacy loss for normal use).

## The flywheel (closing the loop)

```
user corrects category ("this is Groceries, not Other")
   │
   ├─► upsert override (tier 1, exact, per space)         ← immediate exact fix
   │
   └─► embed corrected phrase with bi-encoder
       append (leaf, phrase, vector) to example bank        ← semantic fix
       → next similar/novel txn retrieves it, no retrain
```
Two layers of learning from one correction: exact (override) + semantic (bank).

Operational rules:
- Example bank is **per-deployment / private** — stores corrected *phrases*, not
  full user histories (privacy).
- Cap bank size per (leaf,lang); evict oldest/least-similar to keep retrieval
  fast.
- Periodically (optional, offline) fold accumulated corrections into a retrain to
  sharpen the cross-encoder too — but the model improves without it.

## Ambiguity resolution (the path to effective ~100%)

When the gate abstains on a decidable-but-ambiguous merchant:
1. user history (did they categorize this before?) → reuse,
2. co-signals (amount/recurrence/wallet/time),
3. one micro-question, remembered forever.
Never blind-guess; never a confident wrong answer.

## Migration from the old categorizer

1. Ship v1 alongside; route new captures through it.
2. Keep writing the legacy `category` (via legacy_map) so existing
   reports/budgets keep working.
3. Optionally backfill: re-run v1 over historical transactions to enrich with the
   finer leaf.
4. Once confident, surface the 59-leaf taxonomy in reports/budgets.

## Observability

- Log `source` tier + confidence + detected language per categorization (PII-safe
  counts, not raw text).
- Surface `eval_report.json` in an internal dashboard.
- Alert if abstention rate spikes (drift or broken bundle).

## What NOT to do at runtime

- No LLM call to categorize (distill, don't serve).
- No network call during inference.
- No blind guess when uncertain — abstain / context-resolve / ask once.
