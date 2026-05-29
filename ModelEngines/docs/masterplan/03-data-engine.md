# 03 · Data Engine

The most important document. Data quality + scale is the single biggest
determinant of accuracy, and **the entire data engine is FREE** (Opus subagents
+ laptop CPU/GPU). Six stages, each multiplying coverage, combining into a
~3M-row, 14-language, multi-script, noise-saturated, hard-negative-rich corpus.

```
 STAGE 1  Teacher concept packs (Opus subagents)        → per-leaf building blocks
 STAGE 2  Merchant harvest (Wikidata/FSQ/OSM/Overture)  → 100k+ real merchant→leaf pairs
 STAGE 3  Combinatorial expansion (laptop CPU)          → millions of labeled rows (English/concept)
 STAGE 4  Transliteration + native-script generation    → all 14 languages × scripts
 STAGE 5  Noise & code-mix augmentation (laptop CPU)    → wild-input realism
 STAGE 6  Hard-negative mining (laptop GPU)             → confusable pairs for contrastive training
                              ↓
                    train.parquet / eval.parquet / calib.parquet / example_bank.parquet
```

All seeded → reproducible. Eval/calib are split from **natural rows only**
(never template fills) to keep the score honest.

---

## STAGE 1 — Teacher concept packs (Opus subagents, $0)

**The teacher is Opus 4.8 subagents** — not Gemma, not a translator. Each
subagent reads `teacher/SPEC.md` (the strict contract) and, per leaf, emits a
JSON pack:

- `templates` (≥40) — skeletons with slots `{merchant} {amount} {noise} {date}`
- `merchant_aliases` (≥60) — realistic India-first vendor names for that leaf
- `phrasings` (≥30) — natural typed text with typos/abbreviations
- `code_mixed` (≥25) — Hinglish/Manglish/Tanglish/etc. in Latin script

**14-language scaling:** for v1's full corpus, subagents generate packs **per
(leaf, language)** for the natural-language fields (`phrasings`, `code_mixed`),
in native script AND Romanized. Templates + merchant aliases are largely
language-agnostic (merchants are proper nouns; templates are structural) so they
are generated once and reused across languages, with language-specific
phrasings/code-mixed layered on top.

**Batching strategy:** spawn subagents in waves grouped by taxonomy group ×
language tier (e.g. "Food & Drink leaves, Tamil native + Romanized"). Each
writes `teacher/packs/<group>_<lang>.jsonl`. `teacher/merge.py` merges + validates
coverage (every (leaf,lang) present, counts sufficient) → `teacher_packs.jsonl`.

**Why subagents beat a translator for the 14:** Opus produces *idiomatic,
merchant-correct, India-real* text, not translationese. For the 12
high-confidence languages it's strictly better. For Assamese/Maithili it's
moderate → bolstered by Stage 4 transliteration from siblings.

**Quality gate (non-negotiable):** everything in a pack must clearly belong to
its leaf. Mislabeled diversity poisons training. SPEC carries per-cluster
disambiguation hints (doc 02). `merge.py` enforces counts + slot legality + dedup.

---

## STAGE 2 — Merchant harvest (laptop, $0)

Real merchant/brand/POI names mapped to leaves through the crosswalk —
deterministic, **drop-if-unresolved, never guessed**.

| Source | License | Scale | Signal → leaf |
|---|---|---|---|
| Wikidata (SPARQL) | CC0 | 100k+ | industry → fsq family → leaf |
| Foursquare OS Places (DuckDB over HF/ClickHouse parquet) | Apache-2.0 | 100M+ (filter IN) | fsq category family → leaf |
| Overture Places (DuckDB GeoParquet) | CDLA/Apache | 64M+ | category → fsq family |
| OSM Name Suggestion Index | BSD | 10k+ brands | OSM tag → fsq family |
| Versifine merchant DB | ours | 427 | v1 category → leaf |

Implemented in `local/harvest.py` (light sources) + `local/harvest_bulk.py`
(DuckDB pushes column/row filters so 16 GB RAM suffices; India-filtered).
Labeled by `local/crosswalk_build.py`. This is the **merchant-breadth** axis
(real names the model must nail: Apollo Pharmacy → pharmacy, Indigo → flights).

**Multilingual merchant names:** harvest Wikidata labels in all 14 languages
where available (Wikidata is multilingual), so "अपोलो फार्मेसी" and "Apollo
Pharmacy" both map to pharmacy.

---

## STAGE 3 — Combinatorial expansion (laptop CPU, $0)

`local/expand.py` explodes Stage-1 templates × Stage-2 merchants × amount
formats × noise tokens × dates into millions of labeled rows. The **template
trick**: a few thousand LLM building blocks → millions of rows for free (no
extra LLM tokens). Realism transforms applied here:
- amount formats: ₹450, Rs.450, 450/-, 1.5k, 2 lakh, ৪৫০ (native digits!), etc.
- UPI/POS wrapping: `UPI/{slug}/{ref}@{handle}/{CITY}`, `POS {ref} {name} {CITY}`
- per-domain plausible amount ranges (rent in thousands, chai in tens)
- native-digit variants per script (Bengali ০-৯, Devanagari ०-९, Tamil ௦-௯…)

Per-leaf floor/ceiling balancing, dedup (normalized key), seeded shuffle.

---

## STAGE 4 — Transliteration + native-script (laptop, $0) — the multiplier

This is how 14 languages scale without a translator:
1. **Opus native-script phrasings** (Stage 1) seed each language directly.
2. **Deterministic transliteration** (`indic-transliteration` / Aksharamukha)
   converts:
   - native script → Latin (Romanized typing: "செலவு" → "selavu")
   - Latin → native script (when Opus authored Romanized)
   - cross-script where useful
3. Result: every concept exists in **native script + Romanized** for each
   language, matching how Indians actually type.

For Assamese/Maithili (moderate Opus), transliteration from the sibling script
(Bengali/Devanagari) provides extra coverage that Opus alone wouldn't verify.

**Caveat:** transliteration is lossy/approximate for some scripts; it's an
augmentation layer, not ground truth. The Opus native rows are the anchor; the
hard eval set (doc 08) uses *real* strings to keep the score honest.

---

## STAGE 5 — Noise & code-mix augmentation (laptop CPU, multiprocessing, $0)

Turns clean rows into wild-input rows by construction. Per language/script:
- **Keyboard-adjacency typos in that script** (script-aware, not just QWERTY)
- **UPI/POS mangling** (handles, refs, city codes, bank prefixes)
- **OCR-style errors** (for receipt-origin text)
- **casing/spacing chaos** (lowercase, UPPERCASE, dropped spaces, glued words)
- **abbreviation injection** (common short forms)
- **code-switching** (English ↔ local mid-sentence: "movie tickets ku 600
  spend pannitten")
Runs across the laptop's 8 cores via `multiprocessing`.

---

## STAGE 6 — Hard-negative mining (laptop GPU, $0)

The unconventional cost-saver: the RTX 4060 embeds the whole ~3M-row corpus with
e5-small in minutes, then for each anchor finds the **most confusable wrong-leaf
rows** (high cosine, wrong label) — the hard negatives that sharpen contrastive
training (the difference between "good" and "exceptional" on confusable
clusters). Normally a GPU cost; here it's free on your laptop. Output: a
hard-negative index consumed by training (doc 06).

---

## Balancing, dedup, splits

- **Per-leaf × per-language floor/ceiling** so no (leaf,lang) cell is starved or
  dominant.
- **Dedup** on a normalized key (lowercase, strip noise/digits) to kill near-
  duplicates.
- **Eval + calib drawn ONLY from natural rows** (Opus phrasings/code-mixed +
  harvested real names) — never template fills — and **quarantined** (their
  normalized keys removed from train + bank) so there is **zero leakage**. This
  is what makes the eval number trustworthy.
- All seeded (`config.GLOBAL_SEED`) → reproducible.

## Data-mix knobs (config.py)

`TARGET_TRAIN_ROWS`, `MIN_ROWS_PER_LEAF`/`MAX_ROWS_PER_LEAF`,
`TEMPLATES_PER_LEAF`, `MERCHANT_ALIASES_PER_LEAF`, per-language volume weights,
`HARD_NEGATIVES_PER_ANCHOR`, `CALIB_FRACTION`. Tuning the mix + re-running
expand is free; only retraining costs (~$4).

## Target scale (v1)

14 languages × 59 leaves × {native + Latin} × noise + 100k harvested merchants
→ **~3M balanced rows**. For a 118M model this is abundant (more → diminishing
returns). All free.

## Failure modes & mitigations

| Risk | Mitigation |
|---|---|
| Synthesis too repetitive | hard negatives + real harvested names + high-temp generation + real eval set |
| Transliteration errors | augmentation only; Opus native rows are anchor; real eval catches drift |
| Assamese/Maithili weakness | sibling transliteration + extra eval + flywheel + flagged in model card |
| Mislabeled crosswalk | most-specific-wins + drop-if-unresolved + validator |
| Class/language imbalance | per-(leaf,lang) floor/ceiling enforced at expansion |
| Eval inflation | natural-only split + normalized-key quarantine (zero leakage) |
