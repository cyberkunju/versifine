# 04 · Models

Exact model choices for v1 and v2, with research-backed rationale. All bases are
permissively licensed (MIT/Apache) so the fine-tuned derivatives ship freely.

## The teacher (both phases) — Opus 4.8 subagents

Generation only, build-time only, **never at runtime**. Produces the training
data (doc 03). Chosen over Gemma/IndicTrans2 because: $0, no GPU, no load-risk,
and superior idiomatic India-real text for the 14 languages. Output frozen to
`teacher/teacher_packs.jsonl` so the *dataset* is reproducible even though LLM
generation isn't bit-deterministic.

---

## v1 student models (ship now)

### Bi-encoder (retrieval) — `intfloat/multilingual-e5-small`
| Field | Value |
|---|---|
| Params | ~118M |
| Embedding dim | 384 |
| INT8 ONNX size | ~30 MB (browser-viable) |
| Languages | 100+ (incl. all 14) |
| Prefix convention | `query:` / `passage:` (MUST honour) |
| License | MIT |

**Why:** small enough to run **in-browser** (Privacy Mode) and train on an 8 GB
laptop GPU, natively multilingual, and our heavy Indic fine-tuning + hard
negatives close its Indic gap. "e5 or better via fine-tuning" — a small base
made strong by data, not size. The cross-encoder recovers any remaining
precision.

### Cross-encoder (rerank/decide) — `nreimers/mmarco-mMiniLMv2-L12-H384-v1`
| Field | Value |
|---|---|
| Params | ~118M |
| Input | `[transaction, candidate-label-sentence]` pair |
| Output | relevance score |
| Languages | multilingual (mMARCO-trained) |
| License | Apache-2.0 |

**Why:** small, fast, multilingual reranker; jointly attends over
`[query, candidate]` for the top-k from the bi-encoder → precision on ambiguous
pairs. Server-side (can also be distilled smaller for browser later).

> Research basis: fine-tuned encoder-only models beat LLM-prompting and frozen
> retrieval for short-text classification at 1–2 orders lower cost/latency
> ([arXiv 2602.06370]); retrieve→rerank adds several points over kNN
> ([ZeroEntropy], [hackerllama]). See doc 12.

---

## v2 student models (future — max accuracy)

### Bi-encoder — `BAAI/bge-m3` (568M)
Strongest open multilingual retriever (100+ langs, dense+sparse+multi-vector).
Server-side. ~560 MB INT8.

### Cross-encoder — `BAAI/bge-reranker-v2-m3` and/or `google/muril-large-cased`
- BGE-reranker-v2-m3: strong multilingual reranker, same family as BGE-M3.
- **MuRIL-large** (Indic-specialist, 17 Indian langs incl. transliterated): the
  research shows MuRIL **beats general multilingual models on Indic
  classification** (F1 90.6% Nepali; beats RoBERTa/IndicBERT on Hinglish). For a
  14-Indian-language decider, MuRIL is the precision champion.
- **Optional ensemble:** BGE-reranker + MuRIL-large + IndicBERT-v2, majority
  vote → +1-2 points + free confidence signal.

> Why MuRIL only in v2: it's a 2021 raw BERT (not retrieval-trained), ~500 MB —
> too heavy for v1's browser goal, but ideal as a server-side Indic decider when
> max accuracy is the goal.

---

## Browser (Privacy Mode) student — both phases

`multilingual-e5-small` INT8 (~30 MB) via **Transformers.js / ONNX Runtime Web**
(WebGPU where available, WASM fallback), cached in IndexedDB after first load.
Runs bi-encoder + merchant DB + example-bank kNN + conformal gate fully offline.
In v1 this IS the e5-small we trained; in v2 it's a distilled small sibling of
BGE-M3. The cross-encoder is server-only (browser uses bi-encoder top-1 + a
stricter gate).

---

## Model interaction at runtime (both phases)

```
query → bi-encoder embed (query:) → cosine vs label + example-bank vectors
      → top-k candidate leaves
      → cross-encoder scores [query, candidate] pairs → winner + score
      → conformal gate → emit / context-resolve / micro-question
```

## Pinning & manifest

All bases pinned by repo id (+ revision) in `config.py`. The teacher identity,
both encoder bases, taxonomy version, conformal thresholds, language matrix, and
bundle version are recorded in `manifest.json` so the API knows exactly what it
loaded and a rebuild is reproducible.

## Output artifacts

Published to HF (`CyberKunju/versifine-categorizer-v1` and later `-v2`):
`biencoder/` (INT8 ONNX + tokenizer), `crossencoder/`, `label_sentences.json`,
`label_embeddings.npy`, `example_bank.parquet`, `conformal.json`,
`manifest.json`, `eval_report.json`.
