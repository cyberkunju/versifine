# MiniLM categorizer artifacts

This directory holds the local copy of the fine-tuned transaction-categorizer
model that the API loads at startup through Transformers.js.

## What lives here

`model/` — checked-out files from the HuggingFace repo
[`CyberKunju/finehance-categorizer-minilm`](https://huggingface.co/CyberKunju/finehance-categorizer-minilm).

| File                       | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `config.json`              | BERT model config + `id2label` mapping                 |
| `label_map.json`           | Canonical 23-class label map                           |
| `tokenizer.json`           | Fast tokenizer for runtime use                         |
| `tokenizer_config.json`    | Tokenizer settings (cls, sep, pad, mask, unk)          |
| `special_tokens_map.json`  | Special-token mapping                                  |
| `vocab.txt`                | WordPiece vocabulary                                   |
| `manifest.json`            | Build metadata (when fetched, ONNX status, label set)  |
| `onnx/model.onnx` _(opt.)_ | ONNX export of the model — required for live inference |

The same set is mirrored to `apps/web/static/models/` so the SvelteKit app can
load the bundle in Privacy Mode and run categorization inside the browser.

## Label set

The model emits exactly the 23 labels Finehance uses across the rest of the
system. The canonical list is owned by
[`packages/shared/src/categories.ts`](../../../../packages/shared/src/categories.ts)
and is _identical_ to what `label_map.json` ships:

```
Bills & Utilities, Cash & ATM, Childcare, Coffee & Beverages, Convenience,
Education, Entertainment, Fast Food, Food Delivery, Gas & Fuel, Giving,
Groceries, Healthcare, Housing, Income, Insurance, Other, Restaurants,
Shopping & Retail, Subscriptions, Transfers, Transportation, Travel
```

If a future model release changes labels, update `categories.ts` first, then
re-run the conversion script — the label-set check in
`services/categorize/minilm.ts` will refuse to load a mismatched bundle.

## How to (re)build the artifact

```sh
bun run --cwd apps/api convert:minilm
```

What the script does:

1. Downloads the canonical files (config, tokenizer, label map) from the HF
   repo into `apps/api/src/ml/model/`.
2. Tries to fetch optional ONNX siblings (`onnx/model.onnx`,
   `onnx/model_quantized.onnx`, `onnx/model_fp16.onnx`).
3. If at least one ONNX file is present, runs a probe: feeds
   `"starbucks coffee 250"` through the pipeline and asserts that the top
   prediction has a confidence > 0.5.
4. Mirrors everything to `apps/web/static/models/`.
5. Writes a `manifest.json` summarising what's on disk.

The download is idempotent — files already present on disk are skipped.
Total disk footprint is ~25 MB if the quantized ONNX is published, or
~0.9 MB (tokenizer + config only) when only safetensors is upstream.

## ONNX export — when the upstream repo doesn't ship it

The HF repo currently publishes only the SafeTensors weights
(`model.safetensors`, ~91 MB). Transformers.js needs an ONNX bundle to run
the classification pipeline, and there is no robust pure-JS converter for
SafeTensors → ONNX in 2026. To produce the ONNX bundle, run the Python
toolchain once:

```sh
pip install --upgrade "optimum[exporters,onnxruntime]" transformers
optimum-cli export onnx \
  --model CyberKunju/finehance-categorizer-minilm \
  apps/api/src/ml/model/onnx
```

Then re-run `bun run --cwd apps/api convert:minilm` to mirror the new files
into `apps/web/static/models/` and update the manifest.

## Graceful degradation

`services/categorize/minilm.ts` checks for an ONNX file and a matching label
set before loading the pipeline. When either is missing, it logs a single
warning and returns `null` from `categorizeWithMinilm()`. The tier resolver
in `services/categorize/index.ts` then falls through to the merchant DB and,
ultimately, the `Other` default — categorization keeps working, just without
the ML tier. Users see the difference in the `categorized_by` field on each
transaction (`merchants` / `default` instead of `minilm`).
