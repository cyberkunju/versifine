"""
MODAL · Phase 5 — evaluate the full retrieve→rerank pipeline on the held-out
messy eval set, exactly as the API will run it.

Pipeline under test (mirrors the runtime):
  1. bi-encoder embeds the query, cosine-search label embeddings → top-K
  2. cross-encoder reranks the K candidates → winner + score
  3. conformal gate: if winner score < threshold → "abstain" (Other/review)

Metrics:
  - bi-encoder top-1 / top-3 / top-K recall
  - reranked top-1 accuracy (the headline number)
  - accuracy on confident (non-abstained) predictions + coverage
  - per-group accuracy (where does it struggle?)

Writes eval_report.json to the Volume + prints a readable summary.

Run: modal run jobs/04_eval.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import modal

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from modal_app import VOLUME_ROOT, app, export_image, local_src, volume  # noqa: E402


@app.function(
    image=export_image,
    gpu=config.GPU_EXPORT,
    volumes={VOLUME_ROOT: volume},
    mounts=[local_src],
    timeout=60 * 60,
)
def evaluate() -> str:
    import numpy as np
    import pandas as pd
    import pyarrow.parquet as pq
    import torch
    from optimum.onnxruntime import ORTModelForFeatureExtraction, ORTModelForSequenceClassification
    from transformers import AutoTokenizer

    sys.path.insert(0, "/root/ModelEngines")
    from taxonomy.taxonomy import load as load_taxonomy  # noqa: E402

    tax = load_taxonomy()
    vol = Path(VOLUME_ROOT)
    bundle = vol / "bundle"

    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    label_sentences = json.loads((bundle / "label_sentences.json").read_text(encoding="utf-8"))
    leaf_keys = manifest["leaf_keys"]
    label_emb = np.load(bundle / "label_embeddings.npy")
    threshold = manifest["conformal_threshold"]
    group_of = {leaf.key: leaf.group_key for leaf in tax.leaves}

    bi = ORTModelForFeatureExtraction.from_pretrained(bundle / "biencoder", file_name="model_quantized.onnx")
    bi_tok = AutoTokenizer.from_pretrained(bundle / "biencoder")
    ce = ORTModelForSequenceClassification.from_pretrained(bundle / "crossencoder", file_name="model_quantized.onnx")
    ce_tok = AutoTokenizer.from_pretrained(bundle / "crossencoder")

    def embed(texts, prefix):
        vecs = []
        B = 128
        for i in range(0, len(texts), B):
            batch = [f"{prefix}{t}" for t in texts[i : i + B]]
            enc = bi_tok(batch, padding=True, truncation=True, max_length=config.BIENCODER_MAX_LEN, return_tensors="pt")
            out = bi(**enc)
            mask = enc["attention_mask"].unsqueeze(-1).float()
            mean = (out.last_hidden_state * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
            mean = torch.nn.functional.normalize(mean, p=2, dim=1)
            vecs.append(mean.detach().cpu().numpy())
        return np.vstack(vecs).astype("float32")

    df = pq.read_table(vol / "eval.parquet").to_pandas()
    # Optional hand-curated adversarial set (text, leaf, segment) — the real
    # exam (see docs/08-evaluation.md). Unioned in when present.
    hard_path = vol / "eval_hard.jsonl"
    segments: list[str] = []
    if hard_path.exists():
        import json as _json

        hard_rows = [
            _json.loads(line)
            for line in hard_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        hdf = pd.DataFrame(hard_rows)
        if not hdf.empty:
            df = pd.concat([df.assign(segment="synthetic"), hdf], ignore_index=True)
    if "segment" not in df.columns:
        df["segment"] = "synthetic"

    texts = df["text"].tolist()
    gold = df["leaf"].tolist()
    segments = df["segment"].fillna("synthetic").tolist()
    print(f"Eval rows: {len(texts)}")

    emb = embed(texts, "query: ")
    sims = emb @ label_emb.T
    K = config.RETRIEVE_TOP_K
    topk_idx = np.argsort(-sims, axis=1)[:, :K]

    bi_top1 = bi_top3 = bi_topk = 0
    rr_correct = 0
    confident_correct = confident_total = 0
    group_correct: dict = defaultdict(int)
    group_total: dict = defaultdict(int)
    seg_correct: dict = defaultdict(int)
    seg_total: dict = defaultdict(int)

    for i, gleaf in enumerate(gold):
        cand = [leaf_keys[j] for j in topk_idx[i]]
        if cand and cand[0] == gleaf:
            bi_top1 += 1
        if gleaf in cand[:3]:
            bi_top3 += 1
        if gleaf in cand:
            bi_topk += 1

        # rerank candidates with the cross-encoder
        pairs = [[texts[i], label_sentences[c]] for c in cand]
        enc = ce_tok([a for a, _ in pairs], [b for _, b in pairs],
                     padding=True, truncation=True, max_length=config.CROSSENCODER_MAX_LEN,
                     return_tensors="pt")
        logits = ce(**enc).logits.squeeze(-1)
        best = int(torch.as_tensor(logits).argmax().item())
        winner = cand[best]
        winner_sim = float(sims[i, topk_idx[i, best]])

        hit = winner == gleaf
        if hit:
            rr_correct += 1
        g = group_of.get(gleaf, "?")
        group_total[g] += 1
        if hit:
            group_correct[g] += 1
        seg = segments[i]
        seg_total[seg] += 1
        if hit:
            seg_correct[seg] += 1

        if winner_sim >= threshold:
            confident_total += 1
            if hit:
                confident_correct += 1

    n = len(texts)
    report = {
        "n": n,
        "bi_top1": bi_top1 / n,
        "bi_top3": bi_top3 / n,
        "bi_topk": bi_topk / n,
        "reranked_top1": rr_correct / n,
        "confident_accuracy": (confident_correct / confident_total) if confident_total else 0.0,
        "coverage": confident_total / n,
        "per_group": {
            g: group_correct[g] / group_total[g] for g in sorted(group_total)
        },
        "per_segment": {
            s: seg_correct[s] / seg_total[s] for s in sorted(seg_total)
        },
    }
    (bundle / "eval_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    volume.commit()

    print("\n=== EVAL REPORT ===")
    print(f"  bi-encoder    top1={report['bi_top1']:.3f}  top3={report['bi_top3']:.3f}  top{K}={report['bi_topk']:.3f}")
    print(f"  reranked      top1={report['reranked_top1']:.3f}   (headline accuracy)")
    print(f"  confident     acc={report['confident_accuracy']:.3f}  coverage={report['coverage']:.3f}")
    print("  per-group reranked top1:")
    for g, acc in report["per_group"].items():
        print(f"    {g:18} {acc:.3f}")
    print("  per-segment reranked top1:")
    for s, acc in report["per_segment"].items():
        print(f"    {s:18} {acc:.3f}")
    return json.dumps(report)


@app.local_entrypoint()
def main() -> None:
    report = evaluate.remote()
    print("\nEval complete.")

