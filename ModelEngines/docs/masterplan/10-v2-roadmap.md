# 10 · v2 Roadmap — The Full-Power Model

v2 is the maximum-accuracy build. **It reuses the entire v1 foundation** — same
taxonomy, teacher data, harvest, transliteration, noise engine, eval harness,
runtime cascade, flywheel. v2 = a student-model swap + extra training loops.
Nothing from v1 is thrown away.

## What changes vs v1

| Component | v1 | v2 |
|---|---|---|
| Bi-encoder | multilingual-e5-small (118M) | **BGE-M3 (568M)** |
| Cross-encoder | mMiniLM-L12 (118M) | **BGE-reranker-v2-m3** and/or **MuRIL-large** (Indic decider) |
| Ensemble decider | none | optional: BGE-reranker + MuRIL-large + IndicBERT-v2, majority vote |
| Active learning | optional | **yes, 2–3 loops** |
| Browser | e5-small is the model | distill a small sibling from BGE-M3 for browser |
| Server hardware | EC2 CPU fine | EC2 CPU ok (568M INT8) or small GPU for speed |
| Cost | ~$9–25 | ~$55 one build, ~$90–140 with iteration |

## Why these swaps (research-backed, doc 12)

- **BGE-M3** is the strongest open multilingual retriever (dense+sparse+multi-
  vector, 100+ langs) → better top-k recall, the v1 ceiling-raiser.
- **MuRIL-large** is the proven Indic+transliteration *classification* champion
  (beats general multilingual models on Indic benchmarks). As the v2 decider it
  makes the final call with the best Indic precision available — ideal for 14
  Indian languages.
- **Ensemble** buys the last 1–2 points + free confidence signal.

## The active-learning loop (v2's accuracy engine)

```
train v2 → run eval → find the lowest-confidence regions PER LANGUAGE / PER LEAF
        → spawn subagents to generate TARGETED data exactly there
        → transliterate + augment (laptop) → add to corpus
        → warm-start retrain (fine-tune the existing checkpoint on the new hard data)
        → re-eval → repeat until every per-language floor is green
```
This grinds out the last points exactly where the model is weak, instead of
generating blindly. Warm-starting keeps each loop cheap (~$13).

## v2 build sequence

0. (reuse v1 taxonomy, teacher_packs, harvest, corpus)
1. Add v2-targeted teacher data if needed (subagents, $0).
2. `jobs/train_v2.py` — BGE-M3 bi-encoder (multi-stage: contrastive → hard-neg
   round → curriculum) then BGE-reranker / MuRIL cross-encoder. A100/H200.
3. Active-learning loops ×2–3 (warm-started).
4. `jobs/export_v2.py` — ONNX + INT8 + calibration + HF push
   (`CyberKunju/versifine-categorizer-v2`).
5. Distill a small browser student (e5-small or MiniLM) from BGE-M3 outputs.
6. `jobs/eval_v2.py` — per-language gates at the higher v2 floors (≥95%).

## v2 success criteria (doc 00)

- reranked top-1 ≥ 97% on hard eval
- confident accuracy ≥ 99% at coverage ≥ 92%
- every per-language floor ≥ 95% (incl. Maithili/Assamese after flywheel data)

## Migration v1 → v2

Drop-in: same bundle structure + manifest contract, so the runtime cascade
(doc 09) loads v2 by pointing `cat-v1` → `cat-v2`. Run both in shadow for a
period, compare, then cut over. The flywheel/example-bank carries over (re-embed
with the v2 bi-encoder once).

## What to add to the taxonomy in v2 (if usage demands)

crypto, EV charging, fines-vs-taxes, BNPL-vs-loan, tobacco/paan, gambling,
loan-received. Open vocabulary makes each cheap (doc 02).

## Beyond v2 (north star)

- **Per-user personalization layer**: a tiny per-space adapter learned from the
  flywheel so "Sharma" means *this* user's landlord.
- **Multimodal**: receipt-image + voice directly into the same cascade.
- **Continuous training**: scheduled retrains folding accumulated real
  corrections, with the hard eval as the regression gate.
