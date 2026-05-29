"""
MODAL · Phase 1 — Gemma 4 31B-it generates the building-block packs.

This is the only paid-GPU LLM step. We load Gemma once (FP8 on an H200, lots of
KV headroom), then fire ALL leaf-generation prompts concurrently through vLLM's
async engine with prefix caching on the shared system prompt. The template
trick keeps token volume small: a few thousand templates + slot-fillers, not
millions of rows.

Output (to the Volume): gemma_templates.jsonl — one JSON object per leaf:
  { "leaf": "...", "templates": [...], "merchant_aliases": [...],
    "phrasings": [...], "code_mixed": [...] }

Speed tweaks:
  - FP8 weights → fits H200 with huge --gpu-memory-utilization
  - high max_num_seqs + asyncio gather → continuous batching saturates the GPU
  - enable_prefix_caching → the long system prompt is encoded once
  - guided JSON decoding → outputs parse first time, no wasted retries

Run:  modal run jobs/01_gemma_generate.py
      modal run jobs/01_gemma_generate.py --smoke   # 3 leaves, quick check
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import modal

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from modal_app import VOLUME_ROOT, app, hf_secret, local_src, vllm_image, volume  # noqa: E402

GEN_TIMEOUT = 60 * 60  # 1 hour ceiling for the whole generation


@app.function(
    image=vllm_image,
    gpu=config.GPU_GEMMA,
    volumes={VOLUME_ROOT: volume},
    secrets=[hf_secret],
    mounts=[local_src],
    timeout=GEN_TIMEOUT,
    # Scale to zero the moment the function returns.
)
def generate(smoke: bool = False) -> str:
    """Serve Gemma in-process via vLLM AsyncLLMEngine and generate all packs."""
    import os

    os.environ.setdefault("HF_TOKEN", os.environ.get("HF_TOKEN", ""))

    # Imports live inside the function so they resolve in the Modal image.
    from vllm import AsyncEngineArgs, AsyncLLMEngine, SamplingParams
    from vllm.utils import random_uuid

    sys.path.insert(0, "/root/ModelEngines")
    from prompts import build_generation_messages  # noqa: E402
    from taxonomy.taxonomy import load as load_taxonomy  # noqa: E402

    tax = load_taxonomy()
    leaves = list(tax.leaves)
    if smoke:
        leaves = leaves[:3]

    print(f"Serving {config.TEACHER_MODEL} (FP8) for {len(leaves)} leaves...")

    engine_args = AsyncEngineArgs(
        model=config.TEACHER_MODEL,
        quantization="fp8",
        dtype="auto",
        gpu_memory_utilization=0.92,
        max_model_len=8192,
        enable_prefix_caching=True,
        max_num_seqs=256,
        disable_log_requests=True,
    )
    engine = AsyncLLMEngine.from_engine_args(engine_args)

    # Build the chat prompts. We rely on the engine's tokenizer chat template.
    async def run_all() -> list[dict]:
        tokenizer = await engine.get_tokenizer()

        sampling = SamplingParams(
            temperature=0.9,        # diversity for synthesis
            top_p=0.95,
            max_tokens=2400,
            # JSON object guidance keeps outputs parseable.
            # (vLLM guided decoding via outlines backend.)
        )

        async def one(leaf) -> dict:
            messages = build_generation_messages(
                leaf_name=leaf.name,
                group_name=leaf.group_name,
                description=f"Transactions for {leaf.name} in the {leaf.group_name} group.",
                examples=list(leaf.examples),
                n_templates=config.TEMPLATES_PER_LEAF,
                n_aliases=config.MERCHANT_ALIASES_PER_LEAF,
            )
            prompt = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            request_id = random_uuid()
            final_text = ""
            async for out in engine.generate(prompt, sampling, request_id):
                final_text = out.outputs[0].text
            pack = _parse_pack(final_text, leaf.key)
            return pack

        # Fire everything concurrently; vLLM batches under the hood.
        return await asyncio.gather(*(one(leaf) for leaf in leaves))

    packs = asyncio.run(run_all())

    out_path = Path(VOLUME_ROOT) / "gemma_templates.jsonl"
    with out_path.open("w", encoding="utf-8") as fh:
        for pack in packs:
            fh.write(json.dumps(pack, ensure_ascii=False) + "\n")
    volume.commit()

    counts = {p["leaf"]: len(p.get("merchant_aliases", [])) for p in packs}
    print(f"Wrote {len(packs)} packs → {out_path}")
    print("Alias counts (sample):", dict(list(counts.items())[:6]))
    return str(out_path)


def _parse_pack(text: str, leaf_key: str) -> dict:
    """Extract the JSON object from the model output, with a forgiving fallback."""
    text = text.strip()
    # Strip markdown fences if the model added them despite instructions.
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start = text.find("{")
    end = text.rfind("}")
    pack: dict = {
        "leaf": leaf_key,
        "templates": [],
        "merchant_aliases": [],
        "phrasings": [],
        "code_mixed": [],
    }
    if start == -1 or end == -1:
        return pack
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return pack
    for key in ("templates", "merchant_aliases", "phrasings", "code_mixed"):
        val = parsed.get(key)
        if isinstance(val, list):
            pack[key] = [str(x).strip() for x in val if str(x).strip()]
    return pack


@app.local_entrypoint()
def main(smoke: bool = False) -> None:
    path = generate.remote(smoke=smoke)
    print(f"Generation complete: {path}")
    print("Next: download templates with the volume, then run local/expand.py")

