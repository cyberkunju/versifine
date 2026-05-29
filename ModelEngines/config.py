"""
Single source of configuration: paths, model ids, hyperparameters, and the
data-mix knobs. Both the laptop scripts and the Modal functions import from
here so nothing drifts.

Anything environment-specific (HF token, Modal volume names) is read from env
with sane defaults; everything else is a constant we version-control.
"""
from __future__ import annotations

import os
from pathlib import Path

# ----------------------------------------------------------------------------
# Paths (local). Modal functions remap DATA_DIR/ARTIFACT_DIR onto a Volume.
# ----------------------------------------------------------------------------
ROOT = Path(__file__).parent
DATA_DIR = Path(os.environ.get("VERSIFINE_DATA_DIR", ROOT / "data"))
ARTIFACT_DIR = Path(os.environ.get("VERSIFINE_ARTIFACT_DIR", ROOT / "artifacts"))
TAXONOMY_DIR = ROOT / "taxonomy"

# Intermediate dataset files (parquet/jsonl) produced along the pipeline.
HARVEST_PAIRS = DATA_DIR / "harvest_pairs.parquet"       # merchant/POI → leaf (deterministic)
GEMMA_TEMPLATES = DATA_DIR / "gemma_templates.jsonl"     # LLM-generated templates + slot-fillers
GEMMA_VERIFY = DATA_DIR / "gemma_verify.jsonl"           # self-consistency tail decisions
EXPANDED_TRAIN = DATA_DIR / "train.parquet"              # exploded, labeled, deduped
EXPANDED_EVAL = DATA_DIR / "eval.parquet"                # held-out NATURAL rows (no template fills)
EXPANDED_CALIB = DATA_DIR / "calib.parquet"              # held-out calibration split (≠ eval)
EXAMPLE_BANK = DATA_DIR / "example_bank.parquet"         # per-leaf canonical phrases (runtime)

# Global RNG seed. EVERY randomized step (expand, training, sampling) seeds from
# this so the whole build is reproducible (constraint N9).
GLOBAL_SEED = 20260529

# ----------------------------------------------------------------------------
# Models
# ----------------------------------------------------------------------------
# The only LLM used anywhere in the pipeline (generation + verify). Apache-2.0.
TEACHER_MODEL = os.environ.get("VERSIFINE_TEACHER", "google/gemma-4-31B-it")

# Bi-encoder: small + multilingual + browser-friendly (~30 MB INT8 ONNX).
BIENCODER_BASE = os.environ.get("VERSIFINE_BIENCODER", "intfloat/multilingual-e5-small")

# Cross-encoder reranker: best accuracy/size for multilingual short-text pairs.
CROSSENCODER_BASE = os.environ.get("VERSIFINE_CROSSENCODER", "microsoft/mdeberta-v3-base")

# Where the finished bundle is published.
HF_REPO = os.environ.get("VERSIFINE_HF_REPO", "CyberKunju/versifine-categorizer-v2")

# ----------------------------------------------------------------------------
# Languages we target (BCP-47-ish short codes). Synthesis covers all of these,
# including code-mixed (e.g. Hinglish, Manglish).
# ----------------------------------------------------------------------------
LANGUAGES = ("en", "hi", "ml", "ta", "te", "kn")
CODE_MIXED = True  # generate Latin-script code-mixed variants too

# ----------------------------------------------------------------------------
# Data-mix targets (rows). Tuned so the laptop expansion stays under ~2 GB and
# training fits a single GPU comfortably.
# ----------------------------------------------------------------------------
TARGET_TRAIN_ROWS = 1_500_000
TARGET_EVAL_ROWS = 4_000
# Per-leaf floor/ceiling so rare categories aren't starved and common ones
# don't dominate (class balancing happens at expansion time).
MIN_ROWS_PER_LEAF = 6_000
MAX_ROWS_PER_LEAF = 60_000

# How many templates / slot-fillers Gemma should produce per leaf.
TEMPLATES_PER_LEAF = 40
MERCHANT_ALIASES_PER_LEAF = 60
NOISE_TOKENS_PER_LANG = 50

# ----------------------------------------------------------------------------
# Bi-encoder training (contrastive, in-batch negatives + hard negatives).
# ----------------------------------------------------------------------------
BIENCODER_EPOCHS = 3
BIENCODER_BATCH = 256            # big batch helps contrastive; A100-80GB fits this
BIENCODER_LR = 2e-5
BIENCODER_MAX_LEN = 64           # transaction strings are short
BIENCODER_WARMUP_RATIO = 0.1
HARD_NEGATIVES_PER_ANCHOR = 4

# ----------------------------------------------------------------------------
# Cross-encoder training (pairwise: [query, candidate-leaf] → relevance).
# ----------------------------------------------------------------------------
CROSSENCODER_EPOCHS = 2
CROSSENCODER_BATCH = 64
CROSSENCODER_LR = 1e-5
CROSSENCODER_MAX_LEN = 96
CROSSENCODER_CANDIDATES = 8      # top-k from the bi-encoder fed to the reranker

# ----------------------------------------------------------------------------
# Runtime knobs (exported into manifest.json so the API stays in sync).
# ----------------------------------------------------------------------------
RETRIEVE_TOP_K = 8               # candidates the bi-encoder hands the reranker
# Abstention gate: we keep predictions whose gate score clears a threshold
# chosen so that RETAINED predictions reach at least CALIB_ACCURACY_TARGET
# accuracy on a held-out calibration split. (This is an accuracy floor, not a
# coverage guarantee — named precisely to avoid the earlier 'coverage'
# misnomer.) The gate score is the BI-ENCODER cosine of the reranked winner,
# and calibration MUST be computed on that exact quantity (not bi top-1) so
# calibration and runtime agree.
CALIB_ACCURACY_TARGET = 0.95     # retained-prediction accuracy floor
CONFIDENCE_FLOOR = 0.45          # hard floor below which we always abstain
CALIB_FRACTION = 0.5             # fraction of the held-out natural rows used for calibration (rest = eval)

# ----------------------------------------------------------------------------
# Modal
# ----------------------------------------------------------------------------
MODAL_APP_NAME = "versifine-categorizer"
MODAL_VOLUME = os.environ.get("VERSIFINE_MODAL_VOLUME", "versifine-categorizer-vol")
HF_SECRET_NAME = "huggingface"   # `modal secret create huggingface HF_TOKEN=...`

# GPU choices per phase (string → Modal gpu spec).
GPU_GEMMA = os.environ.get("VERSIFINE_GPU_GEMMA", "H200")
GPU_TRAIN = os.environ.get("VERSIFINE_GPU_TRAIN", "A100-80GB")
GPU_EXPORT = os.environ.get("VERSIFINE_GPU_EXPORT", "L4")


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


def utf8_stdout() -> None:
    """Force UTF-8 stdout/stderr so unicode (₹, →, …) prints on the Windows
    cp1252 console without crashing. No-op where already UTF-8."""
    import sys

    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except Exception:  # noqa: BLE001
                pass
