# Data Provenance & Licensing

Every input that shapes the v2 categorizer, where it comes from, its license,
and how we use it. The goal: the published model bundle is clean to ship
commercially. If a source's license is restrictive, we use it only as a *weak
signal during synthesis* or for *eval*, never redistribute its rows.

> Rule of thumb: **train freely on permissive/public-domain sources; treat
> restrictive sources as reference or eval only; never ship raw third-party
> rows in the artifact.**

---

## Taxonomy structure (label space)

| Source | What we take | License | How used |
|---|---|---|---|
| **ISO 18245 MCC** (via [greggles/mcc-codes](https://github.com/greggles/mcc-codes)) | ~1,000 merchant category codes → group ranges | Public standard / CC | `taxonomy/crosswalk.json` MCC ranges. Structure only, no rows shipped. |
| **Plaid Personal Finance Categories (PFCv2)** | hierarchy of ~104 detailed categories | Public reference doc | Mapping reference for `crosswalk.json` plaid keys. We do **not** call Plaid's API or ship their data. |
| **Foursquare category taxonomy** | venue category family names | Apache-2.0 | `crosswalk.json` fsq families. |
| **GST HSN/SAC (India)** | goods/services classification | Govt public | India localization of leaves (reference). |

The final taxonomy (`taxonomy/taxonomy.json`) is **our own** authored label
set, informed by the above. It is original and ships freely.

---

## Merchant / POI names (deterministic-label half of training data)

| Source | Scale | License | How used | Ship rows? |
|---|---|---|---|---|
| **Wikidata** (SPARQL `query.wikidata.org`) | 100k+ businesses + industry, multilingual | **CC0** (public domain) | `harvest.py` → merchant→leaf pairs | Yes (CC0) |
| **OSM Name Suggestion Index** ([osmlab/name-suggestion-index](https://github.com/osmlab/name-suggestion-index)) | global brands → OSM tags | BSD-3-Clause | `harvest.py` → brand→leaf pairs | Yes (attribution kept) |
| **Foursquare OS Places** ([HF `foursquare/fsq-os-places`](https://huggingface.co/datasets/foursquare/fsq-os-places), [ClickHouse mirror](https://clickhouse.com/docs/getting-started/example-datasets/foursquare-places)) | 100M+ POIs, name + category | **Apache-2.0** | `harvest_bulk.py` (DuckDB, filter country=IN) → name→leaf | Yes (Apache-2.0) |
| **Overture Maps Places** | 64M+ POIs | CDLA-Permissive / Apache-2.0 | optional bulk harvest (DuckDB GeoParquet) | Yes |
| **Versifine merchant DB** (`apps/api/src/data/merchants.json`) | 427 curated India entries | Ours | `harvest.py` seed, v1-category signal | Yes |

OSM/Overture derived **data** carries share-alike/attribution obligations on
the *data*; trained model weights are a transformation and are generally
unencumbered, but we keep attribution in this file and in the HF model card.

---

## Transaction corpora (realism + eval, used carefully)

| Source | Scale | License | How used | Ship rows? |
|---|---|---|---|---|
| `electricsheepafrica/nigerian-banking-retail-transactions` (HF) | 5M | **Apache-2.0** | emerging-market noise patterns (augment), eval | Yes |
| `DoDataThings/us-bank-transaction-categories-v2` (HF) | 16k | per-repo | the `[debit]/[credit]` direction trick (technique only), eval | No — eval/technique only |
| `mitulshah/global-financial-transaction-classifier` dataset (HF) | 4.5M | per-repo | distribution reference, eval | No — reference only |
| `nileshely/UPI-Transactions` (GitHub) | 2023 UPI | open | India UPI realism reference | No — reference only |
| `dataful.in` UPI by merchant category | aggregate | public | category priors (counts only) | N/A (no rows) |
| **Banking77** | 13k | CC-BY-4.0 | robustness eval only (intent, not category) | No |

When a corpus is "reference only," we use it to *tune the synthesis
distribution* (what amounts/merchants/noise look real) and to *measure* the
model — not to copy rows into the shipped training set.

---

## Synthetic data (the bulk of training rows)

| Source | License | How used |
|---|---|---|
| **Gemma 4 31B-it** (`google/gemma-4-31B-it`) | **Gemma Terms of Use** (not Apache-2.0) | Generates templates, merchant aliases, phrasings, code-mixed variants per leaf (`jobs/01_gemma_generate.py`). The laptop explodes these into rows (`local/expand.py`). |

The Gemma Terms of Use permit using model OUTPUTS to train other models, so the
synthetic rows are usable; they are original generations, not copied from any
dataset. (Note: an earlier draft mislabeled Gemma as Apache-2.0 — corrected
here. The bases we FINE-TUNE, e5-small and mDeBERTa, are MIT.)

---

## Models we fine-tune

| Base | License | Role |
|---|---|---|
| `intfloat/multilingual-e5-small` | MIT | bi-encoder (retrieval) |
| `microsoft/mdeberta-v3-base` | MIT | cross-encoder (rerank) |

Both MIT-licensed → the fine-tuned derivatives ship freely under our chosen
license on the HF repo `CyberKunju/versifine-categorizer-v2`.

---

## Compliance checklist (run before publishing)

- [ ] No raw rows from "reference only / No-ship" sources are in `train.parquet`.
- [ ] Wikidata/OSM/Foursquare attribution present in the HF model card.
- [ ] `manifest.json` records bases + teacher + this provenance version.
- [ ] Model card states: synthetic + permissive-source training; intended use
      = personal-finance categorization; limitations + India-first bias noted.

