# 03 · Architecture

Two architectures to understand: the **runtime** (what categorizes a live
transaction) and the **build pipeline** (what produces the runtime artifacts).

---

## Runtime architecture (inference)

A cascade — cheap, exact tiers first; semantic tiers only when needed. This is
what runs inside the Versifine API (and a reduced form in the browser).

```
 transaction text
        │
        ▼
 ┌──────────────────────────────────────────────┐
 │ TIER 1 · user overrides (per space)           │  exact, instant, free
 │   normalized_merchant → category (conf 1.0)   │  user corrected this before
 └──────────────────────────────────────────────┘
        │ miss
        ▼
 ┌──────────────────────────────────────────────┐
 │ TIER 2 · curated merchant DB                  │  exact patterns, instant
 │   regex / contains / startsWith / exact (0.95)│  427+ India merchants
 └──────────────────────────────────────────────┘
        │ miss
        ▼
 ┌──────────────────────────────────────────────┐
 │ TIER 3a · bi-encoder retrieval                │  local ONNX, ~5-15 ms
 │   embed(query) · cosine vs label embeddings   │  → top-K candidate leaves
 │   AND vs example-bank vectors (flywheel)      │
 └──────────────────────────────────────────────┘
        │ top-K
        ▼
 ┌──────────────────────────────────────────────┐
 │ TIER 3b · cross-encoder rerank                │  local ONNX, ~10-30 ms
 │   score [text, candidate] pairs, pick winner  │  precision on hard pairs
 └──────────────────────────────────────────────┘
        │ winner + score
        ▼
 ┌──────────────────────────────────────────────┐
 │ TIER 4 · conformal gate                       │  statistical abstention
 │   score ≥ threshold → emit leaf (+confidence) │
 │   score <  threshold → 'other' / flag review  │
 └──────────────────────────────────────────────┘
        │
        ▼
 leaf (+ legacy category, + confidence, + source tier)
        │
        └──► user correction → embed phrase → append to example bank (FLYWHEEL)
```

### Why a cascade
- **Overrides + merchant DB** resolve the high-frequency, unambiguous cases in
  microseconds for free; no reason to run a model on "NETFLIX".
- The **model tiers** handle the long tail and messy/novel text.
- The **conformal gate** is the honesty layer — it converts "I'm not sure" into
  an abstention instead of a confident mistake.

### The example bank (open vocabulary + flywheel)
A table of `(leaf, phrase)` rows, each with a precomputed embedding. Two roles:
1. **Open vocabulary:** label "centroids" are derived from example phrases, so a
   new leaf is added by inserting phrases — no retrain.
2. **Flywheel:** when a user corrects a category, the corrected phrase is
   embedded and appended. Retrieval now pulls it for similar future text.

Retrieval compares the query against BOTH the per-leaf label-sentence embeddings
AND the example-bank vectors; the leaf with the strongest aggregate similarity
wins the candidate slot.

### Browser (Privacy Mode) reduction
The browser runs Tier 1 + 2 + 3a (bi-encoder) + conformal gate. The
cross-encoder (Tier 3b) is server-side if it can't fit; the browser path uses
the bi-encoder top-1 with a stricter conformal threshold, accepting slightly
lower precision for full on-device privacy.

---

## Build (training) architecture

Two execution environments, split by cost. Only GPU work touches Modal.

```
 ┌───────────────────────────  LAPTOP (free)  ───────────────────────────┐
 │                                                                        │
 │  harvest.py / harvest_bulk.py                                          │
 │    Wikidata (CC0), OSM-NSI, Foursquare/Overture (DuckDB), repo DB      │
 │            │  (name, signal_type, signal, source)                      │
 │            ▼                                                           │
 │  crosswalk_build.py                                                    │
 │    MCC/Plaid/FSQ/industry → leaf  (deterministic, drop-if-unresolved)  │
 │            │  harvest_pairs.parquet  (real merchant → leaf)            │
 │            ▼                                                           │
 │  expand.py   ◄────────────── gemma_templates.jsonl (from Modal)        │
 │    explode templates × slot-fillers + UPI-wrap merchants + realism     │
 │    transforms → balance per leaf → dedup → split                       │
 │            │  train.parquet · eval.parquet · example_bank.parquet      │
 │            ▼                                                           │
 │  package.py  (after publish) → install bundle into apps/api + apps/web │
 └────────────────────────────────────────────────────────────────────┘
                              ▲                         │ datasets up
            templates down    │                         ▼
 ┌───────────────────────────  MODAL (paid, tiny)  ──────────────────────┐
 │                                                                        │
 │  jobs/01_gemma_generate.py   H200 FP8 vLLM                             │
 │    Gemma 4 31B-it → per-leaf {templates, aliases, phrasings, mixed}    │
 │    + self-consistency verify on the ambiguous tail                     │
 │                                                                        │
 │  jobs/02_train_encoders.py   one A100-80GB function                    │
 │    Stage A: bi-encoder (e5-small), contrastive, in-batch + hard negs   │
 │    Stage B: cross-encoder (mDeBERTa-v3), pairwise rerank labels         │
 │                                                                        │
 │  jobs/03_export_publish.py   L4                                         │
 │    ONNX export → INT8 quant → embed label/bank → conformal calib →     │
 │    manifest → push HF + commit Volume                                  │
 │                                                                        │
 │  jobs/04_eval.py             L4                                         │
 │    full retrieve→rerank→gate eval, per-segment + per-group report      │
 └────────────────────────────────────────────────────────────────────┘
```

### Why this split
Only Gemma on a GPU and the (short) encoder trainings cost money. The
heavy-but-cheap work — harvesting, the combinatorial explosion into millions of
rows, packaging — is CPU/network-bound and runs free on the laptop. See doc 10.

### Why retrieve→rerank instead of one classifier
- A **bi-encoder** is fast and gives open-vocabulary retrieval, but it encodes
  query and label separately, so it blurs hard pairs.
- A **cross-encoder** jointly attends over `[query, candidate]` → far better on
  ambiguity, but too slow to score every label for every transaction.
- Combined: bi-encoder narrows to top-k (fast recall), cross-encoder picks the
  winner (slow precision on only k items). This is the standard modern stack and
  is the single biggest accuracy lever after data quality.

### Why distill instead of serve the LLM
The LLM's knowledge is captured in the **training data it generates** and in the
**verify labels** on the hard tail. The encoders learn that knowledge. At
runtime the encoders ARE the distilled teacher — LLM-quality decisions at
embedding speed, offline, free. (Backed by the Rank-DistiLLM result: distilled
cross-encoders reach LLM effectiveness at orders-of-magnitude lower cost.)

---

## Data flow contract (file-by-file)

| File | Produced by | Schema | Consumed by |
|---|---|---|---|
| `harvest_raw.jsonl` | harvest(_bulk) | name, signal_type, signal, source | crosswalk_build |
| `harvest_pairs.parquet` | crosswalk_build | text, leaf, source, confidence | expand |
| `gemma_templates.jsonl` | jobs/01 | leaf, templates[], merchant_aliases[], phrasings[], code_mixed[] | expand |
| `train.parquet` | expand | text, leaf | jobs/02 |
| `eval.parquet` | expand | text, leaf | jobs/02 (calib), jobs/04 |
| `example_bank.parquet` | expand | leaf, text | jobs/03 (embed), runtime |
| `biencoder/`, `crossencoder/` | jobs/02 | ST model dirs | jobs/03 |
| `bundle/` | jobs/03 | onnx + npy + json | jobs/04, package, runtime |

Every randomized producer is seeded (config). Schemas are stable contracts —
changing one means updating both producer and consumer.
