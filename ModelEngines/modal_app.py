"""
Modal app definition — shared images, volume, and secret for every GPU phase.

Import `app`, the images, `volume`, and `hf_secret` from here in the
modal/*.py functions. Keeping them in one place means one Volume holds the
whole pipeline's intermediate state, and the heavy images are built once and
cached.

Setup (one time):
  modal token new
  modal secret create huggingface HF_TOKEN=hf_xxxxxxxx
"""
from __future__ import annotations

import os

import modal

import config

app = modal.App(config.MODAL_APP_NAME)

# Persistent volume: datasets in, trained weights + onnx out. Survives between
# runs so re-runs skip re-download and re-generation.
volume = modal.Volume.from_name(config.MODAL_VOLUME, create_if_missing=True)
VOLUME_ROOT = "/vol"

# HF token for pulling gated bases (gemma) and pushing the final repo.
hf_secret = modal.Secret.from_name(config.HF_SECRET_NAME)

# ----------------------------------------------------------------------------
# Images. Three flavours so a phase only pays for what it needs.
#
# Two correctness rules learned the hard way:
#   - If HF_HUB_ENABLE_HF_TRANSFER=1, the `hf_transfer` package MUST be
#     installed or every model download hard-fails with an ImportError. We
#     install it everywhere it's enabled.
#   - mDeBERTa-v3 (DebertaV2 / SentencePiece) needs `sentencepiece` + `protobuf`
#     to build its tokenizer; missing them breaks AutoTokenizer at load.
# ----------------------------------------------------------------------------

# (1) vLLM image for serving the Gemma teacher (FP8).
#
# IMPORTANT: the vLLM version MUST support the chosen Gemma 4 architecture.
# vLLM 0.6.x (Dec-2024) predates Gemma 4 and CANNOT load it. Pin a vLLM release
# that lists Gemma 4 support in its release notes; verify with `--smoke` before
# a full run. We pin a recent line and keep it overridable.
VLLM_VERSION = os.environ.get("VERSIFINE_VLLM_VERSION", "0.11.0")
vllm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        f"vllm=={VLLM_VERSION}",
        "hf_transfer==0.1.8",
        "huggingface-hub==0.27.0",
        "orjson==3.10.12",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "VLLM_WORKER_MULTIPROC_METHOD": "spawn"})
)

# (2) Training image: torch + sentence-transformers + transformers.
train_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "torch==2.5.1",
        "sentence-transformers==3.3.1",
        "transformers==4.47.1",
        "accelerate==1.2.1",
        "datasets==3.2.0",
        "scikit-learn==1.6.0",
        "pyarrow==18.1.0",
        "pandas==2.2.3",
        "huggingface-hub==0.27.0",
        "hf_transfer==0.1.8",
        "sentencepiece==0.2.0",
        "protobuf==5.29.2",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

# (3) Export image: optimum + onnxruntime for ONNX + INT8 quant.
export_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "torch==2.5.1",
        "transformers==4.47.1",
        "sentence-transformers==3.3.1",
        "optimum[onnxruntime]==1.23.3",
        "onnx==1.17.0",
        "onnxruntime==1.20.1",
        "scikit-learn==1.6.0",
        "pyarrow==18.1.0",
        "pandas==2.2.3",
        "huggingface-hub==0.27.0",
        "hf_transfer==0.1.8",
        "sentencepiece==0.2.0",
        "protobuf==5.29.2",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

# Mount the local taxonomy + config into every container so functions can read
# the label space without a round-trip to the volume.
#
# The condition runs on the LOCAL host (Windows here), so paths use the local
# separator. We normalize to forward-slashes before the substring excludes,
# otherwise 'data/' / 'artifacts/' never match on Windows backslash paths.
def _include_in_mount(p: str) -> bool:
    norm = p.replace("\\", "/")
    if "/data/" in norm or "/artifacts/" in norm or "/__pycache__/" in norm:
        return False
    return norm.endswith(".py") or norm.endswith(".json")


local_src = modal.Mount.from_local_dir(
    config.ROOT,
    remote_path="/root/ModelEngines",
    condition=_include_in_mount,
)
