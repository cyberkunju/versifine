# 11 · Reproducibility & Provenance

How to make the build deterministic, the artifact clean to ship, and the whole
program auditable.

## Reproducibility

### Seeds
Every randomized step seeds from `config.GLOBAL_SEED`:
- `expand.py` / `transliterate.py` / `augment.py` / `finalize_corpus.py` —
  sampling, shuffling, perturbation, eval/calib split.
- `mine_hard_negs.py` — any stochastic sampling of negatives.
- training — `random`, `numpy`, `torch`, `torch.cuda`, and `transformers.set_seed`
  all seeded; dataloader shuffle seeded. (GPU/cuDNN nondeterminism causes tiny
  drift — acceptable; the data + recipe reproduce, the score is within noise.)

### Determinism gotcha (already fixed in v1 tooling)
`sorted()` before any shuffle of a Python `set` (set iteration order is
hash-randomized per process). Verified: identical eval.parquet across runs.

### Pinned versions
`requirements.txt` pins every dep; Modal images pin their installs; model bases
pinned by repo id (+ revision SHA) in `config.py`.

### Recorded in the artifact
`manifest.json`: taxonomy version, teacher identity (Opus subagents), both
encoder bases, language matrix, retrieve_top_k, conformal threshold + coverage,
confidence floor, bundle version. A rebuild is verifiable against it.

### Re-run determinism
Same `teacher_packs.jsonl` + `harvest_pairs.parquet` → same train/eval/calib
(seeded) → equivalent model (within GPU noise). The Volume preserves
intermediates so you can re-enter at any phase. The teacher packs are a
**committed, frozen artifact** (LLM generation isn't bit-deterministic, so we
freeze the output, not regenerate each build).

## Provenance — what shaped the model

| Class | Sources | Ship rows? |
|---|---|---|
| Ship-clean (train + redistribute) | Wikidata (CC0), Foursquare OS Places (Apache-2.0), Overture (CDLA/Apache), OSM-NSI (BSD, attribution), repo merchant DB (ours), Opus subagent generations | Yes |
| Reference/eval only (DO NOT ship rows) | any restrictive-license HF transaction datasets, Banking77 (CC-BY, eval w/ attribution) | No |
| Standards (structure only) | MCC (ISO 18245), Plaid PFC (reference doc), GST HSN/SAC | No rows |

`DATA_PROVENANCE.md` carries the full table + per-source license + how-used.

## Licensing of the final artifact

- Bases MIT/Apache (e5-small MIT, mMiniLM Apache; v2: BGE-M3 MIT, MuRIL Apache)
  → derivatives ship freely.
- Training data = permissive/public-domain + Opus generations → clean.
- **Opus-generated data:** original generations, not copied from any dataset;
  usable to train other models. (No external LLM/translator involved.)
- Published with a model card stating intended use, training-data summary,
  India-first + 14-language scope, Maithili/Assamese as moderate-confidence,
  limitations, and attributions (Wikidata/OSM/Foursquare).

## Pre-publish compliance checklist

- [ ] No rows from "reference/eval only" sources in train.parquet.
- [ ] Wikidata/OSM/Foursquare attribution in the model card + DATA_PROVENANCE.
- [ ] manifest.json records bases + teacher + provenance + language matrix.
- [ ] No PII / no real Versifine user data in training (flywheel stores phrases,
      per-deployment, private).
- [ ] Model card: intended use + per-language limitations + attributions.
- [ ] HF repo license compatible with all base + data licenses.

## Auditability

Answer "why did it predict X?":
- `source` tier logged per categorization (override / merchant / model / context
  / low-confidence).
- Model tier: top-k candidates + scores loggable in debug.
- Example bank inspectable (which phrases pull which leaf).
- Per-language eval report documents known strengths/weak spots at ship time.

## Rebuild from scratch (disaster recovery)

With only this `masterplan/` folder + the scripts:
1. recreate env, Modal token, HF secret;
2. validate taxonomy + crosswalk;
3. run the v1 build (doc 06);
4. gate against doc 00 + doc 08;
5. publish + install (doc 09).
No hidden state required; the Volume is a cache, not a dependency. Taxonomy +
crosswalk + teacher packs + scripts + these docs are the whole truth.
