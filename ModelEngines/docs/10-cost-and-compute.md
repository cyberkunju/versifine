# 10 · Cost & Compute

The build must cost **≤ $30** (constraint N7), ideally ~$0 after Modal's free
credits. This document is the budget, the GPU selection, and the Modal
specifics.

---

## The cost principle

Only GPU work on Modal costs money. Everything CPU/network-bound runs free on
the laptop. And the **template trick** (doc 05) means the LLM produces a few
thousand building blocks, not millions of rows — collapsing LLM token cost ~10×.
Small encoders → short trainings. Net: a few dollars.

---

## Modal GPU pricing (verified, per-second billed)

| GPU | VRAM | $/hr | Used for |
|---|---|---|---|
| B200 | 180 GB | $6.25 | (not needed) |
| **H200** | 141 GB | **$4.54** | Gemma FP8 serving (generation) |
| H100 | 80 GB | $3.95 | (alt training) |
| **A100-80GB** | 80 GB | ~$2.50 | encoder training |
| L40S | 48 GB | $1.95 | (alt) |
| A10G | 24 GB | $1.10 | (alt export) |
| **L4** | 24 GB | $0.80 | export + eval |
| T4 | 16 GB | $0.59 | (glue) |

Plans: Starter = **$30/mo free credits**, 10-GPU concurrency. Serverless,
scale-to-zero, no minimums. (Sources in doc 12.)

---

## Per-phase budget (one full build)

| Phase | Where | GPU | Time | Cost |
|---|---|---|---|---|
| Harvest + crosswalk | Laptop | — | overnight | **$0** |
| Gemma generate | Modal | H200 FP8 | ~1 h | ~$5 |
| Gemma verify (tail) | Modal | H200 | ~0.5 h | ~$2.5 |
| Expand (millions of rows) | Laptop | — | minutes | **$0** |
| Train bi + cross encoder | Modal | A100-80GB (1 fn) | ~3 h | ~$8 |
| Export + INT8 + calibrate + publish | Modal | L4 | ~0.5 h | ~$0.5 |
| Eval | Modal | L4 | ~0.5 h | ~$0.5 |
| Volume storage | Modal | — | — | ~$1 |
| **TOTAL** | | | **~5-6 h GPU** | **≈ $17.5** |

One full build ≈ **$17.5**. Headroom for a re-run under $30. With $30/mo free
credits, real out-of-pocket for the first build ≈ **$0**.

Re-train after a data tweak (no Gemma re-gen): ~$9.5. Threshold-only re-tune:
~$1.5.

---

## Speed tweaks (fastest-of-fastest)

**Gemma (H200 FP8):**
- `quantization="fp8"` → ~33 GB, leaves huge KV headroom on the 141 GB H200.
- `enable_prefix_caching=True` → the long shared system prompt encoded once.
- `max_num_seqs=256` + asyncio `gather` over all leaf prompts → vLLM continuous
  batching saturates the GPU (~4-5k tok/s).
- JSON-guided decoding + short max_tokens → no wasted/retried generations.

**Training (A100-80GB):**
- Both encoders in **one function** → one cold start, max utilization.
- Bi-encoder: large batch (in-batch negatives are free) + AMP/fp16.
- Cross-encoder: subsample rows (pairwise is heavier), grad-accum if needed.

**General:**
- **Scale-to-zero:** every function dies when it returns; no idle burn.
- **Modal Volume** caches base weights + datasets → reruns skip downloads.
- **`--smoke` everything first** → never burn full-run GPU on a bug.

---

## GPU selection rationale

- **Gemma → H200**, not L40S: throughput scales faster than the price bump, so
  H200 is the best **tokens-per-dollar** for a short, batched generation burst.
  If H200 is unavailable, an A100-80GB FP8 works (slower, similar cost).
- **Training → A100-80GB**: the 80 GB fits the bi-encoder's large contrastive
  batch (which directly improves quality via more in-batch negatives). H100
  works too (faster, pricier).
- **Export/eval → L4**: tiny ONNX + inference work; cheapest GPU that's plenty.

---

## Cheaper / alternative profiles

| Profile | Change | Effect |
|---|---|---|
| Lowest cost | L40S for Gemma, A100 for train, L4 export | ~25% cheaper, ~1.5× slower |
| Laptop training | train both encoders on the 4060 overnight | saves ~$8, ties up laptop |
| Fastest | H200 Gemma, H100 train | ~$3-4 more, ~30% faster |

Knobs live in `config.py`: `GPU_GEMMA`, `GPU_TRAIN`, `GPU_EXPORT` (env-overridable).

---

## Cost guardrails (so you never overspend)

1. Smoke-test every Modal entrypoint (`--smoke`) before the full run.
2. Watch the Modal dashboard; functions scale to zero — confirm they did.
3. The Volume avoids re-downloading multi-GB bases on every run.
4. Re-generate with Gemma only when the prompt/leaves change; otherwise reuse
   `gemma_templates.jsonl` and just re-expand + retrain.
5. Record actual spend after each build (Definition of Done, doc 01).
