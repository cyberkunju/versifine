# 12 · Glossary & References

## Glossary

- **Leaf** — finest category the model predicts (e.g. `pharmacy`).
- **Group** — parent bucket of leaves (e.g. `Health & Wellness`); UI roll-up.
- **Open vocabulary** — label set is data (example phrases), so adding a category
  needs no retrain. Opposite of a fixed softmax head.
- **Bi-encoder** — encodes query and candidate separately into vectors; fast
  cosine retrieval. v1: `multilingual-e5-small`; v2: `BGE-M3`.
- **Cross-encoder** — encodes `[query, candidate]` together with cross-attention;
  accurate pair scoring. v1: `mMiniLM-L12`; v2: `BGE-reranker`/`MuRIL-large`.
- **Retrieve → rerank** — bi-encoder gets top-k (recall), cross-encoder picks the
  winner (precision). Modern two-stage SOTA.
- **Distillation** — capture a big model's knowledge in a small one. Here the
  teacher (Opus subagents) knowledge lives in the generated data; the small
  encoders learn it; the teacher is never served at runtime.
- **Contrastive learning** — train embeddings so same-meaning items pull
  together, different push apart. In-batch + hard negatives.
- **Hard negative** — a confusable wrong candidate (looks similar, different
  leaf) that sharpens the embedding space. Mined on the laptop GPU.
- **Conformal gate** — calibrated abstention: emit only if score clears a
  threshold tuned for a target retained-accuracy; else context-resolve / ask.
- **Example bank** — `(leaf, lang, phrase, vector)` table; powers open vocab +
  flywheel.
- **Flywheel** — user corrections + hard-case decisions re-enter the bank;
  accuracy compounds without retraining.
- **Template trick** — teacher generates a few thousand building blocks; the
  laptop explodes them into millions of rows for free.
- **Transliteration** — converting between scripts (native ↔ Latin/Romanized);
  the free 14-language multiplier.
- **Crosswalk** — mapping external taxonomies (MCC/Plaid/FSQ) → our leaves to
  deterministically label harvested merchants.
- **Code-mixed** — one utterance mixing languages (Hinglish, Manglish, etc.).
- **MCC** — Merchant Category Code (ISO 18245), ~1000 card-network categories.
- **PFC** — Plaid Personal Finance Categories.
- **MuRIL** — Google's BERT pretrained on 17 Indian languages + transliterations.
- **INT8 quantization** — compress weights to 8-bit for small, fast ONNX.

## References (research + data + tooling)

Content from external sources rephrased for compliance; cited for attribution.

### Technique
- Fine-tuned encoders beat LLM-prompting/retrieval for short-text classification
  at far lower cost — [arXiv 2602.06370](https://arxiv.org/html/2602.06370v1);
  encoder-only > decoder-only for NLU
  ([ResearchGate 377467915](https://www.researchgate.net/publication/377467915)).
- Retrieve-then-rerank, bi- vs cross-encoder —
  [hackerllama](https://osanseviero.github.io/hackerllama/blog/posts/sentence_embeddings2/),
  [ZeroEntropy](https://zeroentropy.dev/articles/biencoder-vs-crossencoder/).
- Distilling LLMs into cross-encoders — [Rank-DistiLLM, arXiv 2405.07920](https://arxiv.org/html/2405.07920v2).

### Multilingual / Indic models
- BGE-M3 — [arXiv 2402.03216](https://arxiv.org/abs/2402.03216),
  [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3).
- multilingual-e5 — [intfloat/multilingual-e5-large](https://huggingface.co/intfloat/multilingual-e5-large)
  (small variant used in v1).
- MuRIL beats general models on Indic classification —
  [arXiv 2602.23940 (Nepali topic, F1 90.6)](https://arxiv.org/html/2602.23940v1),
  [arXiv 2506.16066 (Hinglish, beats RoBERTa/IndicBERT)](https://arxiv.org/abs/2506.16066),
  [MuRIL paper arXiv 2103.10730](https://arxiv.org/abs/2103.10730),
  [google/muril-large-cased](https://huggingface.co/google/muril-large-cased) (17 langs + transliterated).
- Indic embedding eval (E5/BGE-M3 lead retrieval) — [arXiv 2601.10205](https://arxiv.org/html/2601.10205).
- LLMs struggle on low-resource Indic (why we cap at 14, Opus-verifiable) —
  [MILU, arXiv 2411.02538 (GPT-4o ~74%)](https://arxiv.org/html/2411.02538),
  [IndicParam, arXiv 2512.00333](https://arxiv.org/abs/2512.00333).

### Taxonomy & data
- MCC (ISO 18245) — [greggles/mcc-codes](https://github.com/greggles/mcc-codes).
- Plaid PFC — [migration guide](https://plaid.com/docs/transactions/pfc-migration).
- Foursquare categories — [FSQ docs](https://developer.foursquare.com/docs/categories);
  OS Places (Apache-2.0) — [HF foursquare/fsq-os-places](https://huggingface.co/datasets/foursquare/fsq-os-places).
- Overture Places — [overturemaps.org](https://docs.overturemaps.org/guides/places/).
- Wikidata (CC0) — [query.wikidata.org](https://query.wikidata.org).
- OSM Name Suggestion Index — [osmlab/name-suggestion-index](https://github.com/osmlab/name-suggestion-index).
- IndicTrans2 (NOT used in this plan, but the reference for 22-lang MT if ever
  needed) — [AI4Bharat/IndicTrans2](https://github.com/AI4Bharat/IndicTrans2).

### Transliteration
- `indic-transliteration` / Aksharamukha — script conversion across Indic
  scripts ↔ Latin (the free 14-language multiplier, doc 03).

### Compute
- Modal GPU pricing — [B200/H200 blog](https://modal.com/blog/introducing-b200-h200),
  [GPU types](https://modal.com/blog/gpu-types), [pricing](https://modal.com/pricing).

### Languages
- 22 scheduled languages — [Eighth Schedule](https://www.nextias.com/ca/current-affairs/05-08-2021/languages-in-eighth-schedule);
  speaker counts — [List of languages by speakers in India](https://en.wikipedia.org/wiki/List_of_languages_by_number_of_native_speakers_in_India).

> Note on dates: model versions and prices reflect the current releases as of
> authoring (2026). On a later rebuild, re-verify repo IDs, licenses, and prices;
> the architecture and method are version-agnostic.
