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

    # ---- 3. conformal calibration ------------------------------------------
    print("Calibrating conformal abstention threshold...")
    threshold, coverage = _calibrate(vol, bi_model, bi_tok, label_emb, leaf_keys, embed)
    (bundle / "conformal.json").write_text(
        json.dumps({"threshold": threshold, "coverage": coverage,
                    "target": config.CONFORMAL_COVERAGE}, indent=2),
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
    model = ORTModel.from_pretrained(src, export=True)
    model.save_pretrained(dst)
    Tok.from_pretrained(src).save_pretrained(dst)
    quantizer = Quantizer.from_pretrained(dst)
    qconfig = QConf.avx512_vnni(is_static=False, per_channel=True)
    quantizer.quantize(save_dir=dst, quantization_config=qconfig)


def _export_quant_seqcls(src, dst, ORTModel, QConf, Quantizer, Tok):
    model = ORTModel.from_pretrained(src, export=True)
    model.save_pretrained(dst)
    Tok.from_pretrained(src).save_pretrained(dst)
    quantizer = Quantizer.from_pretrained(dst)
    qconfig = QConf.avx512_vnni(is_static=False, per_channel=True)
    quantizer.quantize(save_dir=dst, quantization_config=qconfig)


def _calibrate(vol, bi_model, bi_tok, label_emb, leaf_keys, embed):
    """Find the cosine-sim threshold where the true leaf is in the top-1 with
    CONFORMAL_COVERAGE probability, using the eval split as calibration."""
    import numpy as np
    import pyarrow.parquet as pq

    eval_path = vol / "eval.parquet"
    if not eval_path.exists():
        return float(config.CONFIDENCE_FLOOR), 0.0
    df = pq.read_table(eval_path).to_pandas().sample(frac=1.0, random_state=3).head(3000)
    texts = df["text"].tolist()
    leaves = df["leaf"].tolist()
    emb = embed(texts, "query: ")
    sims = emb @ label_emb.T
    top1_idx = sims.argmax(axis=1)
    top1_score = sims.max(axis=1)
    correct = np.array([leaf_keys[i] == lf for i, lf in zip(top1_idx, leaves)])

    # threshold = the score quantile below which we abstain to hit target
    # coverage among predictions we DO make.
    order = np.argsort(top1_score)
    # choose threshold so that retained predictions reach target accuracy
    target = config.CONFORMAL_COVERAGE
    best_thr = float(config.CONFIDENCE_FLOOR)
    for thr in np.quantile(top1_score, np.linspace(0.0, 0.9, 50)):
        kept = top1_score >= thr
        if kept.sum() == 0:
            continue
        acc = correct[kept].mean()
        if acc >= target:
            best_thr = float(thr)
            break
    coverage = float((top1_score >= best_thr).mean())
    print(f"  conformal threshold={best_thr:.3f} coverage={coverage:.3f}")
    return best_thr, coverage


@app.local_entrypoint()
def main(publish: bool = True) -> None:
    path = export_and_publish.remote(publish=publish)
    print(f"Export complete: {path}")
    print("Next: modal run jobs/04_eval.py")

