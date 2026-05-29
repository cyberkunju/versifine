# 06 · Models

Exact model choices, versions, and the rationale for each. All three are
Apache-2.0 or MIT, so the shipped derivatives are clean.

---

## Teacher (build-time only) — Opus 4.8 subagents (replaces Gemma)

**Decision update:** the teacher was originally Gemma 4 31B-it on Modal. We
switched to **Opus 4.8 subagents** for generation (see `teacher/README.md`):
$0, no GPU, no vLLM/Gemma load risk, and equal-or-better Indic code-mix
quality. The teacher's only job is text generation — exactly what subagents do
natively. Output is frozen to `teacher/teacher_packs.jsonl`, so the dataset is
reproducible even though LLM generation isn't bit-deterministic.

`jobs/01_gemma_generate.py` is retained for reference / as a fallback teacher,
but the subagent path is the supported one. Everything below about the teacher's
*role* (generate building blocks, distill into encoders, never serve at runtime)
is unchanged.

### What the teacher produced (verified)
59 packs, all leaves covered: 2,618 templates, 3,794 merchant aliases, 1,978
phrasings, 1,587 code-mixed variants. `teacher/merge.py --check` validates
coverage + counts.

---

## (Legacy reference) Gemma 4 31B-it

| Field | Value |
|---|---|
| Repo | `google/gemma-4-31B-it` (instruction-tuned) |
| License | Apache-2.0 |
| Params | 31B dense |
| Context | 256K |
| Languages | 140+ (covers all 6 target Indic langs) |
| Modality | text + image (we use text) |
| Serving | vLLM, FP8 (~33 GB) on a Modal H200 (141 GB) |

**Role:** generates the per-leaf building-block packs (templates, aliases,
phrasings, code-mixed) and runs the self-consistency verify on the ambiguous
tail. **Never at runtime.** Only LLM in the pipeline (constraint N8).

**Why this one:** strong multilingual (essential for Indic code-mix), open +
Apache-2.0 (outputs usable for training), large enough for high-quality diverse
generation, runs locally on one Modal GPU. Decision fixed by the project owner:
single model, Gemma 4 31B, served on Modal not via external API.

**Serving tweaks** (`jobs/01_gemma_generate.py`): `quantization="fp8"`,
`gpu_memory_utilization=0.92`, `enable_prefix_caching=True` (the long shared
system prompt is encoded once), `max_num_seqs=256` + asyncio gather (continuous
batching saturates the GPU), JSON-guided decoding so outputs parse first time.

> Alternatives considered and rejected: multi-LLM consensus (owner constraint
> N8 = single model); cloud LLM API (constraint: run on Modal, not API).

---

## Bi-encoder (runtime) — multilingual-e5-small

| Field | Value |
|---|---|
| Repo | `intfloat/multilingual-e5-small` |
| License | MIT |
| Params | ~118M |
| Embedding dim | 384 |
| INT8 ONNX size | ~30 MB (browser-friendly) |
| Prefix convention | `query: …` / `passage: …` (MUST honour) |

**Role:** embed the transaction (`query:`) and category label sentences /
example-bank phrases (`passage:`); cosine retrieve the top-K candidate leaves.

**Why this one:** small enough to **train on an 8 GB laptop GPU** and run **in
the browser** (Privacy Mode) — the offline constraint (N3) is decisive. Natively
multilingual, strong on Indic + code-mix. We trade a couple points of raw
embedding quality vs a bigger model (BGE-M3) for offline capability; the
cross-encoder reranker recovers the accuracy.

**Training:** contrastive `MultipleNegativesRankingLoss`, large batch (in-batch
negatives), + hard negatives mined from the bi-encoder after a warmup epoch.
Anchor = transaction text; positive = its leaf's label sentence. Short sequences
(`max_len=64`). See doc 07.

> Alternative: **BGE-M3** (560M) is stronger but ~2.3 GB loaded — too heavy for
> the laptop GPU and the browser. Use it only if the offline/Privacy-Mode
> requirement is dropped (it is not). `paraphrase-multilingual-MiniLM-L12-v2` is
> a fallback if e5 underperforms on a specific language.

---

## Cross-encoder reranker (runtime) — mDeBERTa-v3-base

| Field | Value |
|---|---|
| Repo | `microsoft/mdeberta-v3-base` |
| License | MIT |
| Params | ~280M |
| INT8 ONNX size | ~300 MB |
| Input | `[transaction, candidate-label-sentence]` pair |
| Output | relevance score (binary head) |

**Role:** jointly attend over `[query, candidate]` for each of the K candidates
from the bi-encoder; pick the highest-scoring leaf. This is the precision
powerhouse on ambiguous pairs.

**Why this one:** best accuracy/size for **multilingual short-text pair**
scoring; cross-encoders add several points over bi-encoder kNN on exactly this
kind of disambiguation (research-backed, doc 12). 280M trains on the laptop GPU
with small batch + grad-accum + fp16 (overnight), or fast on a Modal A100.

**Training:** for each training text, take the bi-encoder's top-K candidate
leaves, label the true leaf 1 and the rest 0, train a binary cross-encoder.
Always inject the true leaf as a positive even if the bi-encoder missed it.

> Alternative: a smaller MiniLM cross-encoder (`ms-marco-MiniLM`) if sub-10 ms
> latency is required; trades some accuracy. mDeBERTa is the accuracy choice.

---

## Model interaction at runtime

```
query "UPI/cultfit/..."
   │ bi-encoder embed (query:)         → vector
   │ cosine vs label + bank vectors    → top-8 leaves [fitness_sports, ...]
   ▼
cross-encoder scores 8 pairs
   [query, "Fitness & Sports (...): gym, cult.fit, ..."]  → 0.94
   [query, "Healthcare (...): hospital, ..."]            → 0.11
   ...                                                    → pick max
   ▼
winner fitness_sports, sim 0.94 ≥ conformal threshold → emit
```

## Versions & pinning

All bases pinned in `requirements.txt` / the Modal images (doc 10). The teacher
tag, both encoder bases, and the derived bundle version are recorded in
`manifest.json` so a rebuild is reproducible and the API knows exactly what it
loaded.

## Output artifact

Published to `CyberKunju/versifine-categorizer-v2` (HF), containing:
`biencoder/` (INT8 ONNX + tokenizer), `crossencoder/` (INT8 ONNX + tokenizer),
`label_sentences.json`, `label_embeddings.npy`, `example_bank.parquet`,
`conformal.json`, `manifest.json`, `eval_report.json`.
