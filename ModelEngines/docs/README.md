# Versifine Categorizer v2 — Complete Documentation

This folder is the **single, self-contained specification** for building the
Versifine transaction-categorization model. If you have only this folder and
no other context, you can build the whole system to extreme accuracy.

Read in order. Each document is standalone but they build on each other.

| # | Document | What it covers |
|---|---|---|
| 00 | [Overview & Vision](00-overview.md) | The problem, the idea, what we are achieving and why |
| 01 | [Goals & Success Criteria](01-goals-and-success-criteria.md) | Concrete targets, metrics, definition of done |
| 02 | [Constraints & Non-Negotiables](02-constraints-and-non-negotiables.md) | The extreme requirements that CANNOT be compromised |
| 03 | [Architecture](03-architecture.md) | Runtime + training architecture, every design decision |
| 04 | [Taxonomy](04-taxonomy.md) | The label space, hierarchy, India-first design, how to extend |
| 05 | [Data Strategy](05-data-strategy.md) | Every data source, harvest, synthesis, the template trick |
| 06 | [Models](06-models.md) | Exact model choices, versions, rationale |
| 07 | [Training Pipeline](07-training-pipeline.md) | Step-by-step build, laptop/Modal split |
| 08 | [Evaluation](08-evaluation.md) | Eval methodology, metrics, the hard eval set |
| 09 | [Runtime Integration](09-runtime-integration.md) | How the API/web consume it, the flywheel |
| 10 | [Cost & Compute](10-cost-and-compute.md) | Budget, GPU selection, Modal specifics |
| 11 | [Reproducibility & Provenance](11-reproducibility-and-provenance.md) | Licensing, determinism, compliance |
| 12 | [Glossary & References](12-glossary-and-references.md) | Terms + all research sources |
| 13 | [Adversarial Review & Fixes](13-review-and-fixes.md) | What 3 review agents found, what was fixed, honest caveats |

## The one-paragraph summary

We are building an **open-vocabulary, retrieval-based** transaction categorizer
for an India-first personal-finance app. Instead of a closed N-class classifier
(the v1 mistake — it could only emit a fixed set and its ML tier never even
shipped), v2 uses a **fine-tuned multilingual bi-encoder** to retrieve candidate
categories and a **fine-tuned cross-encoder** to rerank them, gated by
**conformal prediction**. A single open LLM (**Gemma 4 31B-it**) is used only to
*generate training diversity* — it is distilled into the small encoders and is
**never in the runtime loop**. The label set is **data, not weights**, so adding
a category never requires retraining. Every user correction feeds back into the
example bank (the **flywheel**), so accuracy compounds. Target: **≥95% top-1 on
messy code-mixed Indian transaction text**, fully local/offline at runtime,
built for **under $30** total compute.

## Status & provenance

- Foundation (taxonomy, crosswalk, all scripts) is built and validated offline.
- See [RUNBOOK.md](../RUNBOOK.md) for the exact build commands.
- See [DATA_PROVENANCE.md](../DATA_PROVENANCE.md) for the license manifest.
- Authoring date context: 2026. Model versions named here are the current
  releases as of writing (see doc 06 for exact repo IDs).
