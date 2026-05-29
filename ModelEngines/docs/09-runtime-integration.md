# 09 · Runtime Integration

How the Versifine API and web app consume the published model, and how the
flywheel closes the loop. This is what turns the bundle into a working feature.

---

## The bundle the runtime loads

From `apps/api/src/ml/model-v2/` (server) and `apps/web/static/models/v2/`
(browser), installed by `local/package.py` (pulled from HF):

```
biencoder/          INT8 ONNX + tokenizer
crossencoder/       INT8 ONNX + tokenizer
label_sentences.json   per-leaf "passage" sentence
label_embeddings.npy   precomputed leaf vectors (ready index)
example_bank.parquet   (leaf, phrase) seed for the flywheel
conformal.json         { threshold, coverage }
manifest.json          labels, legacy_map, kind_map, thresholds, knobs
eval_report.json       last eval (for ops visibility)
```

The API reads the **label set from `manifest.json`** — model and app never
disagree (constraint P5).

---

## Server-side engine (new tier 3 in `services/categorize`)

Replaces the dead v1 MiniLM tier. The existing cascade (overrides → merchant DB
→ ML → Other) keeps its shape; the ML tier becomes retrieve→rerank→gate.

Pseudocode (TypeScript, onnxruntime-node):

```
categorizeV2(text):
  norm = normalizeMerchant(text)
  if hit = overrides[space, norm]: return hit (conf 1.0, 'overrides')
  if hit = merchantDB(norm):       return hit (conf 0.95, 'merchants')

  qv = biEncoder.embed("query: " + text)               // 384-d, normalized
  sims = cosine(qv, labelEmbeddings ∪ exampleBankVecs)  // include flywheel
  cand = topK(sims, manifest.retrieve_top_k)            // leaf candidates

  pairs = cand.map(leaf => [text, labelSentences[leaf]])
  scores = crossEncoder.score(pairs)
  winner = argmax(scores); winnerSim = sims[winner]

  if winnerSim >= conformal.threshold:
     return { leaf: winner, legacy: legacyMap[winner],
              confidence: winnerSim, source: 'model-v2' }
  else:
     return { leaf: 'other', legacy: 'Other',
              confidence: winnerSim, source: 'low_confidence' }   // flag for review
```

Implementation notes:
- **onnxruntime-node** runs both ONNX models on CPU on the EC2 box (fast enough;
  see latency budget doc 01). Mean-pool the bi-encoder hidden states + L2
  normalize (e5 convention). Honour the `query:`/`passage:` prefixes.
- **Lazy + sticky load** like the v1 MiniLM loader: load once, cache; if the
  bundle is missing, fall through to merchant DB + Other (degrade gracefully,
  never crash a capture).
- **Path robustness:** resolve the model dir against multiple candidates (the v1
  bug was a bundled-dist path mismatch — don't repeat it; use the same
  multi-candidate approach as the fixed merchants.json loader).
- Return the **legacy** category too, so stored transactions + the API enum keep
  working (constraint N6). Store both `leaf` (v2) and `category` (v1) on the
  transaction during migration.

---

## Browser (Privacy Mode) engine

`apps/web/static/models/v2/` + `onnxruntime-web` (WASM/WebGPU). Runs tiers
1+2+3a (bi-encoder) + conformal gate. The cross-encoder is server-only if it
can't fit the browser budget; the browser uses bi-encoder top-1 with a stricter
threshold. The 384-d e5-small INT8 (~30 MB) is the reason the bi-encoder must
stay small (constraint N3).

---

## The flywheel (closing the loop)

This is what makes the system improve without retraining.

```
user corrects a category  (UI: "this is Groceries, not Other")
        │
        ▼
API: upsert the override (tier 1, exact, per space)   ← immediate exact fix
        │
        ▼
embed the corrected phrase with the bi-encoder
append (leaf, phrase, vector) to the example bank      ← semantic fix
        │
        ▼
next similar/novel transaction now retrieves it → correct without a retrain
```

Two layers of learning from one correction:
1. **Exact** (override): the identical merchant is now always right.
2. **Semantic** (example bank): *similar* merchants/phrasings now resolve too.

Operational rules:
- The example bank is **per-deployment / private** — it stores corrected example
  phrases, never full user histories (constraint P4).
- Periodically (offline, optional) fold the accumulated corrections into a
  retrain to also sharpen the cross-encoder — but the model works and improves
  without it.
- Cap the bank size per leaf (evict oldest/least-similar) to keep retrieval
  fast.

---

## Migration from v1

1. Ship v2 alongside v1; route new captures through v2.
2. Keep writing the v1 `category` (via `legacy_map`) so existing reports/budgets
   keep working unchanged.
3. Optionally backfill: re-run v2 over historical transactions to enrich them
   with the finer leaf (store leaf alongside the legacy category).
4. Once confidence is high, the UI can surface the richer 59-leaf taxonomy in
   reports/budgets.

---

## Observability

- Log `source` tier + confidence per categorization (PII-safe: counts, not raw
  text) so you can see how often each tier fires and the low-confidence rate.
- Surface `eval_report.json` in an internal dashboard.
- Alert if the low-confidence (abstention) rate spikes — signals drift or a
  broken bundle.

---

## What NOT to do at runtime (constraint reminders)

- No LLM call to categorize (P1). The engine is pure ONNX + lookup.
- No network call during inference (N3).
- No guessing when uncertain — abstain (N5).
