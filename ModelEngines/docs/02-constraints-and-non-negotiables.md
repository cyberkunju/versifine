# 02 · Constraints & Non-Negotiables

These are the hard boundaries. Some are *requirements* (must do), some are
*prohibitions* (must not do). Violating any of these means the build is wrong,
regardless of how good the accuracy looks.

## NON-NEGOTIABLE REQUIREMENTS (cannot be avoided)

### N1 — Open vocabulary
The label set MUST be data, not baked into weights. Adding/removing/renaming a
category MUST NOT require retraining the encoders. This rules out a softmax
N-class head as the primary classifier. (A closed head may exist only as an
optional accelerator, never as the sole path.)

### N2 — Multilingual + code-mixed first-class
The model MUST handle English + Hindi + Malayalam + Tamil + Telugu + Kannada,
including Latin-script code-mixing, as a primary case — not an afterthought.
The base model MUST be natively multilingual. English-only models are
disqualified.

### N3 — Local + offline runtime
Inference MUST run locally with **zero network calls**, on the API server (CPU
acceptable) and in the **browser** (Privacy Mode) for at least the bi-encoder.
No per-transaction cloud LLM call is allowed at runtime. The teacher LLM is
build-time only.

### N4 — Real messy input
Training + eval MUST reflect real transaction text: UPI/POS noise, typos,
casing chaos, missing spaces, merchant IDs, multiple amount formats. A model
that only works on clean text is a failure, no matter its clean-text score.

### N5 — Graceful abstention
The system MUST be able to say "not confident" (via conformal prediction) and
fall back rather than emit a confident wrong label. A confident wrong answer is
worse than an honest "Other / please confirm".

### N6 — Backward compatibility
Every v2 leaf MUST map to a v1 category (`legacy` field), so existing stored
transactions and the API's category enum keep working during/after migration.
Enforced by the taxonomy validator.

### N7 — Cost ceiling
One full build MUST cost ≤ $30. The architecture and compute plan must be chosen
to honour this. (See doc 10.)

### N8 — Single teacher LLM, run locally on Modal
Only **one** LLM is used in the whole pipeline: **Gemma 4 31B-it**, served on
Modal GPUs (not via any external paid API). No OpenAI/Anthropic/other LLM in the
build. (Decision made explicitly by the project owner.)

### N9 — Determinism & reproducibility
Every randomized step MUST be seeded. Re-running the pipeline on the same inputs
MUST produce equivalent artifacts. Data provenance MUST be tracked.

### N10 — Licensing cleanliness
The shipped artifact MUST be free of restrictively-licensed third-party rows.
Train only on permissive/public-domain sources + synthesis; use restrictive
datasets for reference/eval only. (See doc 11 + DATA_PROVENANCE.md.)

## NON-NEGOTIABLE PROHIBITIONS (must not do)

### P1 — No runtime LLM
Never call an LLM (local or cloud) to categorize a live transaction. Distill,
don't serve. (Exception: none for categorization. The separate copilot feature
is unrelated.)

### P2 — No closed-set-only design
Never build the categorizer such that the only way to add a category is a
retrain. (See N1.)

### P3 — No guessing on harvest labels
When deterministically labeling harvested merchants, a row that doesn't resolve
through the crosswalk is **dropped, never guessed**. A wrong label poisons
training worse than a missing row.

### P4 — No PII / no real user data in training
Training data is synthesis + public sources only. Never train on real Versifine
user transactions. The flywheel stores *example phrases* a user corrected, not
their full transaction history, and stays per-deployment/private.

### P5 — No silent taxonomy drift
The label set is versioned. Changing it bumps the taxonomy version and is
recorded in the manifest. The model and the API must agree on the label set via
`manifest.json`.

### P6 — No unbalanced blind spots
Ship is blocked if any language segment or any of the 13 groups is below its
per-segment floor (doc 01). We fix the data mix, not lower the bar.

## THE "EXTREME" BAR (what insane top-notch requires)

These are the things that separate "good enough" from "exceptional". They are
expected, not optional, for this project:

1. **Hard-negative mining.** Train the bi-encoder against confusable pairs
   (mined from its own embeddings after a warmup epoch), not just random
   negatives. This is what sharpens fine distinctions.
2. **A genuinely hard eval set.** ~2-4k hand-checkable rows engineered to be
   adversarial: ambiguous merchants, heavy code-mix, novel names, noise. If the
   eval is easy, the score is a lie.
3. **Per-segment + per-group reporting** every eval, every time. No aggregate
   number without the breakdown.
4. **Conformal calibration**, not a hand-tuned threshold. Statistical coverage
   guarantee for the abstention gate.
5. **The flywheel actually wired**, not just designed. Corrections must
   measurably improve subsequent predictions.
6. **Realism transforms** in synthesis: UPI wrapping, typo injection, amount
   format variety, casing/spacing chaos. The data must look like the wild.
7. **Coverage of every leaf** in both harvest and synthesis — no leaf trained on
   <MIN_ROWS_PER_LEAF examples (config enforces a floor).

## Tradeoffs we ACCEPT

- Bi-encoder uses a small model (`multilingual-e5-small`) for browser-fit; we
  trade a couple of points of raw embedding quality for offline/Privacy-Mode
  capability. The cross-encoder reranker recovers the accuracy.
- The cross-encoder may be server-only if it can't fit the browser; Privacy Mode
  then runs bi-encoder + conformal gate (slightly lower precision, still good).
- Synthesis-heavy data can be repetitive; we counter with hard negatives, a real
  eval set, and harvested real merchant names.
