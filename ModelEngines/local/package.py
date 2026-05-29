"""
LAPTOP · Phase 6 — pull the finished model bundle into the repo so the API and
the web app can load it.

Two sources, in order of preference:
  1. the published HF repo (config.HF_REPO) — works anywhere
  2. a local copy already in artifacts/bundle (if you `modal volume get` it)

Destinations:
  apps/api/src/ml/model-v2/      ← API loads from here (server-side ONNX runtime)
  apps/web/static/models/v2/     ← web Privacy Mode loads from here (browser)

Only the runtime-needed files are copied (no training leftovers):
  biencoder/ crossencoder/ label_sentences.json label_embeddings.npy
  example_bank.parquet conformal.json manifest.json eval_report.json

Usage:
  python local/package.py                 # pull from HF, install to both targets
  python local/package.py --from-volume   # use artifacts/bundle instead of HF
  python local/package.py --api-only
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402

REPO_ROOT = config.ROOT.parent
API_DEST = REPO_ROOT / "apps" / "api" / "src" / "ml" / "model-v2"
WEB_DEST = REPO_ROOT / "apps" / "web" / "static" / "models" / "v2"

RUNTIME_FILES = [
    "label_sentences.json",
    "label_embeddings.npy",
    "example_bank.parquet",
    "conformal.json",
    "manifest.json",
    "eval_report.json",
]
RUNTIME_DIRS = ["biencoder", "crossencoder"]


def fetch_from_hf(dest: Path) -> Path:
    from huggingface_hub import snapshot_download

    print(f"Downloading {config.HF_REPO} from HF...")
    path = snapshot_download(repo_id=config.HF_REPO, repo_type="model", local_dir=str(dest))
    return Path(path)


def install(bundle: Path, dest: Path, web: bool) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for f in RUNTIME_FILES:
        src = bundle / f
        if src.exists():
            shutil.copy2(src, dest / f)
    for d in RUNTIME_DIRS:
        src = bundle / d
        if not src.exists():
            continue
        target = dest / d
        if target.exists():
            shutil.rmtree(target)
        # web only needs the quantized onnx + tokenizer; API can use either
        shutil.copytree(src, target)
    print(f"  installed → {dest}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Install the model bundle into the repo")
    parser.add_argument("--from-volume", action="store_true",
                        help="use artifacts/bundle instead of downloading from HF")
    parser.add_argument("--api-only", action="store_true")
    parser.add_argument("--web-only", action="store_true")
    args = parser.parse_args()
    config.utf8_stdout()

    config.ensure_dirs()
    if args.from_volume:
        bundle = config.ARTIFACT_DIR / "bundle"
        if not bundle.exists():
            print(f"No bundle at {bundle}. Run `modal volume get {config.MODAL_VOLUME} "
                  f"bundle {bundle}` first, or drop --from-volume to pull from HF.",
                  file=sys.stderr)
            return 1
    else:
        bundle = fetch_from_hf(config.ARTIFACT_DIR / "hf_bundle")

    if not args.web_only:
        print("Installing to API...")
        install(bundle, API_DEST, web=False)
    if not args.api_only:
        print("Installing to web...")
        install(bundle, WEB_DEST, web=True)

    print("\nDone. The categorizer-v2 bundle is in the repo.")
    print("Remember: these artifacts are gitignored by default — decide whether")
    print("to commit them or have the deploy pull from HF (recommended).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
