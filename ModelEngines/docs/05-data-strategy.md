# 05 · Data Strategy

Data quality is the single biggest determinant of accuracy. This is the most
important document. The strategy has three streams that combine into the
training set: **deterministic merchant pairs** (real names, exact labels),
**LLM-generated diversity** (messy text realism), and **realism transforms**
(the wild-input simulation). A hard eval set is held out from natural rows.

---

## The core insight: the template trick

Naively asking an LLM to produce millions of labeled rows is slow and costly.
Instead, the LLM (Gemma 4 31B-it) produces, **per leaf**, a compact pack of
high-diversity *building blocks*; the laptop then **explodes** them
combinatorially into millions of rows for free.

Per leaf, Gemma emits:
- **templates** — skeletons with `{merchant} {amount} {noise} {date}` slots
- **merchant_aliases** — realistic vendor names for that leaf (India-first)
- **phrasings** — short ways a user types it, with typos/abbreviations
- **code_mixed** — Hinglish/Manglish/Tanglish/Tenglish/Kanglish variants

The laptop cross-products templates × merchants × amounts × noise × dates, plus
includes the raw phrasings/code-mixed lines, plus harvested real merchants
wrapped in UPI/POS noise. One leaf yields tens of thousands of rows from a few
hundred LLM tokens. This collapses LLM cost ~10× (≈5-8M tokens total).

---

## Stream 1 — deterministic merchant pairs (real names, exact labels)

Real merchant/brand/POI names mapped to leaves through the crosswalk. **No LLM,
no guessing** — if a name's signal doesn't resolve, the row is dropped.

| Source | License | Signal → leaf via | Scale |
|---|---|---|---|
| **Wikidata** (SPARQL, CC0) | CC0 | industry label → fsq family → leaf | 100k+ |
| **OSM Name Suggestion Index** | BSD-3 | OSM shop/amenity tag → fsq family | 10k+ brands |
| **Foursquare OS Places** (DuckDB) | Apache-2.0 | fsq category family → leaf | 100M+ (filter IN) |
| **Overture Places** (DuckDB) | CDLA/Apache | category → fsq family | 64M+ |
| **Versifine merchant DB** | ours | v1 category → leaf | 427 (India seed) |

Harvest is network/CPU-bound → free on the laptop, overnight. Implemented in
`local/harvest.py` (light sources) + `local/harvest_bulk.py` (DuckDB over the
big remote parquet, India-filtered, columns/rows pushed down so 16 GB RAM
suffices). Labels assigned by `local/crosswalk_build.py`.

This stream gives the model **real, correctly-labeled merchant names** — the
"named merchant" half it must nail (Apollo Pharmacy → pharmacy, Indigo →
flights, Cult.fit → fitness).

---

## Stream 2 — LLM-generated diversity (messy realism)

What real datasets lack: messy, code-mixed, typo-ridden, UPI-noisy text. Only an
LLM can generate this at scale across 6 languages. Gemma's packs (above) provide
it. The teacher prompt (`prompts.py`) explicitly demands:

- UPI/POS noise patterns (`UPI/swiggy/8821@ybl/MUMBAI`, `POS 4521 BLR`)
- abbreviations, missing spaces, casing chaos, typos (`grosery`, `pertol`)
- Indian merchants, slang (`kirana`, `sabzi`, `auto`, `chai`, `tapri`)
- code-mixing in Latin script across all 6 languages
- multiple amount formats (`₹450`, `Rs.450`, `450/-`, `1.5k`, `2 lakh`)

### Self-consistency verify (the hard tail)
For ambiguous rows (where the bi-encoder later disagrees with the deterministic
label), Gemma is sampled a few times and majority-votes a label, gated by
logprob; the merchant-DB exact match is the tiebreaker. This is the
single-model substitute for multi-model consensus (constraint N8). It cleans the
small fraction of genuinely ambiguous data rather than relabeling everything.

---

## Stream 3 — realism transforms (laptop, free)

`local/expand.py` applies wild-input simulation when exploding templates:

- **Amount formats:** `₹450`, `Rs.450`, `Rs 450`, `INR 450`, `450/-`, `450`,
  `450.00`, with per-domain plausible ranges (rent in thousands, chai in tens).
- **UPI/POS wrapping:** `UPI/{slug}/{ref}@{handle}/{CITY}`, `POS {ref} {name}
  {CITY}`, etc.
- **Noise tokens:** UPI, POS, NEFT, IMPS, ATM, AutoPay, @ybl, MUMBAI, ref#…
- **Typo/casing/spacing perturbations:** char-swap, lowercase, UPPERCASE, drop a
  space — applied probabilistically.
- **Date tokens:** today, yesterday, on 01/06, last monday, 2 days ago.

All seeded (`RNG = random.Random(20260529)`) → reproducible.

---

## Balancing & dedup

- **Per-leaf floor/ceiling** (`MIN_ROWS_PER_LEAF` / `MAX_ROWS_PER_LEAF` in
  config) so rare leaves aren't starved and common ones don't dominate.
- **Dedup** within a leaf (set-based) so the explosion doesn't just repeat.
- **Shuffle** with the seed for reproducibility.
- Target ~1.5M train rows total (config `TARGET_TRAIN_ROWS`), tuned to fit the
  laptop's RAM/disk and a single-GPU training run.

---

## The hard eval set (held out)

Eval rows are split from the **most natural** synthesized rows (phrasings +
code-mixed) plus a slice of harvested real names — NOT random template fills, so
eval measures real understanding, not template memorization. Target ~4k rows,
hand-checkable. See doc 08 for how to harden it further (the eval set is where
"is the score honest?" is decided).

---

## Data-mix knobs (config.py)

| Knob | Meaning |
|---|---|
| `TARGET_TRAIN_ROWS` / `TARGET_EVAL_ROWS` | dataset sizes |
| `MIN_ROWS_PER_LEAF` / `MAX_ROWS_PER_LEAF` | per-class balance |
| `TEMPLATES_PER_LEAF` / `MERCHANT_ALIASES_PER_LEAF` / `NOISE_TOKENS_PER_LANG` | Gemma pack sizes |
| `LANGUAGES` / `CODE_MIXED` | language coverage |
| `HARD_NEGATIVES_PER_ANCHOR` | contrastive difficulty |

Tuning the mix and re-running `expand.py` is free; only re-training costs (~$8).

---

## What real datasets we DON'T train on (and why)

Per DATA_PROVENANCE.md, some HF transaction datasets have unclear/restrictive
licenses. We use those for **eval and as distribution references** (what real
amounts/merchants/noise look like) — never copy their rows into `train.parquet`.
The `[debit]/[credit]` direction-prefix idea (from DoDataThings) is a *technique*
we adopt, not data we copy.

---

## Failure modes & mitigations

| Risk | Mitigation |
|---|---|
| Synthesis too repetitive | hard negatives + real harvested names + high temperature + a real eval set |
| Leaf with no harvested merchants | synthesis covers it from taxonomy `examples` (proven: ~6k rows/leaf with zero harvest) |
| Crosswalk mislabels a merchant | most-specific-wins MCC + drop-if-unresolved + validator |
| Language imbalance | per-segment eval floors block ship; bump that language's pack size |
| Class imbalance | per-leaf floor/ceiling enforced at expansion |
