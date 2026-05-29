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
# ----------------------------------------------------------------------------

# (1) vLLM image for serving Gemma 4 31B-it (FP8).
vllm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "vllm==0.6.6",
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
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

# Mount the local taxonomy + config into every container so functions can read
# the label space without a round-trip to the volume.
local_src = modal.Mount.from_local_dir(
    config.ROOT,
    remote_path="/root/ModelEngines",
    condition=lambda p: (
        p.endswith(".py") or p.endswith(".json")
    )
    and "/data/" not in p
    and "/artifacts/" not in p,
)
