# 08 · Evaluation

"If the eval is easy, the score is a lie." This defines how we measure honestly
across 14 languages and what gates ship.

## What we evaluate

The **full runtime pipeline**, end to end, exactly as the API runs it:
bi-encoder embed → cosine top-k → cross-encoder rerank → conformal gate. On hard
input. Implemented in `jobs/eval.py`, output `eval_report.json`.

## Metrics (every run, all of them)

| Metric | Definition | Why |
|---|---|---|
| bi top-1/3/k recall | gold leaf at rank 1 / in top-3 / in top-k from bi-encoder | gates the ceiling; rerank can't fix missed retrieval |
| reranked top-1 | cross-encoder winner == gold | **headline accuracy** |
| confident accuracy | accuracy among predictions with score ≥ gate threshold | quality of what we actually emit |
| coverage | fraction above threshold | how often we don't abstain |
| per-group top-1 | reranked top-1 by the 13 groups | finds blind spots |
| **per-language top-1** | reranked top-1 by each of the 14 languages | **the headline gate** |
| per-(language×script) | native vs Romanized accuracy | catches script weaknesses |

## The eval sets

### 1. Synthetic held-out (auto, every build)
Drawn ONLY from natural rows (Opus phrasings/code-mixed + harvested names),
**never template fills**, normalized-key **quarantined** from train+bank (zero
leakage). Per language. ~1–2k rows/language.

### 2. Hard curated set (the real exam — build this)
A few hundred **hand-checked real strings per major language**:
- real anonymized UPI SMS / bank statement lines, hand-labeled
- ambiguous merchants ("Reliance", "Apollo", "paid Sharma 5000")
- heavy code-mix + mixed-script
- novel merchants the model can't have seen
- each tagged with `language`, `script`, `segment`

Stored as `data/eval_hard.jsonl` (text, leaf, language, script, segment).
`jobs/eval.py` unions it with the synthetic eval. **This is the trustworthy
production number** — the synthetic number is necessary but not sufficient.

## Ship gates (v1) — per doc 00

Ship is **blocked** unless ALL hold on the hard eval:
- reranked top-1 ≥ 90% (target 94%)
- bi top-5 recall ≥ 97%
- confident accuracy ≥ 95% at coverage ≥ 80%
- every **per-group** top-1 ≥ 88%
- every **per-language** top-1 ≥ 88% (Maithili/Assamese interim 88%; others 92%
  target)
- INT8 ONNX within size/latency budget (doc 04)

A single failing language or group → fix data mix (doc 03), retrain, re-eval.
**No language left behind** = "no fallback" made measurable.

## Diagnosing failures

| Symptom | Cause | Fix |
|---|---|---|
| low bi top-k recall | bi-encoder weak | more epochs/batch, more hard negs, more data for that (leaf,lang) |
| good recall, bad reranked | cross-encoder weak | more CE epochs, better negative pairs, larger k |
| one language low | under-represented / transliteration noise | raise that language's data weight, more Opus native rows, regen, retrain |
| one group low | confusable leaves | hard negatives between those leaves, clearer label sentences, more examples |
| native ok, Romanized bad (or vice versa) | script imbalance | rebalance transliteration coverage for that language |
| high coverage, low confident acc | gate too loose | recalibrate (lower coverage target) |

## Capability tests (beyond accuracy)

Run before ship (verify the non-negotiables):
1. **Open vocab:** add a dummy leaf + examples, re-embed bank, predict it — no
   retrain.
2. **Abstention:** feed gibberish → below threshold → abstains.
3. **Flywheel:** correct a novel merchant, embed into bank, confirm next
   near-identical string resolves.
4. **Offline:** browser inference with network disabled → works.
5. **Backward compat:** every predicted leaf maps to a v1 category via legacy_map.
6. **Ambiguity:** feed "Reliance" with no user history → gate flags / asks micro-
   question (doesn't blind-guess).

## Regression discipline

- Keep every timestamped `eval_report.json`.
- A change that lifts the aggregate but drops a language/group below floor is a
  **regression** — reject it.
- The hard curated set is frozen; version it if you must add cases.
