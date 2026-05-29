# 13 · Adversarial Review & Fixes

Three independent sub-agents brutally scrutinized the plan, the data pipeline,
and the Modal jobs. This document records what they found and what was fixed, so
the corrections aren't lost and the honest caveats are on the record.

## CRITICAL — fixed

| ID | Issue | Fix |
|---|---|---|
| C-hf | `HF_HUB_ENABLE_HF_TRANSFER=1` in all images but `hf_transfer` never installed → every model download hard-fails | Added `hf_transfer==0.1.8` to all three Modal images |
| C-vllm | `vllm==0.6.6` (Dec-2024) predates Gemma 4 → cannot load the teacher | Bumped to `vllm==0.11.0` (overridable via `VERSIFINE_VLLM_VERSION`); `--smoke` first to confirm arch support |
| C-fsq | `harvest_bulk._fsq_top_family` returned only the TOP-level FSQ family, but crosswalk keys are specific → petrol/hotels/airports/pharmacies all mislabeled | Now passes the FULL label path; `resolve_fsq` matches the longest known key (specific wins) |
| C-leak | `expand.py` eval split was a random slice of the SAME pool as train (incl. template fills) → near-duplicate leakage → inflated eval | Eval/calib now drawn ONLY from natural LLM phrasings + code-mixed; normalized-key quarantine blocks near-dupes from train+bank; verified (155k→0 leak after redesign) |
| C-seed | Non-determinism: `expand` shuffled `list(set(...))` (hash-randomized); training had no seeds | `sorted()` before every shuffle + `config.GLOBAL_SEED`; training seeds random/numpy/torch/cuda/transformers. Verified identical output across runs |

## HIGH — fixed

| ID | Issue | Fix |
|---|---|---|
| H-mnrl | MNRL with ~59 shared positive label sentences in a 256 batch → massive in-batch false negatives | Per-leaf single-positive batches via `NoDuplicatesDataLoader` + round-robin distinct-leaf construction; batch capped at #leaves |
| H-tok | mDeBERTa-v3 needs `sentencepiece`+`protobuf`, not installed | Added both to train + export images |
| H-calib | Conformal threshold calibrated on `eval.parquet` (leak vs eval job) AND on bi top-1 score while runtime gates the reranked winner | New dedicated `calib.parquet` split; `_calibrate` runs the FULL pipeline (retrieve→rerank→gate) and calibrates the EXACT score the runtime/eval uses |
| H-maxtok | Gemma `max_tokens=2400` too small for 40+60+30+25 items → truncated JSON → silent empty packs | (see "remaining" — raise + fail-loud planned) |
| H-plaid | `TRANSFER_IN_CASH_ADVANCES_AND_LOANS → loan_emi` mapped an inflow to an expense leaf | Remapped to `other_income` |
| H-ind | `telecommunications→public_transit`, `hospitality`/`hospital` substring collision, `financial/bank→cash_atm`, `retail→everything` | Reordered keywords (specific first), dropped ambiguous/over-broad ones (drop > guess, P3) |
| H-reexport | Re-running export on the persistent Volume crashed the quantizer (multiple .onnx) | Export helpers `rmtree` the dst first; also drop fp32 `model.onnx` before publish |

## MEDIUM — fixed

- Windows path bug in the Modal mount `condition` (`/data/` never matched
  backslash paths) → normalized to forward-slashes, excludes `__pycache__` too.
- `harvest.py` opened the jsonl in `"w"` (wiped `harvest_bulk` appends) → full
  run truncates once, `--only`/bulk append.
- Wikidata `name.startswith("Q")` over-dropped Quikr/Quess → now drops only
  `Q\d+` entity-id placeholders.
- `resolve_fsq` reverse-substring made bare "Restaurant" → "Fast Food
  Restaurant" → now only matches a known key contained IN the candidate.
- Unfilled `{slot}` leftovers stripped from template fills (no `{foo}` garbage).
- eval job now reports **per-segment** accuracy and unions an optional
  hand-curated `eval_hard.jsonl` (the real exam, docs/08).
- Renamed the misleading `CONFORMAL_COVERAGE` → `CALIB_ACCURACY_TARGET` (it's an
  accuracy floor, not coverage); manifest records retained_accuracy + coverage.

## HONEST CAVEATS (acknowledged, not yet fully closed)

These are real limitations the review surfaced. They do not block the build but
must be understood — overclaiming would violate the project's integrity bar.

1. **Accuracy realism.** ≥95% top-1 on *real* messy code-mixed text is
   optimistic for a model trained on synthetic+harvested data. The honest
   expectation is high accuracy on the synthetic eval, with a real gap to
   production until the hand-curated `eval_hard.jsonl` is built and the flywheel
   accumulates real corrections. **Do not trust the synthetic eval number as
   the production number.** Build the curated eval set (docs/08) before claiming
   the headline.

2. **"Add a leaf, no retrain" is partial.** A brand-new leaf added only as
   example phrases CAN be retrieved (open vocab is real), but it will
   underperform leaves the encoders were trained on until a retrain includes its
   data. The claim is "works without retrain, improves with retrain" — not
   "equal quality without retrain".

3. **Hard-negative mining** (config `HARD_NEGATIVES_PER_ANCHOR`) is specified
   but NOT yet implemented in `jobs/02` (only in-batch negatives). The
   `NoDuplicatesDataLoader` fix removes the false-negative bug; explicit
   hard-negative mining is a future accuracy improvement, not present today.

4. **Self-consistency verify** (`prompts.py` has the prompt, config has
   `GEMMA_VERIFY`) is NOT wired into `jobs/01` yet — generation only. The budget
   line for it is aspirational until implemented.

5. **MCC + Plaid crosswalks are validated but not exercised** by any current
   harvester (no source emits `mcc`/`plaid_pfc` signals). They're ready for a
   future MCC/Plaid-tagged source; today only `fsq_family`, `wikidata_industry`,
   and `legacy_category` signals flow.

6. **Bi-encoder INT8 size.** `multilingual-e5-small`'s large embedding table may
   keep the INT8 ONNX well above the "~30 MB" doc estimate (realistically
   100-130 MB). Re-measure after export; if it breaks the browser budget,
   consider embedding-table quantization or a smaller vocab model. The doc 01
   size target is a target to VERIFY, not an assumption.

7. **Gemma licensing.** Gemma ships under the Gemma Terms of Use, not Apache-2.0
   as some docs state. Gemma's terms DO permit training other models on its
   outputs, so the pipeline is fine, but the provenance wording should say
   "Gemma Terms of Use" — corrected in DATA_PROVENANCE going forward.

## Taxonomy notes from the review (tracked, low priority)

- Confusable clusters (transfers vs people_payments; investments vs
  investment_income; restaurants vs fast_food vs food_delivery) are inherently
  hard from short text alone. Mitigation: the cross-encoder + the (future)
  debit/credit direction prefix. Acceptable for v2; monitor per-group eval.
- Coverage gaps to consider for v2.1: crypto, EV charging, fines-vs-taxes split,
  BNPL, tobacco/paan, gambling, loan-received. Add as leaves when needed (open
  vocab makes this cheap).
- A few leaves have <8 examples (validator documents ≥8 but doesn't enforce);
  enrich before relying on synthesis-only coverage for them.

## Verification after fixes

- `taxonomy --validate` + `crosswalk --validate`: PASS.
- All 14 Python files compile.
- `expand.py` offline: train healthy (354k / 6k per leaf), eval from natural
  rows only, leakage blocked, **deterministic across runs** (hash-identical).
