# 06 · v1 Build — Step by Step

The exact, ordered build for the v1 small model. Every step says what runs
where, what it does, and the command. Environments: **LAPTOP** (free) and
**MODAL** (paid GPU, scale-to-zero). Total ≈ $9 one build, ≤ $30 with iteration.

> Golden rule: `--smoke` every Modal step first (costs cents), then full.

---

## Step 0 — Setup & validate (instant, free)

```sh
cd ModelEngines
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
modal token new
modal secret create huggingface HF_TOKEN=hf_xxx          # push rights to the HF repo
python -m taxonomy.taxonomy --validate                    # must pass
python -m taxonomy.crosswalk --validate                   # must pass
```

---

## Step 1 — Teacher data, 14 languages (subagents, $0)

Spawn subagents in waves (group × language tier) to fill
`teacher/packs/<group>_<lang>.jsonl` per `teacher/SPEC.md`. Then:
```sh
python teacher/merge.py --check     # validate (leaf,lang) coverage + counts
python teacher/merge.py             # → teacher/teacher_packs.jsonl
```
`config.TEACHER_PACKS` points expand.py at this file.

**What it does:** produces the per-(leaf,language) building blocks (templates,
merchant aliases, native + Romanized phrasings, code-mixed). The semantic core.

---

## Step 2 — Harvest real merchants (laptop, overnight, free)

```sh
python local/harvest.py                                       # Wikidata + OSM-NSI + repo DB
python local/harvest_bulk.py --source foursquare --country IN --limit 300000
python local/crosswalk_build.py                               # → harvest_pairs.parquet
```
**What it does:** 100k+ real merchant names, deterministically labeled, multi-
lingual where Wikidata provides labels. The merchant-breadth axis.

---

## Step 3 — Expand + transliterate + augment (laptop, $0)

```sh
python local/expand.py            # templates × merchants × amounts × noise → concept rows
python local/transliterate.py     # native↔Latin for all 14 langs (indic-transliteration)
python local/augment.py           # typos/UPI-mangle/code-switch, multiprocessing on 8 cores
```
**What it does:** explodes to millions of rows, multiplies across 14 languages
and both script forms, injects wild-input noise. Writes interim corpus.

---

## Step 4 — Mine hard negatives (laptop GPU, free)

```sh
python local/mine_hard_negs.py    # 4060 embeds corpus w/ e5-small, finds confusable pairs
```
**What it does:** the confusable wrong-leaf pairs that make contrastive training
sharp. Normally a GPU cost — free on your laptop. → `hard_negs.parquet`.

Then finalize splits (natural-only eval/calib + leakage quarantine):
```sh
python local/finalize_corpus.py   # → train/eval/calib/example_bank.parquet
```

---

## Step 5 — Push datasets to Modal Volume

```sh
modal volume put versifine-cat-vol data/train.parquet train.parquet
modal volume put versifine-cat-vol data/eval.parquet eval.parquet
modal volume put versifine-cat-vol data/calib.parquet calib.parquet
modal volume put versifine-cat-vol data/example_bank.parquet example_bank.parquet
modal volume put versifine-cat-vol data/hard_negs.parquet hard_negs.parquet
```

---

## Step 6 — Train both encoders (MODAL A100, ~2.5h, ~$6.5)

```sh
modal run jobs/train.py --smoke     # tiny, verifies the loop end-to-end
modal run jobs/train.py             # bi-encoder (contrastive + hard-negs) then cross-encoder
```
One warm container, both stages, one cold start. bf16 + big batch + (optional)
torch.compile.

---

## Step 7 — Export, quantize, calibrate, publish (MODAL L4, ~0.5h, ~$0.5)

```sh
modal run jobs/export.py            # ONNX + INT8 + embed bank + conformal calib + HF push
```

---

## Step 8 — Evaluate per language (MODAL L4, ~0.5h, ~$0.5)

```sh
modal run jobs/eval.py              # per-language + per-group retrieve→rerank→gate report
```
Gate against doc 08 floors. If a language fails → bump its data weight (Step 1/3),
re-run 3→8. Iteration cost ~$7.

---

## Step 9 — Install into the repo (laptop, free)

```sh
python local/package.py             # pull HF bundle → apps/api/src/ml/cat-v1 + apps/web/static/models/cat-v1
```
Then wire the runtime cascade (doc 09).

---

## Step 10 — (Optional) Browser Privacy-Mode student

The v1 e5-small IS browser-viable, so `package.py` already places an
ONNX-Runtime-Web build in `apps/web/static/models/cat-v1`. Wire the in-browser
engine (doc 09) when ready; it can follow the server launch.

---

## Iteration loops (cheap → expensive)

| Change | Re-run | Cost |
|---|---|---|
| Taxonomy/crosswalk edit | validate | $0 |
| Data-mix / language weight | expand→...→eval | ~$7 |
| New teacher data (subagents) | merge→expand→...→eval | ~$7 |
| Threshold-only recalibration | export→eval | ~$1 |

Always smoke-test Modal steps. Everything seeded → reproducible.

---

## Scripts to build (status)

| Script | Status | Notes |
|---|---|---|
| taxonomy/*, crosswalk/* | ✅ done | validated |
| teacher/SPEC, merge.py | ✅ done | extend SPEC for 14 langs |
| local/harvest.py, harvest_bulk.py, crosswalk_build.py | ✅ done | |
| local/expand.py | ✅ done | add native-digit + per-lang weighting |
| local/transliterate.py | ⬜ to build | indic-transliteration wrapper |
| local/augment.py | ⬜ to build | script-aware noise + code-switch |
| local/mine_hard_negs.py | ⬜ to build | laptop-GPU e5-small embedding + kNN |
| local/finalize_corpus.py | ⬜ to build | natural-only split + quarantine (extract from expand) |
| jobs/train.py | ⬜ to build | e5-small + mMiniLM, one fn |
| jobs/export.py | ⬜ to build | ONNX/INT8/calib/publish |
| jobs/eval.py | ⬜ to build | per-language report |
| local/package.py | ✅ done | point at cat-v1 paths |
