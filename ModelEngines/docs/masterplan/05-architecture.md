# 05 · Architecture (Runtime + Training)

Two architectures: the **runtime cascade** (what categorizes a live transaction)
and the **build pipeline** (what produces the artifacts). Both are shared by v1
and v2 — only the model identities and a few loops differ.

---

## Runtime architecture (inference)

A cascade: cheap exact tiers first, semantic tiers only when needed. Runs inside
the Versifine API (full) and the browser (reduced, Privacy Mode).

```
 transaction text (any of 14 langs, any script, any noise)
        │
        ▼
 ┌──────────────────────────────────────────────┐
 │ 0 · NORMALIZER                                │ script-detect, Unicode NFC,
 │    de-noise (UPI/POS), expand abbreviations,  │ optional transliterate-canonical
 │    native-digit → ASCII digit                 │ (rules + tiny helpers, microseconds)
 └──────────────────────────────────────────────┘
        │
 ┌──────────────────────────────────────────────┐
 │ 1 · USER OVERRIDES (per space)                │ exact, instant, free, conf 1.0
 │    normalized_merchant → category             │ (user corrected this before)
 └──────────────────────────────────────────────┘  miss ↓
 ┌──────────────────────────────────────────────┐
 │ 2 · MERCHANT DB                               │ curated + harvested patterns
 │    regex / contains / exact, conf 0.95        │ instant
 └──────────────────────────────────────────────┘  miss ↓
 ┌──────────────────────────────────────────────┐
 │ 3a · BI-ENCODER retrieve (local ONNX, ~5-15ms)│ embed(query) · cosine vs
 │    label embeddings ∪ example-bank vectors    │ → top-k candidate leaves
 └──────────────────────────────────────────────┘
        │ top-k
 ┌──────────────────────────────────────────────┐
 │ 3b · CROSS-ENCODER rerank (local ONNX,~10-30ms)│ score [text, candidate] pairs
 │    pick the winner                            │ precision on hard pairs
 └──────────────────────────────────────────────┘
        │ winner + score
 ┌──────────────────────────────────────────────┐
 │ 4 · CONFORMAL GATE                            │ score ≥ thr → emit (+confidence)
 │    decidable & confident → emit               │ ambiguous → resolve from THIS
 │    ambiguous → user-context resolve           │ user's history; still unsure →
 │    still unsure → one micro-question          │ ask once (the only "fallback")
 └──────────────────────────────────────────────┘
        │
        ▼  leaf (+ legacy category + confidence + source tier + language)
        │
        └──► user correction → embed phrase → append to example bank (FLYWHEEL)
```

### Why the cascade
Overrides + merchant DB resolve high-frequency unambiguous cases in microseconds
for free; the model tiers handle the long tail and messy/novel/multilingual
text; the conformal gate converts "not sure" into an honest abstention/context-
resolution instead of a confident mistake. This cascade is the mechanism behind
the "as close to 100% as possible" goal.

### The example bank (open vocabulary + flywheel)
`(leaf, phrase, vector)` table. Two roles: (1) open vocabulary — a new leaf's
example phrases make it retrievable with no retrain; (2) flywheel — a corrected
phrase is embedded + appended, so similar future text resolves correctly.
Retrieval compares the query against BOTH per-leaf label embeddings AND
example-bank vectors.

### Browser (Privacy Mode) reduction
Tiers 0,1,2,3a + gate run in-browser (e5-small INT8 + lookups). Cross-encoder is
server-only; browser uses bi-encoder top-1 with a stricter gate. Raw text never
leaves the device; only the resulting category is stored.

### Ambiguity resolution (the honest path to ~100%)
When the gate flags ambiguity (e.g. "Reliance"), the runtime:
1. Checks the user's **history**: have they categorized this merchant before? →
   use that (this is where the per-user flywheel shines).
2. Checks **co-signals**: amount range, recurring pattern, wallet, time.
3. If still genuinely undecidable, asks **one micro-question** ("Reliance — was
   this groceries or electronics?") and remembers the answer forever.
This is how effective accuracy approaches 100% without ever blind-guessing.

---

## Build (training) architecture — laptop + Modal

```
 ┌──────────────────────────── LAPTOP (free) ────────────────────────────┐
 │ teacher subagents → teacher_packs.jsonl                                │
 │ harvest.py / harvest_bulk.py → harvest_pairs.parquet                   │
 │ expand.py (templates × merchants × noise) → concept rows               │
 │ transliterate.py (native↔Latin, all 14) → multilingual rows            │
 │ augment.py (typos/UPI/code-switch, multiprocessing) → wild rows         │
 │ mine_hard_negs.py (4060 GPU embeds 3M rows) → hard-neg index           │
 │ → train.parquet / eval.parquet / calib.parquet / example_bank.parquet  │
 └────────────────────────────────────────────────────────────────────┘
                    ▲ artifacts up                │ datasets up
 ┌──────────────────────────── MODAL (paid, tiny) ──────────────────────┐
 │ jobs/train.py   ONE A100 fn: bi-encoder (contrastive + hard-negs) then │
 │                 cross-encoder (pairwise rerank labels)                 │
 │ jobs/export.py  L4: ONNX + INT8 + embed bank + conformal calib + HF push│
 │ jobs/eval.py    L4: per-language retrieve→rerank→gate, full report      │
 └────────────────────────────────────────────────────────────────────┘
```

### Why this split
Only training touches paid GPU. All data work — generation, harvest, expansion,
transliteration, noise, **and hard-negative mining** — is CPU/laptop-GPU bound
and free. The trained models are small (118M) so training is hours, single-GPU.

### Training stages (v1)
1. **Contrastive bi-encoder** — anchor = transaction text; positive = same-leaf
   text / label sentence; in-batch negatives (NoDuplicatesDataLoader so no
   same-leaf collisions) + **mined hard negatives** from Stage 6.
2. **Cross-encoder** — for each text, bi-encoder's top-k candidates → pairs
   labeled 1 (true) / 0 (others), train binary reranker. Always inject the true
   leaf as a positive.
3. **Export + INT8 + conformal calibration** on the held-out **calib** split
   (not eval), running the full pipeline so the gate score matches runtime.

### v2 additions (doc 10)
Swap e5-small→BGE-M3, mMiniLM→BGE-reranker/MuRIL; add **active-learning loops**
(train → find low-confidence regions per language → targeted subagent data →
retrain, warm-started). Same pipeline, bigger student, more loops.

---

## Data-flow contract (file-by-file)

| File | Produced by | Schema | Consumed by |
|---|---|---|---|
| teacher_packs.jsonl | subagents+merge | leaf,lang,templates,aliases,phrasings,code_mixed | expand |
| harvest_pairs.parquet | crosswalk_build | text,leaf,lang,source,confidence | expand |
| train.parquet | expand+augment | text,leaf,lang | train |
| eval.parquet / calib.parquet | expand (natural only) | text,leaf,lang | eval / calib |
| example_bank.parquet | expand | leaf,lang,text | export(embed), runtime |
| hard_negs.parquet | mine_hard_negs | anchor_idx,neg_idx | train |
| bundle/ | export | onnx+npy+json | eval, package, runtime |

Every randomized producer seeded; schemas are stable contracts.
