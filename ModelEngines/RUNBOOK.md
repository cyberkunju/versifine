# RUNBOOK — building the v2 categorizer

The exact sequence, what runs where, and the cost/time budget. Designed so the
whole build lands **under $30** (likely $0 after Modal's $30/mo free credits).

## Compute split

| Work | Where | Why | Cost |
|---|---|---|---|
| Harvest + crosswalk + expand + package | **Laptop** (RTX 4060 8 GB, Ryzen 7 7840HS, 16 GB) | network/CPU-bound, time-insensitive | $0 |
| Gemma generation + verify | **Modal H200 (FP8)** | only an LLM can make the diversity | ~$7.5 |
| Train bi + cross encoder | **Modal A100-80GB** (one fn) | short jobs, frees the laptop | ~$8 |
| ONNX export + INT8 + calibrate + publish | **Modal L4** | minutes | ~$1 |
| Eval | **Modal L4** | minutes | ~$0.5 |
| Volume storage | Modal | — | ~$1 |
| **Total** | | | **≈ $18** |

## One-time setup

```sh
cd ModelEngines
python -m venv .venv && .venv\Scripts\activate    # (or your env)
pip install -r requirements.txt
modal token new
modal secret create huggingface HF_TOKEN=hf_xxxxxxxx   # needs gemma access + push rights
```

## Validate the label space (always first, instant)

```sh
python -m taxonomy.taxonomy --validate     # 13 groups / 59 leaves, consistent
python -m taxonomy.crosswalk --validate    # 87 MCC ranges, 105 plaid, 37 fsq → all valid
```

## Phase 0 — LAPTOP: harvest + deterministic labels (overnight, free)

```sh
python local/harvest.py                                  # wikidata + osm_nsi + repo merchants
python local/harvest_bulk.py --source foursquare --country IN --limit 200000   # FSQ POIs (optional, big)
python local/crosswalk_build.py                          # → data/harvest_pairs.parquet
```

## Phase 1 — MODAL: Gemma makes the building blocks (~1.5 h, ~$7.5)

```sh
modal run jobs/01_gemma_generate.py --smoke    # 3 leaves, sanity check first
modal run jobs/01_gemma_generate.py            # all 59 leaves → gemma_templates.jsonl (Volume)
modal volume get versifine-categorizer-vol gemma_templates.jsonl data/   # pull to laptop
```

## Phase 2 — LAPTOP: explode to millions of rows (minutes, free)

```sh
python local/expand.py     # → data/train.parquet, eval.parquet, example_bank.parquet
# push the datasets to the Volume for training:
modal volume put versifine-categorizer-vol data/train.parquet train.parquet
modal volume put versifine-categorizer-vol data/eval.parquet eval.parquet
modal volume put versifine-categorizer-vol data/example_bank.parquet example_bank.parquet
```

## Phase 3 — MODAL: train both encoders (~3 h, ~$8)

```sh
modal run jobs/02_train_encoders.py --smoke    # tiny, verifies the loop
modal run jobs/02_train_encoders.py            # full train → biencoder/ crossencoder/ (Volume)
```

## Phase 4 — MODAL: export, quantize, calibrate, publish (~30 min, ~$1)

```sh
modal run jobs/03_export_publish.py            # ONNX+INT8+conformal → bundle/ + HF push
```

## Phase 5 — MODAL: evaluate (~30 min, ~$0.5)

```sh
modal run jobs/04_eval.py                      # headline reranked top-1 + per-group
```

## Phase 6 — LAPTOP: install into the repo

```sh
python local/package.py                         # pulls HF bundle → apps/api + apps/web
```

## Iterating cheaply

- Taxonomy/crosswalk edits → re-validate, no GPU.
- Data-mix tweaks (`config.py` knobs) → re-run `expand.py` (free) + retrain ($8).
- Only re-run Gemma generation when you change the prompt or add leaves.
- Everything is seeded/deterministic where it can be, so reruns are reproducible.

## Guardrails

- `--smoke` exists on every Modal entrypoint; always smoke-test first to avoid
  burning GPU minutes on a bug.
- Modal scales to zero between phases — no idle cost.
- The Volume caches base weights + datasets so reruns skip downloads.
- If a harvest source is down, the pipeline still works (synthesis covers every
  leaf from taxonomy examples — proven offline, ~6k rows/leaf even with zero
  harvest/Gemma input).

