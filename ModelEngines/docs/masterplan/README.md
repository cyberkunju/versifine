# Versifine Categorizer — Master Plan (v1 + v2)

This folder is the **complete, self-contained build specification** for the
Versifine transaction-categorization model program. If you have only this
folder, you can build both:

- **v1 (ship now)** — a small, browser-viable, 14-language model trained on
  maximum free data, for **under $30**.
- **v2 (future)** — the full-power 14-language model (BGE-M3 + reranker +
  active learning) with the same data foundation.

Nothing built for v1 is throwaway — v2 reuses the same taxonomy, teacher data,
harvest, transliteration, noise engine, and eval harness. v2 only swaps the
student model and adds loops.

## Read in order

| # | Document | What it covers |
|---|---|---|
| 00 | [Master Overview & Vision](00-master-overview.md) | The problem, the two-phase strategy, the honest accuracy ceiling, success criteria |
| 01 | [Languages & Scripts](01-languages-and-scripts.md) | The 14 languages, their scripts, Opus confidence tiers, why these 14 |
| 02 | [Taxonomy](02-taxonomy.md) | The 59-leaf label space, hierarchy, extension rules |
| 03 | [Data Engine](03-data-engine.md) | Teacher generation, harvest, transliteration, noise, balancing — the whole free data pipeline |
| 04 | [Models](04-models.md) | Exact model choices for v1 and v2, full research-backed rationale |
| 05 | [Architecture (runtime + training)](05-architecture.md) | The cascade, retrieve→rerank→gate, flywheel, both phases |
| 06 | [v1 Build — Step by Step](06-v1-build-stepbystep.md) | The exact commands + what each does, laptop/Modal split |
| 07 | [Efficiency, Concurrency & Cost](07-efficiency-and-cost.md) | Every efficiency lever, the <$30 math, Modal/laptop parallelism |
| 08 | [Evaluation](08-evaluation.md) | Per-language gates, the honest hard eval set, metrics |
| 09 | [Runtime Integration](09-runtime-integration.md) | API server + in-browser Privacy Mode, the flywheel wiring |
| 10 | [v2 Roadmap — The Full Model](10-v2-roadmap.md) | The future full-power build, what changes, what's reused |
| 11 | [Reproducibility & Provenance](11-reproducibility-and-provenance.md) | Seeds, licensing, determinism, compliance |
| 12 | [Glossary & References](12-glossary-and-references.md) | Terms + every research source cited |

## One-paragraph summary

We build an **open-vocabulary, retrieval-based** transaction categorizer for
14 Indian languages (+ English), covering 59 fine-grained categories. The
**teacher is Opus 4.8 subagents** (no external LLM, no translator) which
generate massive, realistic, multilingual training data for **$0**; the
**laptop** harvests 100k+ real merchant names, transliterates across scripts,
and injects real-world noise — also **$0**. That data fine-tunes a **small
`multilingual-e5-small` bi-encoder + a small multilingual cross-encoder**
(v1, browser-viable, ~$9–25 on Modal). At runtime a cascade — overrides →
merchant DB → bi-encoder retrieve → cross-encoder rerank → conformal gate —
categorizes any message in any of the 14 languages, and a **flywheel** folds
user corrections back in so accuracy compounds. **v2** later swaps in
BGE-M3 + a stronger reranker + active-learning for maximum accuracy, reusing
the entire v1 data foundation.

## The honest accuracy stance (read this)

The goal is *as close to perfect as physically possible*. True 100% is
information-theoretically impossible because some inputs are ambiguous even to
a human ("Reliance" = groceries? electronics? mobile?). The real target:
**be right whenever the text is decidable, and resolve genuine ambiguity from
the user's own context (history/flywheel) or one micro-question — never a
blind guess.** Realistic confident-accuracy: **~96–99% across the 14
languages**, climbing over time. See doc 00 and doc 08.

## Status at time of writing

- Taxonomy (59 leaves) + crosswalk: built, validated.
- Teacher packs: 12 batches generated (6-language seed), pipeline proven.
- This master plan supersedes the earlier `docs/00-13` (which describe the
  original Gemma/6-language plan); those remain for history.
