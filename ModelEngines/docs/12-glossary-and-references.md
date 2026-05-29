# 12 · Glossary & References

## Glossary

- **Leaf** — the finest category label the model predicts (e.g. `pharmacy`).
- **Group** — a parent bucket of leaves (e.g. `Health & Wellness`); UI roll-up.
- **Open vocabulary** — label set is data (example phrases), so adding a category
  needs no retrain. Opposite of a fixed softmax head.
- **Bi-encoder** — encodes query and candidate separately into vectors; fast
  cosine retrieval. Here: fine-tuned `multilingual-e5-small`.
- **Cross-encoder** — encodes `[query, candidate]` together with cross-attention;
  accurate scoring of a pair. Here: fine-tuned `mdeberta-v3-base`.
- **Retrieve → rerank** — bi-encoder gets top-K candidates (recall), cross-encoder
  picks the winner (precision). The modern two-stage stack.
- **Distillation** — capturing a big model's knowledge in a small one. Here: the
  LLM teacher's knowledge lives in the data it generates + verify labels; the
  encoders learn it; the LLM is never served at runtime.
- **Contrastive learning** — train embeddings so same-meaning items pull together,
  different push apart. `MultipleNegativesRankingLoss` + in-batch/hard negatives.
- **Hard negative** — a confusable wrong candidate (looks similar, different leaf)
  used to sharpen the embedding space.
- **Conformal prediction** — a calibration giving a statistical coverage guarantee;
  used here as the abstention gate (emit vs "not confident").
- **Example bank** — `(leaf, phrase)` table with embeddings; powers open vocab +
  the flywheel.
- **Flywheel** — user corrections + hard-case decisions re-enter the example bank,
  improving accuracy without retraining.
- **Template trick** — LLM generates a few thousand templates/slot-fillers; the
  laptop explodes them into millions of rows for free.
- **Crosswalk** — mapping external taxonomies (MCC/Plaid/FSQ) onto our leaves to
  deterministically label harvested merchants.
- **Code-mixed** — one utterance mixing languages (e.g. Hinglish: Hindi + English
  in Latin script).
- **MCC** — Merchant Category Code (ISO 18245), ~1000 card-network categories.
- **PFC** — Plaid Personal Finance Categories, a txn-categorization taxonomy.
- **UPI** — India's Unified Payments Interface; its statement strings are noisy.
- **INT8 quantization** — compressing model weights to 8-bit for small, fast ONNX.

## References (research + data sources)

Content from external sources was rephrased for compliance with licensing
restrictions; cited for attribution.

### Technique
- Retrieve-then-rerank, bi- vs cross-encoder tradeoffs —
  [hackerllama: Sentence Embeddings, Cross-encoders & Re-ranking](https://osanseviero.github.io/hackerllama/blog/posts/sentence_embeddings2/),
  [ZeroEntropy: Bi-Encoders vs Cross-Encoders](https://zeroentropy.dev/articles/biencoder-vs-crossencoder/).
- Distilling LLMs into cross-encoders (matches LLM effectiveness, far cheaper) —
  [Rank-DistiLLM, arXiv 2405.07920](https://arxiv.org/html/2405.07920v2).
- Multilingual embeddings — [BGE-M3, arXiv 2402.03216](https://arxiv.org/abs/2402.03216);
  Indian-language embedding eval (E5/BGE-M3 lead) — [arXiv 2601.10205](https://arxiv.org/html/2601.10205).
- Transaction classification + synthetic data —
  [SVM short-text bank txn, arXiv 2404.08664](https://arxiv.org/html/2404.08664v1);
  [SME txn w/ synthetic data, arXiv 2508.05425](https://arxiv.org/html/2508.05425);
  [weakly-supervised bank txn, arXiv 2305.18430](https://arxiv.org/abs/2305.18430).

### Taxonomy
- MCC (ISO 18245) JSON — [greggles/mcc-codes](https://github.com/greggles/mcc-codes).
- Plaid PFC taxonomy + migration CSV — [Plaid PFC migration](https://plaid.com/docs/transactions/pfc-migration),
  [Plaid taxonomy blog](https://plaid.com/blog/transactions-categorization-taxonomy/).
- Foursquare categories — [FSQ category docs](https://developer.foursquare.com/docs/categories).
- India MCC context — [open.money MCC list](https://open.money/blog/merchant-category-code-list-in-india/).
- GST HSN/SAC — [geongeorge/GST-HSN-Codes-Fetch](https://github.com/geongeorge/GST-HSN-Codes-Fetch).

### Merchant / POI data
- Wikidata SPARQL (CC0) — [query.wikidata.org](https://query.wikidata.org),
  [WikiProject Companies](https://www.wikidata.org/wiki/Wikidata:WikiProject_Companies).
- Foursquare OS Places (Apache-2.0) — [HF foursquare/fsq-os-places](https://huggingface.co/datasets/foursquare/fsq-os-places),
  [ClickHouse mirror](https://clickhouse.com/docs/getting-started/example-datasets/foursquare-places).
- Overture Places (CDLA/Apache) — [overturemaps.org places](https://docs.overturemaps.org/guides/places/).
- OSM Name Suggestion Index — [osmlab/name-suggestion-index](https://github.com/osmlab/name-suggestion-index).

### Transaction corpora (reference/eval; check per-repo license before shipping rows)
- [electricsheepafrica/nigerian-banking-retail-transactions](https://huggingface.co/datasets/electricsheepafrica/nigerian-banking-retail-transactions) (Apache-2.0, 5M).
- [DoDataThings/us-bank-transaction-categories-v2](https://huggingface.co/datasets/DoDataThings/us-bank-transaction-categories-v2) (debit/credit prefix idea).
- [mitulshah/global-financial-transaction-classifier](http://huggingface.co/mitulshah/global-financial-transaction-classifier) (4.5M reference).
- [nileshely/UPI-Transactions](https://github.com/nileshely/UPI-Transactions) (India UPI).

### Models
- Teacher: [google/gemma-4-31B-it](https://huggingface.co/google/gemma-4-31B-it) (Apache-2.0).
- Bi-encoder: [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) (MIT).
- Cross-encoder: [microsoft/mdeberta-v3-base](https://huggingface.co/microsoft/mdeberta-v3-base) (MIT).

### Compute
- Modal GPU pricing — [Modal B200/H200 blog](https://modal.com/blog/introducing-b200-h200),
  [Modal GPU types](https://modal.com/blog/gpu-types), [Modal pricing](https://modal.com/pricing).
- Modal serving guidance — [Modal GPU guide](https://modal.com/docs/guide/gpu).

> Note on dates: model versions (Gemma 4, Qwen 3.6) and prices reflect the
> current releases as of authoring (2026). If rebuilding later, re-verify repo
> IDs, licenses, and prices; the architecture and method are version-agnostic.
