# 11 · Reproducibility & Provenance

How to make the build deterministic, the artifact clean to ship, and the whole
thing auditable. Cross-reference [DATA_PROVENANCE.md](../DATA_PROVENANCE.md) for
the full source/license table.

---

## Reproducibility (constraint N9)

### Seeds
Every randomized step is seeded:
- `expand.py`: `RNG = random.Random(20260529)` — all sampling, shuffling,
  perturbation, eval split.
- Training: set seeds in the trainer (`set_seed`), fix the dataloader shuffle
  seed. Note GPU nondeterminism (cuDNN) can cause tiny drift — acceptable; the
  data + recipe reproduce, the score is within noise.

### Pinned versions
- `requirements.txt` pins every Python dep.
- The Modal images pin their installs (vllm, torch, transformers, optimum, etc.)
  so the GPU environment is fixed.
- Model bases are pinned by repo id (+ optionally a revision SHA) in `config.py`.

### Recorded in the artifact
`manifest.json` records: taxonomy version, teacher repo, both encoder bases,
retrieve_top_k, conformal threshold + coverage, confidence floor, languages,
leaf list, legacy/kind maps. A rebuild can be verified against it.

### Re-run determinism
Same inputs (`harvest_pairs.parquet` + `gemma_templates.jsonl`) → same
`train/eval/example_bank` parquet (seeded). Same datasets → equivalent model
(within GPU noise). The Volume preserves intermediates so you can re-enter the
pipeline at any phase.

---

## Provenance (what shaped the model)

Tracked in `DATA_PROVENANCE.md`. Three classes:

1. **Ship-clean sources** (train + redistribute): Wikidata (CC0), Foursquare OS
   Places (Apache-2.0), Nigerian banking set (Apache-2.0), OSM-NSI (BSD,
   attribution), Overture (CDLA/Apache), the repo's own merchant DB, and Gemma's
   synthetic generations (Apache-2.0 outputs).
2. **Reference/eval only** (do NOT ship rows): the HF transaction datasets with
   unclear/restrictive licenses, Banking77 (CC-BY, eval w/ attribution). Used to
   tune the synthesis distribution and to measure — never copied into train.
3. **Standards** (structure only): MCC (ISO 18245), Plaid PFC (reference doc),
   GST HSN/SAC — inform the taxonomy/crosswalk; no rows shipped.

---

## Licensing of the final artifact

- Bases are MIT (e5-small, mDeBERTa) → derivatives ship freely.
- Training data is permissive/public-domain + synthesis → clean.
- Published to `CyberKunju/versifine-categorizer-v2` with a model card stating:
  intended use (personal-finance categorization), training data summary,
  India-first bias, limitations, and attributions (Wikidata/OSM/Foursquare).

---

## Pre-publish compliance checklist (must all pass)

- [ ] No rows from "reference/eval only" sources in `train.parquet`.
- [ ] Wikidata/OSM/Foursquare attribution in the HF model card + DATA_PROVENANCE.
- [ ] `manifest.json` records bases + teacher + provenance version.
- [ ] No PII / no real Versifine user data anywhere in training (P4).
- [ ] Model card: intended use + limitations + attributions present.
- [ ] License chosen for the HF repo (e.g. Apache-2.0) is compatible with all
      base + data licenses.

---

## Auditability

Anyone should be able to answer "why did the model predict X?":
- The **source tier** is logged per categorization (override / merchant / model
  / low-confidence).
- For the model tier, the **top-K candidates + scores** can be logged in debug.
- The **example bank** is inspectable (which phrases pull which leaf).
- The **eval report** + per-segment breakdown documents known strengths/weak
  spots at ship time.

---

## Disaster recovery / rebuild from scratch

With only this `docs/` folder + the scripts:
1. Recreate the env (`requirements.txt`), Modal token, HF secret.
2. Validate taxonomy + crosswalk.
3. Run the pipeline (doc 07 / RUNBOOK).
4. Gate against doc 01 + doc 08.
5. Publish + install (doc 09).

No hidden state is required; the Volume is a convenience cache, not a
dependency. The taxonomy + crosswalk + scripts + these docs are the whole truth.
