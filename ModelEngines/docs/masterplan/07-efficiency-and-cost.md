# 07 · Efficiency, Concurrency & Cost

The hard constraint: **v1 under $30**, ideally ~$0 after Modal free credits.
This documents every lever and the exact math.

## The core principle

**Data generation is free** (Opus subagents + laptop CPU/GPU). The ONLY paid
work is training small encoders, which is hours-not-days on a mid-tier GPU. So
cost is bounded and small.

## Modal GPU pricing (verified, per-second)

| GPU | VRAM | $/hr | Role in v1 |
|---|---|---|---|
| H200 | 141 GB | $4.54 | (not needed for v1) |
| A100-80GB | 80 GB | ~$2.50 | training (big-batch contrastive) |
| L40S | 48 GB | $1.95 | alt training |
| A10G | 24 GB | $1.10 | alt export |
| **L4** | 24 GB | $0.80 | export + eval |
| T4 | 16 GB | $0.59 | parallel embedding fan-out (if ever) |

Plan: Starter = **$30/mo free credits**, 10-GPU concurrency, scale-to-zero.

## v1 cost (one clean build, A100 @ $2.50)

| Stage | Where | Time | Cost |
|---|---|---|---|
| Teacher data (14 langs) | Subagents | — | $0 |
| Harvest + expand + transliterate + augment | Laptop CPU | hours | $0 |
| Hard-negative mining | Laptop GPU (4060) | ~15 min | $0 |
| Train bi-encoder (2-stage, big-batch) | A100 | ~1.5 h | ~$4 |
| Train cross-encoder | A100 | ~1 h | ~$2.5 |
| Export + INT8 + calibrate | L4 | ~0.5 h | ~$0.5 |
| Per-language eval | L4 | ~0.5 h | ~$0.5 |
| Volume storage | Modal | — | ~$1 |
| **One build** | | **~3.5 GPU-hr** | **≈ $8.5** |

| Scenario | Cost |
|---|---|
| 1 build | ~$9 |
| **Expected (build + 2 tuning iterations)** | **~$25** |
| Hard ceiling (Modal budget cap) | $30 |

After **$30/mo free credits**, realistic out-of-pocket ≈ **$0–5**.

## Efficiency levers (all applied)

### Free-data levers
1. **Opus subagents** generate all training data → $0 (vs ~$30–60 for
   Gemma+translator).
2. **Laptop harvest + expand + transliterate + augment** → $0.
3. **Hard-negative mining on the 4060** → the one normally-GPU step, free.

### Modal-cost levers
4. **Small models (118M)** → hours not days.
5. **bf16 + big-batch contrastive** → fewer steps, better quality/$ (in-batch
   negatives are free; bigger batch = more of them).
6. **`torch.compile`** → ~15-30% faster training.
7. **One warm container, both trainings** → single cold start (cold start on a
   568M-dep image is ~1-2 min; doing it once matters).
8. **A100-80GB not H200** → half the rate, fits 118M easily.
9. **Scale-to-zero** → no idle billing; functions die on return.
10. **Volume caching** → base weights + datasets cached; reruns skip downloads.
11. **`--smoke` first** → never burn a full run on a bug.
12. **Modal budget cap** → set $30 hard limit so you physically cannot overspend.

### Concurrency & parallelism
- **Laptop:** `augment.py` + `expand.py` fan out across the 8 Ryzen cores via
  `multiprocessing`; transliteration is per-row parallel.
- **Laptop GPU:** hard-neg mining batches the whole corpus through e5-small
  (the 4060 does ~thousands of embeds/sec).
- **Modal:** training itself is single-GPU (DDP overhead isn't worth it for
  118M). Where genuinely parallel (e.g. a one-off mass embedding), use
  `Modal.map` to fan out across many cheap T4/L4 workers — but v1 doesn't need
  it; the laptop handles embedding.
- **Pipeline overlap:** while Modal trains the bi-encoder, the laptop can be
  preparing the next iteration's data mix.

### The near-zero option
Train the bi-encoder on the laptop overnight too (free, slightly smaller batch)
→ a build is ~$3 (cross-encoder only on Modal). Recommended only if you want
absolute-minimum spend; the A100 bi-encoder is worth ~$4 for big-batch quality.

## v2 cost (future, for reference)

Bigger models (BGE-M3 568M) + active-learning loops → ~$55 one build, ~$90–140
with iteration. Data foundation is reused (still free). See doc 10.

## Cost guardrails (so you never overspend)

1. Smoke-test every Modal entrypoint.
2. Set the Modal workspace budget cap to $30 for v1.
3. Confirm scale-to-zero on the dashboard after each run.
4. Reuse `teacher_packs.jsonl` + harvest across iterations (regenerate only what
   changed).
5. Record actual spend after each build (Definition of Done).
