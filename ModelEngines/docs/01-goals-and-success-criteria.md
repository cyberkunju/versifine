# 01 · Goals & Success Criteria

Concrete, measurable targets. If the build does not hit the "must" rows, it is
not done. The "stretch" rows are what "insane top-notch" means.

## Primary accuracy targets

Measured on the **hard eval set** (doc 08): hand-checkable, deliberately messy,
code-mixed, long-tail — NOT a clean holdout.

| Metric | Must (ship) | Target | Stretch |
|---|---|---|---|
| Reranked **top-1** accuracy | ≥ 90% | **≥ 95%** | ≥ 97% |
| Bi-encoder **top-3** recall | ≥ 96% | ≥ 98% | ≥ 99% |
| Bi-encoder **top-8** recall | ≥ 98% | ≥ 99.5% | ≥ 99.9% |
| **Confident** accuracy (post conformal gate) | ≥ 96% | ≥ 98% | ≥ 99% |
| Coverage at confident accuracy | ≥ 80% | ≥ 88% | ≥ 92% |

Rationale for the two-stage targets: the bi-encoder only has to get the right
label **into the top-k** (a much easier recall problem), and the cross-encoder
does the hard precision work of picking the winner. If top-8 recall is ~99%, the
ceiling for reranked top-1 is ~99%, so the recall target gates the headline.

## Per-segment targets (no weak spots)

The model must not be lopsided. On the eval set, broken out:

| Segment | Must top-1 |
|---|---|
| English clean ("netflix 649") | ≥ 96% |
| UPI/POS noise (`UPI/swiggy/..`) | ≥ 92% |
| Hindi / Hinglish | ≥ 90% |
| Malayalam / Manglish | ≥ 88% |
| Tamil / Telugu / Kannada (+ mixed) | ≥ 88% |
| Long-tail / never-seen merchant | ≥ 85% |
| Per-group accuracy (every one of 13 groups) | ≥ 88% |

A single group or language below its floor blocks ship — we fix the data mix
and retrain rather than accept a blind spot.

## Latency & size targets (runtime)

| Metric | Must | Target |
|---|---|---|
| End-to-end categorize (server, 1 txn) | ≤ 40 ms | ≤ 20 ms |
| Bi-encoder embed (1 txn, CPU) | ≤ 15 ms | ≤ 8 ms |
| Cross-encoder rerank (8 candidates, CPU) | ≤ 30 ms | ≤ 18 ms |
| Bi-encoder INT8 ONNX size | ≤ 60 MB | ≤ 35 MB |
| Cross-encoder INT8 ONNX size | ≤ 320 MB | ≤ 300 MB |
| Browser (Privacy Mode) bi-encoder load | works | ≤ 35 MB, ≤ 2 s |

The bi-encoder MUST be small enough to run in the browser (Privacy Mode).
The cross-encoder may be server-only if needed, with the bi-encoder + conformal
gate as the browser fallback.

## Cost target

| Item | Must | Target |
|---|---|---|
| Total compute for one full build | ≤ $30 | ≤ $18 |
| Out-of-pocket after Modal free credits | ≤ $30 | ~$0 |
| Re-train (after data tweak, no re-gen) | ≤ $10 | ≤ $8 |

## Capability goals (qualitative, but testable)

1. **Open vocabulary.** Adding a new leaf requires only: edit `taxonomy.json`,
   add example phrases, re-run the example-bank embedding step. **No retrain.**
   Test: add a dummy leaf, confirm it can be predicted without touching weights.
2. **Graceful abstention.** When genuinely ambiguous, the conformal gate returns
   "low confidence" (→ `Other`/review) rather than a confident wrong answer.
   Test: feed gibberish; confirm it abstains, not hallucinates.
3. **Flywheel.** A user correction for a merchant makes the next identical/near
   transaction categorize correctly. Test: correct "Acme Foods"→Groceries, embed
   it into the bank, confirm "ACME FOODS BLR" now resolves to Groceries.
4. **Offline.** Inference makes zero network calls. Test: run with network off.
5. **Backward compatible.** Every v2 leaf maps to a v1 category so existing
   stored transactions + the API enum keep working. Test: `legacy_map` covers
   all leaves (enforced by the taxonomy validator).

## Definition of Done (checklist)

- [ ] `taxonomy` + `crosswalk` validate clean.
- [ ] `eval_report.json` meets all **Must** accuracy + per-segment floors.
- [ ] INT8 ONNX bundle within size + latency budgets.
- [ ] Bundle published to HF + installs into `apps/api` and `apps/web`.
- [ ] API retrieve→rerank engine wired, with conformal gate + flywheel.
- [ ] Offline test passes (no network during inference).
- [ ] Total spend ≤ $30, recorded.
- [ ] `DATA_PROVENANCE.md` compliance checklist all ticked.
- [ ] Model card published with intended use + limitations + attributions.
