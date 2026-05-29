# 00 · Master Overview & Vision

## The problem (why this exists)

Versifine is an India-first personal-finance app whose core promise is
**frictionless capture**: a user types/speaks "chai 30", forwards a UPI SMS, or
snaps a receipt, and the expense is logged, categorized, and folded into
budgets, forecasts, and the AI copilot. **Categorization is the spine** — a
wrong or missing category corrupts everything downstream and destroys trust.

The input is uniquely hostile:
- **Messy:** `UPI/swiggy/8821@ybl/MUMBAI`, `POS 4521 BLR`, `pertol 500`, ALL
  CAPS, no spaces, typos, merchant IDs, reference numbers, amount clutter.
- **Multilingual + code-mixed:** 14 languages across ~11 scripts, plus Latin
  transliteration (Romanized) and mid-sentence code-switching
  (`sapadu ku 180 spend panninen`, `groceries ke liye paise`).
- **Long-tail merchants:** tens of thousands of brands + countless local
  kiranas that no static list will ever contain.

## Why v1 failed (the original Versifine categorizer)

A closed 23-class classifier whose ML tier **never shipped** (no ONNX artifact),
so production had **no semantic understanding** — anything not in a 427-entry
merchant list fell to `Other`. And being closed-vocabulary, huge swaths of real
spending (loans/EMI, investments, salon, gym, pets, gifts, fees, taxes) had no
home. We rebuild from scratch.

## The vision

A categorizer that:
1. **Understands any phrasing in any of 14 languages**, however messy or
   code-mixed.
2. **Never structurally misses a category** — open vocabulary; adding a
   category is data, not a retrain.
3. **Runs locally** — server-side by default (fast, free, private since the app
   is already server-connected), and optionally **fully in-browser** for a
   Privacy Mode where raw text never leaves the device.
4. **Improves forever** — every user correction feeds a flywheel; hard cases
   become known cases with zero retraining.

## The two-phase strategy

| | v1 (ship now) | v2 (future) |
|---|---|---|
| Goal | Excellent, browser-viable, cheap | Maximum accuracy |
| Bi-encoder | `multilingual-e5-small` (118M) | BGE-M3 (568M) |
| Cross-encoder | mMiniLM-L12 (118M) | BGE-reranker / MuRIL-large |
| Browser? | Yes (e5-small ~30MB INT8) | Server-first; distill small for browser |
| Active learning | optional | yes, multi-loop |
| Cost | **<$30** | ~$100 |
| Data | the full free corpus (shared) | **same corpus** + targeted active-learning data |

**Critical:** v1 and v2 share the taxonomy, teacher data, harvest,
transliteration, noise engine, eval harness, and runtime cascade. v2 is a model
swap + loops, not a rebuild. Building v1 well *is* building v2's foundation.

## The four ideas that make it work

1. **Open vocabulary via retrieval.** Embed the transaction, retrieve the
   nearest category from an example bank. Label set = data → add a category by
   adding examples, no retrain. This is what makes "nothing missed" structurally
   true.
2. **Retrieve → rerank.** A bi-encoder fetches top-k candidates fast; a
   cross-encoder reranks them with full cross-attention for precision on hard,
   ambiguous pairs. The modern SOTA stack.
3. **Distill the teacher; never serve it.** Opus 4.8 subagents generate the
   training data once; the small encoders learn it. At runtime there is **no
   LLM call** — two tiny ONNX models, fast, free, offline.
4. **The flywheel.** Corrections + hard-case decisions re-embed into the example
   bank. Accuracy compounds; the longer it runs the better it gets.

## The honest accuracy ceiling (must understand)

"1000% / never wrong" is the *spirit*, but literal 100% is impossible — not a
tooling limit, an information-theory limit. The same string is a *different*
category for different users:
- "Reliance" → Reliance Fresh (groceries)? Digital (electronics)? Jio (mobile)?
  Trends (clothing)?
- "paid Sharma 5000" → rent? loan repaid? a friend? staff salary?

So the correct target is:
**Be right whenever the text is decidable; resolve genuine ambiguity from the
user's own context (history / flywheel) or ONE micro-question — never a blind
guess; never a confident wrong answer.**

This is exactly how real banks hit their numbers. With this framing the goal is
fully achievable.

## Success criteria (measurable)

Measured on the **hard, hand-checkable eval set** (doc 08), per language:

| Metric | v1 Must (ship) | v1 Target | v2 Target |
|---|---|---|---|
| Reranked top-1 (decidable inputs) | ≥ 90% | ≥ 94% | ≥ 97% |
| Bi-encoder top-5 recall | ≥ 97% | ≥ 99% | ≥ 99.5% |
| Confident accuracy (post gate) | ≥ 95% | ≥ 97% | ≥ 99% |
| Coverage at confident accuracy | ≥ 80% | ≥ 88% | ≥ 92% |
| Per-language floor (each of 14) | ≥ 88% | ≥ 92% | ≥ 95% |

Ship is **blocked** if any single language is below its floor (doc 08). Maithili
and Assamese are flagged "moderate Opus confidence" → extra eval, slightly lower
interim floor allowed, tracked explicitly.

## Definition of Done (v1)

- [ ] Taxonomy + crosswalk validate.
- [ ] Teacher packs cover 14 languages, all 59 leaves, merge validates.
- [ ] Corpus built: ~3M rows, all languages/scripts, hard-neg + noise.
- [ ] e5-small bi + mMiniLM cross trained; INT8 ONNX within size/latency budget.
- [ ] Eval meets all v1 Must floors, every language.
- [ ] Bundle published to HF + installs into apps/api + apps/web.
- [ ] Server cascade wired + flywheel + conformal gate.
- [ ] Browser Privacy-Mode student runs offline (optional, can follow).
- [ ] Total spend ≤ $30, recorded.
- [ ] Provenance + model card complete.
