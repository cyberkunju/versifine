# 07 · Training Pipeline

The exact, ordered build. Cross-reference [RUNBOOK.md](../RUNBOOK.md) for the
copy-paste commands; this document explains *what each step does and why*, so
you could re-implement it from scratch.

Environments: **LAPTOP** (free, CPU/network, overnight OK) and **MODAL** (paid
GPU, scale-to-zero). See doc 10 for cost.

---

## Step 0 — setup & validate (instant, free)

```sh
pip install -r requirements.txt
modal token new
modal secret create huggingface HF_TOKEN=hf_xxx      # gemma access + push rights
python -m taxonomy.taxonomy --validate
python -m taxonomy.crosswalk --validate
```
The validators are the gate: a bad label space fails here, not after spending
GPU. Both must print VALIDATION OK.

---

## Step 1 — harvest real merchants (LAPTOP, overnight, free)

```sh
python local/harvest.py
python local/harvest_bulk.py --source foursquare --country IN --limit 200000
python local/crosswalk_build.py
```
- `harvest.py`: Wikidata (CC0 SPARQL, India + a couple English markets for
  global brands Indians use), OSM Name Suggestion Index (brand→tag), the repo's
  427-entry merchant DB. Writes `harvest_raw.jsonl`.
- `harvest_bulk.py`: DuckDB streams the Foursquare OS Places parquet, filters
  `country='IN'`, pulls only name + category. Optional but adds 100k+ real POIs.
- `crosswalk_build.py`: resolves each row's signal → leaf (MCC/Plaid/FSQ/
  industry/legacy). **Drops** unresolved rows (never guesses). Writes
  `harvest_pairs.parquet` and prints per-leaf coverage + which leaves have no
  harvested merchants (synthesis will cover those).

**Why first:** real names anchor the model; harvesting is slow/network-bound, so
do it while you sleep, for free.

---

## Step 2 — Gemma generates building blocks (MODAL H200, ~1.5 h, ~$7.5)

```sh
modal run jobs/01_gemma_generate.py --smoke    # 3 leaves, sanity
modal run jobs/01_gemma_generate.py            # all leaves
modal volume get versifine-categorizer-vol gemma_templates.jsonl data/
```
- Serves `google/gemma-4-31B-it` FP8 via vLLM AsyncLLMEngine.
- For each leaf, builds the generation prompt (`prompts.py`) and fires all
  requests concurrently; prefix caching makes the shared system prompt nearly
  free to re-encode.
- Parses strict-JSON packs (templates, merchant_aliases, phrasings, code_mixed);
  forgiving parser strips stray fences.
- Writes `gemma_templates.jsonl` to the Volume; you pull it to the laptop.

**ALWAYS `--smoke` first** to catch a prompt/parse bug before burning GPU on 59
leaves.

---

## Step 3 — explode into the training set (LAPTOP, minutes, free)

```sh
python local/expand.py
modal volume put versifine-categorizer-vol data/train.parquet train.parquet
modal volume put versifine-categorizer-vol data/eval.parquet eval.parquet
modal volume put versifine-categorizer-vol data/example_bank.parquet example_bank.parquet
```
- Combinatorial explosion (doc 05): templates × merchants × amounts × noise +
  raw phrasings/code-mixed + UPI-wrapped harvested names + realism transforms.
- Per-leaf floor/ceiling balancing, dedup, seeded shuffle, eval split from
  natural rows.
- Writes `train.parquet`, `eval.parquet`, `example_bank.parquet`; push to Volume
  for training.

Proven offline: even with zero Gemma/harvest input, produces ~6k rows/leaf
(~350k total) from taxonomy examples alone — so the plumbing never blocks.

---

## Step 4 — train both encoders (MODAL A100-80GB, ~3 h, ~$8)

```sh
modal run jobs/02_train_encoders.py --smoke
modal run jobs/02_train_encoders.py
```
One function, one cold start, both stages:

**Stage A — bi-encoder (e5-small):**
- Build per-leaf label sentences (`"<name> (<group>): <examples>"`) — the
  `passage:` each leaf is retrieved by.
- `InputExample(query: text, passage: label_sentence)`.
- `MultipleNegativesRankingLoss` with large batch (every other row in the batch
  is a free negative) + AMP. e5 prefixes honoured.
- Epochs/lr/batch from config. Save to `biencoder/`.

**Stage B — cross-encoder (mDeBERTa-v3):**
- Embed all label sentences with the freshly-trained bi-encoder.
- For a subsample of training rows, retrieve top-K candidate leaves; make
  `[text, label_sentence]` pairs labelled 1 (true leaf) / 0 (others); always
  include the true leaf as a positive.
- Train binary `CrossEncoder` with AMP. Save to `crossencoder/`.

Also writes `label_sentences.json`. **`--smoke` first** (200 rows/leaf, 1 epoch)
to verify the loop end-to-end cheaply.

---

## Step 5 — export, quantize, calibrate, publish (MODAL L4, ~30 min, ~$1)

```sh
modal run jobs/03_export_publish.py
```
- Export both encoders to ONNX, **INT8 dynamic quant** (optimum + onnxruntime).
- Embed label sentences + example bank with the ONNX bi-encoder → store
  `label_embeddings.npy` so the API loads a ready vector index (no boot compute).
- **Conformal calibration:** on the eval split, find the cosine-sim threshold
  where retained top-1 predictions hit `CONFORMAL_COVERAGE` accuracy → the
  abstention gate. Writes `conformal.json`.
- Write `manifest.json` (labels, legacy map, kind map, thresholds, knobs).
- Push the whole `bundle/` to the HF repo + commit to the Volume.

---

## Step 6 — evaluate (MODAL L4, ~30 min, ~$0.5)

```sh
modal run jobs/04_eval.py
```
Runs the **exact runtime pipeline** (bi-encoder → top-K → cross-encoder rerank →
conformal gate) on the held-out eval set. Reports bi-encoder top-1/3/K recall,
reranked top-1 (headline), confident accuracy + coverage, and **per-group**
accuracy. Writes `eval_report.json`. Gate against doc 01 targets + per-segment
floors. If a segment fails → adjust data mix (doc 05) and re-run Steps 3-6.

---

## Step 7 — install into the repo (LAPTOP, free)

```sh
python local/package.py            # pull HF bundle → apps/api/src/ml/model-v2 + apps/web/static/models/v2
```
Then wire the runtime engine (doc 09).

---

## Iteration loops (cheap → expensive)

| Change | Re-run | Cost |
|---|---|---|
| Taxonomy/crosswalk edit | validate | $0 |
| Data-mix knob | expand → train → export → eval | ~$9.5 |
| Prompt change / new leaves | gemma → expand → train → export → eval | ~$17 |
| Threshold/calibration only | export → eval | ~$1.5 |

Always smoke-test Modal steps first. Everything seeded → reproducible.

---

## If you must train on the laptop instead of Modal

Possible but slow (8 GB GPU): bi-encoder with batch 32 + grad-accum, cross-encoder
batch 8 + grad-accum + fp16, overnight. Saves ~$8 but ties up the machine. The
Modal A100 path is recommended (still under $30 total).
