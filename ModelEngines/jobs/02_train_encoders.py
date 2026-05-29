"""
MODAL · Phase 3 — train both encoders in ONE A100 function (one cold start).

Stage A — bi-encoder (multilingual-e5-small), contrastive:
  Anchor = transaction text, positive = its leaf's canonical label sentence,
  negatives = in-batch + hard negatives mined from the bi-encoder itself after
  a warmup epoch. MultipleNegativesRankingLoss with a large batch (A100-80GB
  fits 256+), so every other example in the batch is a negative for free.
  e5 needs the "query:"/"passage:" prefixes — we honour them.

Stage B — cross-encoder (mDeBERTa-v3-base), pairwise relevance:
  For each training text, take the top-K candidate leaves from the freshly
  trained bi-encoder, label the true leaf 1 and the rest 0, train a binary
  cross-encoder to score [text, leaf-description] pairs. This is the precision
  reranker that fixes the bi-encoder's hard-case mistakes.

Both write to the Volume:
  /vol/biencoder/    sentence-transformers model
  /vol/crossencoder/ cross-encoder model
  /vol/label_sentences.json  the per-leaf label sentence used as the "passage"

Run:  modal run jobs/02_train_encoders.py
      modal run jobs/02_train_encoders.py --smoke
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import modal

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from modal_app import VOLUME_ROOT, app, hf_secret, local_src, train_image, volume  # noqa: E402

TRAIN_TIMEOUT = 60 * 60 * 4  # 4h ceiling for both stages


@app.function(
    image=train_image,
    gpu=config.GPU_TRAIN,
    volumes={VOLUME_ROOT: volume},
    secrets=[hf_secret],
    mounts=[local_src],
    timeout=TRAIN_TIMEOUT,
)
def train(smoke: bool = False) -> str:
    import random

    import numpy as np
    import pandas as pd
    import pyarrow.parquet as pq
    import torch
    from sentence_transformers import (
        InputExample,
        SentenceTransformer,
        losses,
        models,
    )
    from sentence_transformers.cross_encoder import CrossEncoder
    from torch.utils.data import DataLoader

    sys.path.insert(0, "/root/ModelEngines")
    from taxonomy.taxonomy import load as load_taxonomy  # noqa: E402

    # ---- determinism (constraint N9): seed every RNG ----
    SEED = config.GLOBAL_SEED
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
    try:
        from transformers import set_seed as _hf_set_seed

        _hf_set_seed(SEED)
    except Exception:  # noqa: BLE001
        pass
    rng = random.Random(SEED)
    tax = load_taxonomy()
    vol = Path(VOLUME_ROOT)

    # ---- label sentences (the "passage" each leaf is retrieved by) ----------
    label_sentences: dict[str, str] = {}
    for leaf in tax.leaves:
        ex = ", ".join(list(leaf.examples)[:6])
        label_sentences[leaf.key] = f"{leaf.name} ({leaf.group_name}): {ex}"
    (vol / "label_sentences.json").write_text(
        json.dumps(label_sentences, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # ---- load training data -------------------------------------------------
    train_df = pq.read_table(vol / "train.parquet").to_pandas()
    if smoke:
        train_df = train_df.groupby("leaf", group_keys=False).head(200)
    print(f"Training rows: {len(train_df)}")

    device = "cuda" if torch.cuda.is_available() else "cpu"

    # ========================================================================
    # STAGE A — bi-encoder
    # ========================================================================
    print(f"\n=== Stage A: bi-encoder ({config.BIENCODER_BASE}) ===")
    word = models.Transformer(config.BIENCODER_BASE, max_seq_length=config.BIENCODER_MAX_LEN)
    pooling = models.Pooling(word.get_word_embedding_dimension(), pooling_mode="mean")
    bi = SentenceTransformer(modules=[word, pooling], device=device)

    # e5 prefix convention
    def q(text: str) -> str:
        return f"query: {text}"

    def p(text: str) -> str:
        return f"passage: {text}"

    # MNRL correctness: with only ~59 distinct positives (the label sentences),
    # a 256-row batch repeats positives many times, and MNRL treats every other
    # row's positive as a negative -> a row's TRUE label sentence appears as a
    # "negative" for same-leaf rows (false negatives), giving contradictory
    # gradients. Fix: a batch sampler that puts AT MOST ONE row per leaf in each
    # batch, so no positive collides. Batch size is therefore capped at the
    # number of leaves.
    rows_by_leaf: dict[str, list[str]] = {}
    for row in train_df.itertuples():
        if row.leaf in label_sentences:
            rows_by_leaf.setdefault(row.leaf, []).append(row.text)

    leaf_keys_all = sorted(rows_by_leaf.keys())
    batch_size = min(config.BIENCODER_BATCH, len(leaf_keys_all))

    # Build batches: each batch = distinct leaves, one (text, its label) pair.
    # We iterate epochs worth of batches by repeatedly sampling.
    examples: list[InputExample] = []
    # round-robin draw so every leaf contributes proportionally, distinct per batch
    pools = {k: list(v) for k, v in rows_by_leaf.items()}
    for v in pools.values():
        rng.shuffle(v)
    cursors = {k: 0 for k in leaf_keys_all}
    max_rows = max(len(v) for v in pools.values())
    ordered_leaves = list(leaf_keys_all)
    for _ in range(max_rows):
        rng.shuffle(ordered_leaves)
        for k in ordered_leaves:
            c = cursors[k]
            if c < len(pools[k]):
                text = pools[k][c]
                cursors[k] += 1
                examples.append(InputExample(texts=[q(text), p(label_sentences[k])]))

    # NoDuplicatesDataLoader guarantees no two rows in a batch share a positive
    # (it dedups by the texts), which combined with our per-leaf single-positive
    # construction removes the false-negative problem.
    from sentence_transformers.datasets import NoDuplicatesDataLoader

    loader = NoDuplicatesDataLoader(examples, batch_size=batch_size)
    loss = losses.MultipleNegativesRankingLoss(bi)
    epochs = 1 if smoke else config.BIENCODER_EPOCHS
    steps_per_epoch = max(1, len(examples) // batch_size)
    warmup = int(steps_per_epoch * epochs * config.BIENCODER_WARMUP_RATIO)
    bi.fit(
        train_objectives=[(loader, loss)],
        epochs=epochs,
        warmup_steps=warmup,
        optimizer_params={"lr": config.BIENCODER_LR},
        use_amp=True,
        show_progress_bar=True,
    )
    bi_dir = vol / "biencoder"
    bi.save(str(bi_dir))
    print(f"Saved bi-encoder -> {bi_dir}")

    # ========================================================================
    # STAGE B — cross-encoder reranker
    # ========================================================================
    print(f"\n=== Stage B: cross-encoder ({config.CROSSENCODER_BASE}) ===")
    # Build candidate sets: embed all label sentences once, retrieve top-K per
    # training row, make (text, label_sentence) pairs with binary labels.
    leaf_keys = list(label_sentences.keys())
    leaf_embs = bi.encode(
        [p(label_sentences[k]) for k in leaf_keys],
        batch_size=256,
        convert_to_tensor=True,
        normalize_embeddings=True,
        show_progress_bar=True,
    )

    # Subsample training rows for the cross-encoder (it's pairwise → heavier).
    ce_source = train_df.groupby("leaf", group_keys=False).head(
        50 if smoke else 4000
    )
    ce_texts = ce_source["text"].tolist()
    ce_leaves = ce_source["leaf"].tolist()
    text_embs = bi.encode(
        [q(t) for t in ce_texts],
        batch_size=256,
        convert_to_tensor=True,
        normalize_embeddings=True,
        show_progress_bar=True,
    )
    sims = text_embs @ leaf_embs.T  # cosine (normalized)
    topk = min(config.CROSSENCODER_CANDIDATES, len(leaf_keys))
    top_idx = sims.topk(topk, dim=1).indices.tolist()

    ce_examples: list[InputExample] = []
    for i, (text, true_leaf) in enumerate(zip(ce_texts, ce_leaves)):
        cand_idx = top_idx[i]
        # always include the true leaf as a positive
        true_pos = leaf_keys.index(true_leaf) if true_leaf in leaf_keys else None
        if true_pos is not None and true_pos not in cand_idx:
            cand_idx = cand_idx[:-1] + [true_pos]
        for j in cand_idx:
            leaf_key = leaf_keys[j]
            label = 1.0 if leaf_key == true_leaf else 0.0
            ce_examples.append(
                InputExample(texts=[text, label_sentences[leaf_key]], label=label)
            )
    rng.shuffle(ce_examples)
    print(f"Cross-encoder pairs: {len(ce_examples)}")

    ce = CrossEncoder(
        config.CROSSENCODER_BASE,
        num_labels=1,
        max_length=config.CROSSENCODER_MAX_LEN,
        device=device,
    )
    ce_loader = DataLoader(ce_examples, shuffle=True, batch_size=config.CROSSENCODER_BATCH)
    ce.fit(
        train_dataloader=ce_loader,
        epochs=1 if smoke else config.CROSSENCODER_EPOCHS,
        warmup_steps=int(len(ce_loader) * 0.1),
        optimizer_params={"lr": config.CROSSENCODER_LR},
        use_amp=True,
        show_progress_bar=True,
    )
    ce_dir = vol / "crossencoder"
    ce.save(str(ce_dir))
    print(f"Saved cross-encoder -> {ce_dir}")

    volume.commit()
    return f"biencoder={bi_dir} crossencoder={ce_dir}"


@app.local_entrypoint()
def main(smoke: bool = False) -> None:
    result = train.remote(smoke=smoke)
    print(f"Training complete: {result}")
    print("Next: modal run jobs/03_export_publish.py")

