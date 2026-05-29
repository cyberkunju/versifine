"""
Merge teacher/packs/*.jsonl into teacher/teacher_packs.jsonl, validated against
the taxonomy.

Checks (and reports):
  - every taxonomy leaf is covered exactly once
  - no unknown / duplicate leaf keys
  - each pack has non-empty templates / merchant_aliases / phrasings / code_mixed
  - templates only use the allowed slots ({merchant},{amount},{noise},{date})
  - within-pack dedup of each list

Usage:
  python teacher/merge.py            # merge + validate + write final
  python teacher/merge.py --check    # validate only, don't write
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from taxonomy.taxonomy import load as load_taxonomy  # noqa: E402

PACKS_DIR = Path(__file__).with_name("packs")
OUT_PATH = Path(__file__).with_name("teacher_packs.jsonl")

ALLOWED_SLOTS = {"merchant", "amount", "noise", "date"}
REQUIRED_LISTS = ("templates", "merchant_aliases", "phrasings", "code_mixed")
MIN_COUNTS = {"templates": 20, "merchant_aliases": 30, "phrasings": 15, "code_mixed": 10}


def _dedup(seq: list) -> list:
    seen: set[str] = set()
    out: list[str] = []
    for x in seq:
        s = str(x).strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def load_packs() -> dict[str, dict]:
    packs: dict[str, dict] = {}
    if not PACKS_DIR.exists():
        return packs
    for path in sorted(PACKS_DIR.glob("*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"  WARN: bad JSON in {path.name}: {exc}")
                continue
            leaf = obj.get("leaf")
            if not leaf:
                continue
            # clean + dedup the lists
            clean = {"leaf": leaf}
            for key in REQUIRED_LISTS:
                clean[key] = _dedup(obj.get(key, []) if isinstance(obj.get(key), list) else [])
            if leaf in packs:
                # merge duplicates across batches (union)
                for key in REQUIRED_LISTS:
                    clean[key] = _dedup(packs[leaf][key] + clean[key])
            packs[leaf] = clean
    return packs


def validate(packs: dict[str, dict], leaf_keys: set[str]) -> list[str]:
    problems: list[str] = []

    covered = set(packs.keys())
    missing = leaf_keys - covered
    extra = covered - leaf_keys
    if missing:
        problems.append(f"MISSING packs for {len(missing)} leaves: {sorted(missing)}")
    if extra:
        problems.append(f"UNKNOWN leaf keys (not in taxonomy): {sorted(extra)}")

    slot_re = re.compile(r"\{([a-zA-Z_]+)\}")
    for leaf, pack in packs.items():
        for key in REQUIRED_LISTS:
            n = len(pack.get(key, []))
            if n < MIN_COUNTS[key]:
                problems.append(f"{leaf}.{key}: only {n} (need >= {MIN_COUNTS[key]})")
        for tpl in pack.get("templates", []):
            for slot in slot_re.findall(tpl):
                if slot not in ALLOWED_SLOTS:
                    problems.append(f"{leaf}: template uses unknown slot {{{slot}}}: {tpl!r}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Merge + validate teacher packs")
    parser.add_argument("--check", action="store_true", help="validate only, don't write output")
    args = parser.parse_args()
    config.utf8_stdout()

    tax = load_taxonomy()
    leaf_keys = set(tax.leaf_keys)
    packs = load_packs()

    print(f"Loaded {len(packs)} packs from {PACKS_DIR}")
    problems = validate(packs, leaf_keys)
    if problems:
        print(f"\nVALIDATION: {len(problems)} problem(s):", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
    else:
        print("VALIDATION OK — all leaves covered, all lists sufficient.")

    if args.check:
        return 1 if problems else 0

    # write final (in taxonomy leaf order for stable diffs)
    with OUT_PATH.open("w", encoding="utf-8") as fh:
        for leaf in tax.leaf_keys:
            if leaf in packs:
                fh.write(json.dumps(packs[leaf], ensure_ascii=False) + "\n")
    total = {k: sum(len(p.get(k, [])) for p in packs.values()) for k in REQUIRED_LISTS}
    print(f"\nWrote {OUT_PATH} ({len(packs)} packs)")
    print("Totals:", total)
    if problems:
        print("\nNOTE: wrote despite problems above — fix them and re-run for a clean set.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
