# ModelEngines — Versifine Transaction Categorizer (v2)

The training + data pipeline for Versifine's open-vocabulary, retrieval-based
transaction categorizer. This is a **standalone Python project** (the rest of
the monorepo is TypeScript/Bun); it produces a small, fast, multilingual ONNX
model bundle that the API and the web app load at runtime.

> **Full A-to-Z documentation lives in [`docs/`](docs/README.md)** — read that
> first. It is self-contained: someone with only the `docs/` folder + these
> scripts can rebuild the entire model to extreme accuracy. This README is the
> quick orientation; the docs are the specification.

---

## Why this exists

The v1 categorizer was a closed 23-class classifier whose ML tier never even
ran in production (no ONNX artifact shipped). v2 fixes both problems:

- **Open vocabulary.** The label set is *data*, not baked-in weights. Adding a
  category = adding example phrases + one centroid. No retrain required.
- **Retrieve → rerank.** A fine-tuned multilingual **bi-encoder** retrieves the
  top-k candidate categories; a fine-tuned **cross-encoder** reranks them for
  precision. This is the modern two-stage stack and beats kNN voting by several
  accuracy points on short, messy, code-mixed text.
- **Distilled, not served.** A single LLM (**Gemma 4 31B-it**) *teaches* the
  data once; the small encoders learn it. At runtime there is **no LLM in the
  loop** — fully local, offline-capable (server + browser Privacy Mode).
- **Flywheel.** Every user correction + every hard-case decision is embedded
  back into the example bank, so accuracy compounds with zero retraining.

Target: **~93–97% top-1** on messy Indian code-mixed transaction text, climbing
over time, structurally incapable of "missing" a category.

---

## Architecture (runtime, in the API)

```
overrides (exact, instant, free)
  → merchant DB (exact patterns, instant, free)
  → bi-encoder kNN over example bank (local ONNX, ~5ms)   ── top-k candidates
  → cross-encoder rerank (local ONNX, ~10-20ms)           ── pick winner
  → conformal abstention gate                              ── ambiguous? →
  → Other (true last resort)                                  flag for review
        ▲
        └── every correction / hard-case decision → example bank (flywheel)
```

## Architecture (this pipeline, build time)

```
LAPTOP (free, overnight, network/CPU-bound)
  harvest.py        download Foursquare / Overture / Wikidata / OSM / HF sets
  crosswalk_build.py MCC ↔ Plaid ↔ our leaves ↔ FSQ ↔ HSN  →  real merchant pairs
  expand.py         explode Gemma templates → millions of labeled rows (CPU)
  package.py        fold the finished ONNX bundle into the repo

MODAL (paid, tiny, GPU-only)
  01_gemma_generate.py  Gemma 4 31B-it (FP8, vLLM): templates/slang/aliases
                        + self-consistency verify on the ambiguous tail
  02_train_encoders.py  ONE A100 fn: train e5-small bi-encoder, then
                        mDeBERTa-v3 cross-encoder
  03_export_publish.py  ONNX + INT8 quant + conformal calibration →
                        Modal Volume + push to HF repo
  04_eval.py            top-1 / top-k accuracy on the hand-checked held-out set
```

Compute split rationale: only Gemma on a GPU costs money. Generation uses the
**template trick** — the LLM produces a few thousand high-diversity templates +
slot-fillers, and the laptop cross-products them into millions of labeled rows
for free. Encoders are small (118M / 280M) so training is a 1–3 h job. Total
build cost ≈ **$17–18** (well under $30; likely $0 after Modal's free credits).

---

## Models

| Role | Model | Why |
|---|---|---|
| Teacher (generation + verify) | `google/gemma-4-31B-it` | Apache-2.0, 140+ langs, 256K ctx, strong multilingual; the *only* LLM used |
| Bi-encoder (retrieval) | `intfloat/multilingual-e5-small` (118M) | Trains on 8 GB, ~30 MB INT8 ONNX, browser-friendly, strong Indic + code-mix |
| Cross-encoder (rerank) | `microsoft/mdeberta-v3-base` (280M) | Best accuracy/size for multilingual short-text pair scoring |

---

## Layout

```
ModelEngines/
  README.md                  this file
  DATA_PROVENANCE.md         every source + license + how-used
  requirements.txt           python deps (pinned)
  config.py                  single source of paths, model ids, hyperparams
  taxonomy/
    taxonomy.json            ~13 groups / ~55 leaves, India-first
    crosswalk.json           MCC / Plaid / FSQ / HSN → our leaves
    taxonomy.py              loader + strict validation + legacy mapping
  modal_app.py               Modal app: images, volumes, secrets
  jobs/                      (named 'jobs' not 'modal' — avoids shadowing the pip pkg)
    01_gemma_generate.py
    02_train_encoders.py
    03_export_publish.py
    04_eval.py
  local/
    harvest.py
    crosswalk_build.py
    expand.py
    package.py
  data/                      (gitignored) intermediate parquet/jsonl
  artifacts/                 (gitignored) trained weights, onnx
```

## Run order

```sh
# 0. one-time: python env + modal auth + HF token
pip install -r requirements.txt
modal token new
modal secret create huggingface HF_TOKEN=hf_xxx

# 1. validate the taxonomy (fast, local)
python -m taxonomy.taxonomy --validate

# 2. LAPTOP: harvest + crosswalk (overnight, free)
python local/harvest.py
python local/crosswalk_build.py

# 3. MODAL: Gemma generates templates/slang/aliases + verifies tail
modal run jobs/01_gemma_generate.py

# 4. LAPTOP: explode templates → millions of labeled rows (free)
python local/expand.py

# 5. MODAL: train both encoders, export ONNX, publish, eval
modal run jobs/02_train_encoders.py
modal run jobs/03_export_publish.py
modal run jobs/04_eval.py

# 6. LAPTOP: pull the bundle into the repo
python local/package.py
```

See each script's module docstring for details. Nothing here runs against
production data; the demo seed + public sources are the only inputs.

