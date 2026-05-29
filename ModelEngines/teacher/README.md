# teacher/ — subagent-generated teacher packs

The "teacher" that produces training-data diversity. Originally planned as
Gemma 4 31B-it on Modal (`jobs/01_gemma_generate.py`); we instead use **Opus 4.8
subagents** to do the identical job, because:

- $0 (no GPU), and removes the riskiest build step (vLLM+Gemma load).
- Opus 4.8 ≥ Gemma 4 31B for instruction-following + Indic code-mix.
- Output is a frozen file, so the *dataset* stays reproducible even though LLM
  generation isn't bit-deterministic (same property Gemma would have had).

## What lives here

```
teacher/
  README.md            this file
  SPEC.md              the exact generation contract (what each pack must contain)
  packs/               one JSONL file per generation batch (subagent output)
  teacher_packs.jsonl  merged + validated final artifact (consumed by expand.py)
  merge.py             merge packs/ → teacher_packs.jsonl, validate against taxonomy
```

## Schema (identical to what `local/expand.py` expects)

One JSON object per leaf, one per line:

```json
{
  "leaf": "groceries",
  "templates": ["{merchant} {amount} {noise}", "paid {amount} at {merchant}", ...],
  "merchant_aliases": ["dmart", "big bazaar", "reliance fresh", ...],
  "phrasings": ["grocery run dmart", "veggies and milk", "monthly ration", ...],
  "code_mixed": ["groceries ke liye paise", "sabzi ku 200", ...]
}
```

Slots usable in `templates`: `{merchant}` `{amount}` `{noise}` `{date}`.
`expand.py` fills them and strips any other `{slot}` it doesn't recognise.

## Workflow

1. Subagents generate packs → `teacher/packs/batch_*.jsonl`.
2. `python teacher/merge.py` → merges, validates every leaf is covered with
   non-empty lists, writes `teacher/teacher_packs.jsonl`.
3. `config.GEMMA_TEMPLATES` points at `teacher/teacher_packs.jsonl`, so
   `local/expand.py` consumes it unchanged.

`jobs/01_gemma_generate.py` is retained for reference but is **deprecated** —
the subagent path is the supported teacher.
