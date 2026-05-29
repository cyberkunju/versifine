"""
MODAL · Phase 4 — export the deployable bundle, calibrate, and publish.

Steps:
  1. Export bi-encoder + cross-encoder to ONNX, INT8-quantize (dynamic).
  2. Pre-compute the example-bank embeddings with the ONNX bi-encoder and store
     them so the API can load a ready vector index (no cold compute on boot).
  3. Conformal calibration: on a calibration split, find the score threshold
     that hits CONFORMAL_COVERAGE — the abstention gate the API uses to decide
     "confident enough vs flag for review".
  4. Write manifest.json (labels, thresholds, runtime knobs, provenance).
  5. Push the whole bundle to the HF repo + commit to the Volume.

Output bundle (Volume /vol/bundle and HF repo):
  biencoder.onnx, crossencoder.onnx, tokenizer files,
  label_sentences.json, label_embeddings.npy, example_bank.parquet,
  conformal.json, manifest.json

Run: modal run jobs/03_export_publish.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import modal

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from modal_app import VOLUME_ROOT, app, export_image, hf_secret, local_src, volume  # noqa: E402

EXPORT_TIMEOUT = 60 * 60 * 2


@app.function(
    image=export_image,
    gpu=config.GPU_EXPORT,
    volumes={VOLUME_ROOT: volume},
    secrets=[hf_secret],
    mounts=[local_src],
    timeout=EXPORT_TIMEOUT,
)
def export_and_publish(publish: bool = True) -> str:
    import os

    import numpy as np
    import pyarrow.parquet as pq
    from optimum.onnxruntime import ORTModelForFeatureExtraction, ORTModelForSequenceClassification
    from optimum.onnxruntime.configuration import AutoQuantizationConfig
    from optimum.onnxruntime import ORTQuantizer
    from transformers import AutoTokenizer

    sys.path.insert(0, "/root/ModelEngines")
    from taxonomy.taxonomy import load as load_taxonomy  # noqa: E402

    tax = load_taxonomy()
    vol = Path(VOLUME_ROOT)
    bundle = vol / "bundle"
    bundle.mkdir(parents=True, exist_ok=True)

    label_sentences = json.loads((vol / "label_sentences.json").read_text(encoding="utf-8"))
    leaf_keys = list(label_sentences.keys())

    # ---- 1. ONNX export + INT8 dynamic quant -------------------------------
    print("Exporting bi-encoder to ONNX + INT8...")
    bi_src = str(vol / "biencoder")
    bi_onnx = bundle / "biencoder"
    _export_quant_feature(bi_src, bi_onnx, ORTModelForFeatureExtraction, AutoQuantizationConfig, ORTQuantizer, AutoTokenizer)

    print("Exporting cross-encoder to ONNX + INT8...")
    ce_src = str(vol / "crossencoder")
    ce_onnx = bundle / "crossencoder"
    _export_quant_seqcls(ce_src, ce_onnx, ORTModelForSequenceClassification, AutoQuantizationConfig, ORTQuantizer, AutoTokenizer)

    # ---- 2. label + example-bank embeddings (ONNX bi-encoder) --------------
    print("Embedding label sentences + example bank with ONNX bi-encoder...")
    bi_model = ORTModelForFeatureExtraction.from_pretrained(bi_onnx, file_name="model_quantized.onnx")
    bi_tok = AutoTokenizer.from_pretrained(bi_onnx)

    def embed(texts: list[str], prefix: str) -> np.ndarray:
        import torch

        vecs = []
        B = 256
        for i in range(0, len(texts), B):
            batch = [f"{prefix}{t}" for t in texts[i : i + B]]
            enc = bi_tok(batch, padding=True, truncation=True, max_length=config.BIENCODER_MAX_LEN, return_tensors="pt")
            out = bi_model(**enc)
            # mean pooling
            tok_emb = out.last_hidden_state
            mask = enc["attention_mask"].unsqueeze(-1).float()
            summed = (tok_emb * mask).sum(1)
            counts = mask.sum(1).clamp(min=1e-9)
            mean = summed / counts
            mean = torch.nn.functional.normalize(mean, p=2, dim=1)
            vecs.append(mean.detach().cpu().numpy())
        return np.vstack(vecs).astype("float32")

    label_emb = embed([label_sentences[k] for k in leaf_keys], "passage: ")
    np.save(bundle / "label_embeddings.npy", label_emb)
    (bundle / "label_sentences.json").write_text(
        json.dumps(label_sentences, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # copy example bank (clean canonical phrases) for the flywheel seed
    bank_path = vol / "example_bank.parquet"
    if bank_path.exists():
        bank = pq.read_table(bank_path)
        pq.write_table(bank, bundle / "example_bank.parquet")

    # ---- 3. conformal-style calibration (on the CALIB split, not eval) ------
    print("Calibrating abstention threshold on the held-out calib split...")
    ce_model = ORTModelForSequenceClassification.from_pretrained(
        ce_onnx, file_name="model_quantized.onnx"
    )
    ce_tok = AutoTokenizer.from_pretrained(ce_onnx)
    threshold, retained_acc, coverage = _calibrate(
        vol, bi_model, bi_tok, ce_model, ce_tok, label_emb, label_sentences, leaf_keys, embed
    )
    (bundle / "conformal.json").write_text(
        json.dumps(
            {
                "threshold": threshold,
                "retained_accuracy": retained_acc,
                "coverage": coverage,
                "accuracy_target": config.CALIB_ACCURACY_TARGET,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    # ---- 4. manifest -------------------------------------------------------
    manifest = {
        "version": "2.0.0",
        "biencoder_base": config.BIENCODER_BASE,
        "crossencoder_base": config.CROSSENCODER_BASE,
        "teacher": config.TEACHER_MODEL,
        "leaf_keys": leaf_keys,
        "leaf_names": {leaf.key: leaf.name for leaf in tax.leaves},
        "legacy_map": {leaf.key: leaf.legacy for leaf in tax.leaves},
        "kind_map": {leaf.key: leaf.kind for leaf in tax.leaves},
        "retrieve_top_k": config.RETRIEVE_TOP_K,
        "conformal_threshold": threshold,
        "conformal_retained_accuracy": retained_acc,
        "conformal_coverage": coverage,
        "confidence_floor": config.CONFIDENCE_FLOOR,
        "languages": list(config.LANGUAGES),
    }
    (bundle / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    volume.commit()
    print(f"Bundle written → {bundle}")

    # ---- 5. publish to HF --------------------------------------------------
    if publish and os.environ.get("HF_TOKEN"):
        try:
            from huggingface_hub import HfApi

            api = HfApi(token=os.environ["HF_TOKEN"])
            api.create_repo(config.HF_REPO, exist_ok=True, repo_type="model")
            api.upload_folder(folder_path=str(bundle), repo_id=config.HF_REPO, repo_type="model")
            print(f"Published → https://huggingface.co/{config.HF_REPO}")
        except Exception as exc:  # noqa: BLE001
            print(f"HF publish failed (bundle still on Volume): {exc}")
    else:
        print("Skipping HF publish (no token or --no-publish).")

    return str(bundle)


def _export_quant_feature(src, dst, ORTModel, QConf, Quantizer, Tok):
    import shutil

    # Clear any prior export so the quantizer doesn't see multiple .onnx files
    # on a re-run (the Volume persists between runs).
    if Path(dst).exists():
        shutil.rmtree(dst)
    model = ORTModel.from_pretrained(src, export=True)
    model.save_pretrained(dst)
    Tok.from_pretrained(src).save_pretrained(dst)
    quantizer = Quantizer.from_pretrained(dst)
    qconfig = QConf.avx512_vnni(is_static=False, per_channel=True)
    quantizer.quantize(save_dir=dst, quantization_config=qconfig)
    # Drop the fp32 model.onnx so only the INT8 file ships.
    _drop_fp32_onnx(dst)


def _export_quant_seqcls(src, dst, ORTModel, QConf, Quantizer, Tok):
    import shutil

    if Path(dst).exists():
        shutil.rmtree(dst)
    model = ORTModel.from_pretrained(src, export=True)
    model.save_pretrained(dst)
    Tok.from_pretrained(src).save_pretrained(dst)
    quantizer = Quantizer.from_pretrained(dst)
    qconfig = QConf.avx512_vnni(is_static=False, per_channel=True)
    quantizer.quantize(save_dir=dst, quantization_config=qconfig)
    _drop_fp32_onnx(dst)


def _drop_fp32_onnx(dst):
    """Remove the unquantized model.onnx (+ external data) so the bundle ships
    only model_quantized.onnx. Keeps the repo small and unambiguous."""
    d = Path(dst)
    for name in ("model.onnx", "model.onnx_data", "model.onnx.data"):
        f = d / name
        if f.exists():
            try:
                f.unlink()
            except OSError:
                pass


def _calibrate(vol, bi_model, bi_tok, ce_model, ce_tok, label_emb, label_sentences, leaf_keys, embed):
    """Calibrate the abstention threshold on the held-out CALIB split, running
    the EXACT runtime pipeline (bi-encoder retrieve -> cross-encoder rerank ->
    gate on the reranked winner's bi-encoder cosine). This makes the calibrated
    score identical to what the API/eval gate on. Returns
    (threshold, retained_accuracy, coverage). Lowest threshold whose retained
    predictions reach CALIB_ACCURACY_TARGET accuracy (maximises coverage)."""
    import numpy as np
    import pyarrow.parquet as pq
    import torch

    calib_path = vol / "calib.parquet"
    if not calib_path.exists():
        # fall back to a slice of eval only if calib is absent (degraded)
        calib_path = vol / "eval.parquet"
    if not calib_path.exists():
        return float(config.CONFIDENCE_FLOOR), 0.0, 0.0

    df = pq.read_table(calib_path).to_pandas()
    df = df.sample(frac=1.0, random_state=config.GLOBAL_SEED).head(3000)
    texts = df["text"].tolist()
    gold = df["leaf"].tolist()
    if not texts:
        return float(config.CONFIDENCE_FLOOR), 0.0, 0.0

    emb = embed(texts, "query: ")
    sims = emb @ label_emb.T
    K = min(config.RETRIEVE_TOP_K, len(leaf_keys))
    topk_idx = np.argsort(-sims, axis=1)[:, :K]

    winner_scores = []
    correct = []
    for i, gleaf in enumerate(gold):
        cand = [leaf_keys[j] for j in topk_idx[i]]
        pairs_a = [texts[i]] * len(cand)
        pairs_b = [label_sentences[c] for c in cand]
        enc = ce_tok(pairs_a, pairs_b, padding=True, truncation=True,
                     max_length=config.CROSSENCODER_MAX_LEN, return_tensors="pt")
        logits = ce_model(**enc).logits.squeeze(-1)
        best = int(torch.as_tensor(logits).argmax().item())
        winner = cand[best]
        winner_scores.append(float(sims[i, topk_idx[i, best]]))
        correct.append(winner == gleaf)

    winner_scores = np.array(winner_scores)
    correct = np.array(correct)
    target = config.CALIB_ACCURACY_TARGET
    best_thr = float(config.CONFIDENCE_FLOOR)
    best_acc = 0.0
    for thr in np.quantile(winner_scores, np.linspace(0.0, 0.95, 60)):
        thr = float(max(thr, config.CONFIDENCE_FLOOR))
        kept = winner_scores >= thr
        if kept.sum() == 0:
            continue
        acc = float(correct[kept].mean())
        if acc >= target:
            best_thr = thr
            best_acc = acc
            break
        best_acc = acc  # track last seen
    coverage = float((winner_scores >= best_thr).mean())
    retained_acc = float(correct[winner_scores >= best_thr].mean()) if (winner_scores >= best_thr).any() else 0.0
    print(f"  threshold={best_thr:.3f} retained_acc={retained_acc:.3f} coverage={coverage:.3f}")
    return best_thr, retained_acc, coverage


@app.local_entrypoint()
def main(publish: bool = True) -> None:
    path = export_and_publish.remote(publish=publish)
    print(f"Export complete: {path}")
    print("Next: modal run jobs/04_eval.py")

