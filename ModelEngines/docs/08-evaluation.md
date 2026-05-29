# 08 · Evaluation

"If the eval is easy, the score is a lie." This document defines how we measure
honestly and what gates ship.

---

## What we evaluate

The **full runtime pipeline**, end to end, exactly as the API runs it:
bi-encoder embed → cosine top-K → cross-encoder rerank → conformal gate. Not the
bi-encoder alone, not on clean text — the real thing on hard input.

Implemented in `jobs/04_eval.py`, output `eval_report.json`.

---

## Metrics (every run reports all of them)

| Metric | Definition | Why it matters |
|---|---|---|
| **bi top-1/3/K recall** | is the gold leaf at rank 1 / in top-3 / in top-K from the bi-encoder | gates the ceiling; rerank can't fix what retrieval missed |
| **reranked top-1** | cross-encoder's winner == gold | **the headline accuracy** |
| **confident accuracy** | accuracy among predictions with sim ≥ conformal threshold | quality of what we actually emit |
| **coverage** | fraction of predictions above the threshold | how often we don't abstain |
| **per-group top-1** | reranked top-1 broken out by the 13 groups | finds blind spots |

Per-language segmentation (English / Hindi / Manglish / Tamil-Telugu-Kannada /
UPI-noise / long-tail) is computed when the eval set carries a `segment` tag
(see "hardening" below) — required to enforce the per-segment floors in doc 01.

---

## The held-out eval set

Default: `expand.py` splits eval rows from the **most natural** synthesized rows
(phrasings + code-mixed) + a slice of harvested real names — explicitly NOT
random template fills, so we measure understanding, not template memorization.
~4k rows.

### Hardening the eval set (do this for a trustworthy number)

The default eval is decent but still synthetic. To make the score honest,
augment with a **hand-curated adversarial set** (a few hundred rows is enough to
move the needle on trust):

1. **Real messy strings.** Collect/anonymize real UPI SMS + bank statement lines
   (or write realistic ones by hand). Label them by hand.
2. **Ambiguous merchants.** "Reliance" (Fresh=groceries vs Digital=electronics
   vs Jio=mobile), "airport coffee" vs "lounge access", "Apollo" (pharmacy vs
   hospital vs tyres).
3. **Heavy code-mix.** One line mixing two scripts + numbers.
4. **Novel merchants.** Names the model can't have seen.
5. **Tag each row with a `segment`** so per-segment floors compute.

Store the curated set as `data/eval_hard.jsonl` (text, leaf, segment) and have
`jobs/04_eval.py` union it with the parquet eval (a small code addition). The
curated set is the real exam.

---

## Ship gates (from doc 01)

Ship is **blocked** unless ALL of these hold on the (hardened) eval set:

- reranked top-1 ≥ 90% (target 95%)
- bi top-8 recall ≥ 98%
- confident accuracy ≥ 96% at coverage ≥ 80%
- every per-group top-1 ≥ 88%
- every per-language segment ≥ its floor (doc 01)
- INT8 ONNX within size + latency budgets

A single failing segment or group → fix data mix (doc 05), retrain, re-eval. We
do not lower the bar.

---

## Diagnosing failures

| Symptom | Likely cause | Fix |
|---|---|---|
| low bi top-K recall | bi-encoder weak / not enough contrastive signal | more epochs, bigger batch, more hard negatives, more data for that leaf |
| good recall, bad reranked top-1 | cross-encoder weak / bad candidate pairs | more cross-encoder epochs, more/better negative pairs, larger K |
| one language low | language under-represented in synthesis | raise that language's pack size, regenerate, retrain |
| one group low | confusable leaves / thin data | add hard negatives between those leaves, more examples, clearer label sentences |
| high coverage, low confident acc | threshold too loose | recalibrate (lower coverage target) |
| low coverage | threshold too strict / embeddings noisy | improve bi-encoder; raise coverage target carefully |
| overfit to templates | eval too template-like | harden eval (above); add realism; reduce template ratio |

---

## Regression discipline

- Keep every `eval_report.json` (timestamped) so you can compare runs.
- A change that improves the aggregate but drops a segment below floor is a
  **regression** — reject it.
- The hardened curated eval set is frozen (don't tune against it blindly; if you
  must add cases, version it).

---

## Sanity / capability tests (beyond accuracy)

Run these manually before ship (they verify the non-negotiables, doc 02):

1. **Open vocab:** add a dummy leaf + examples, re-embed bank, confirm it can be
   predicted — no retrain.
2. **Abstention:** feed gibberish → confidence below threshold → abstains.
3. **Flywheel:** correct a novel merchant, embed it into the bank, confirm the
   next near-identical string resolves correctly.
4. **Offline:** run inference with the network disabled → still works.
5. **Backward compat:** every predicted leaf maps to a v1 category via
   `legacy_map`.
