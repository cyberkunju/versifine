"""
LAPTOP · Phase 2 — explode Gemma's packs + harvested merchants into the full
labeled training set. Pure CPU string work, free, runs in minutes.

Inputs (from the Volume / data dir):
  data/gemma_templates.jsonl   per-leaf templates + aliases + phrasings + code_mixed
  data/harvest_pairs.parquet   deterministic merchant→leaf pairs

For each leaf we synthesize rows by:
  - filling templates with {merchant} (alias or harvested), {amount}, {noise},
    {date} drawn from realistic Indian distributions
  - including the raw phrasings + code_mixed lines as-is and lightly perturbed
  - including harvested merchant names wrapped in UPI/POS noise

Then we apply realism transforms (typos, casing, spacing, amount formats),
balance per-leaf counts between MIN/MAX, dedup, shuffle, and split off a
held-out eval set. Output:
  data/train.parquet      (text, leaf)
  data/eval.parquet       (text, leaf)
  data/example_bank.parquet (leaf, text)  — clean canonical phrases for runtime kNN

Determinism: seeded RNG so re-runs are reproducible.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from taxonomy.taxonomy import load as load_taxonomy  # noqa: E402

RNG = random.Random(20260529)

GEMMA_TEMPLATES = config.DATA_DIR / "gemma_templates.jsonl"

# --- realistic slot-fillers (India-first) ---------------------------------
AMOUNT_FORMATS = [
    lambda a: f"₹{a}",
    lambda a: f"Rs.{a}",
    lambda a: f"Rs {a}",
    lambda a: f"INR {a}",
    lambda a: f"{a}/-",
    lambda a: f"{a}",
    lambda a: f"{a}.00",
]

NOISE_TOKENS = [
    "", "", "", "",  # weight toward no noise
    "UPI", "POS", "NEFT", "IMPS", "ATM", "AutoPay",
    "@ybl", "@okaxis", "@paytm", "MUMBAI", "BLR", "DEL", "HYD",
    "txn", "ref", "8821", "4521", "#INV", "online", "paid via gpay",
]

DATE_TOKENS = ["", "", "today", "yesterday", "on 01/06", "last monday", "2 days ago"]


def amount_sample(leaf_key: str) -> str:
    # rough per-domain amount ranges so numbers look plausible
    lo, hi = 30, 5000
    if leaf_key in {"rent", "mortgage_home_loan", "salary", "investments", "education", "flights", "loan_emi"}:
        lo, hi = 5000, 120000
    elif leaf_key in {"coffee_beverages", "fast_food", "public_transit", "convenience", "parking_tolls"}:
        lo, hi = 10, 500
    val = RNG.randint(lo, hi)
    return RNG.choice(AMOUNT_FORMATS)(val)


def apply_typos(text: str) -> str:
    """Occasionally introduce a realistic typo/casing/spacing perturbation."""
    r = RNG.random()
    if r < 0.12 and len(text) > 4:
        i = RNG.randrange(len(text) - 1)
        text = text[:i] + text[i + 1] + text[i] + text[i + 2 :]  # swap two chars
    elif r < 0.20:
        text = text.lower()
    elif r < 0.26:
        text = text.upper()
    elif r < 0.32:
        text = text.replace(" ", "", 1)  # drop a space
    return text


def fill_template(tpl: str, merchants: list[str], leaf_key: str) -> str:
    out = tpl
    if "{merchant}" in out:
        out = out.replace("{merchant}", RNG.choice(merchants) if merchants else "store")
    if "{amount}" in out:
        out = out.replace("{amount}", amount_sample(leaf_key))
    if "{noise}" in out:
        out = out.replace("{noise}", RNG.choice(NOISE_TOKENS))
    if "{date}" in out:
        out = out.replace("{date}", RNG.choice(DATE_TOKENS))
    return " ".join(out.split()).strip()


def upi_wrap(name: str) -> str:
    """Wrap a merchant name in plausible UPI/POS statement noise."""
    style = RNG.random()
    handle = RNG.choice(["@ybl", "@okaxis", "@paytm", "@oksbi", "@ibl"])
    ref = RNG.randint(1000, 99999)
    city = RNG.choice(["MUMBAI", "BLR", "DEL", "HYD", "PUNE", "CHN"])
    slug = name.lower().replace(" ", "")
    if style < 0.3:
        return f"UPI/{slug}/{ref}{handle}/{city}"
    if style < 0.5:
        return f"POS {ref} {name} {city}"
    if style < 0.65:
        return f"{name} {amount_sample('x')}"
    return name


def load_packs() -> dict[str, dict]:
    packs: dict[str, dict] = {}
    if not GEMMA_TEMPLATES.exists():
        print(f"WARN: {GEMMA_TEMPLATES} not found — using taxonomy examples only.")
        return packs
    with GEMMA_TEMPLATES.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "leaf" in obj:
                packs[obj["leaf"]] = obj
    return packs


def load_harvest_by_leaf() -> dict[str, list[str]]:
    out: dict[str, list[str]] = defaultdict(list)
    if not config.HARVEST_PAIRS.exists():
        print(f"WARN: {config.HARVEST_PAIRS} not found — synthesis only.")
        return out
    table = pq.read_table(config.HARVEST_PAIRS)
    texts = table.column("text").to_pylist()
    leaves = table.column("leaf").to_pylist()
    for t, leaf in zip(texts, leaves):
        out[leaf].append(t)
    return out


def synth_for_leaf(leaf_key: str, leaf_examples: list[str], pack: dict, harvested: list[str]) -> list[str]:
    rows: set[str] = set()

    aliases = list(pack.get("merchant_aliases", [])) + list(leaf_examples)
    aliases = [a for a in aliases if a]
    harvested_names = harvested[: 4000]  # cap to keep one leaf from dominating
    merchant_pool = aliases + harvested_names
    if not merchant_pool:
        merchant_pool = ["store"]

    templates = list(pack.get("templates", []))
    phrasings = list(pack.get("phrasings", []))
    code_mixed = list(pack.get("code_mixed", []))

    # 1. raw phrasings + code-mixed (high signal, natural)
    for p in phrasings + code_mixed + leaf_examples:
        rows.add(p)
        rows.add(apply_typos(p))

    # 2. harvested merchant names, raw + UPI-wrapped
    for name in harvested_names:
        rows.add(name)
        rows.add(upi_wrap(name))

    # 3. template fills (the volume driver)
    target = config.MIN_ROWS_PER_LEAF
    guard = 0
    while len(rows) < target and (templates or merchant_pool) and guard < target * 4:
        guard += 1
        if templates and RNG.random() < 0.7:
            tpl = RNG.choice(templates)
            rows.add(fill_template(tpl, merchant_pool, leaf_key))
        else:
            # plain merchant + amount
            name = RNG.choice(merchant_pool)
            rows.add(f"{name} {amount_sample(leaf_key)}")

    # cap
    out = list(rows)
    RNG.shuffle(out)
    return out[: config.MAX_ROWS_PER_LEAF]


def main() -> int:
    parser = argparse.ArgumentParser(description="Explode packs into the training set")
    parser.add_argument("--eval-per-leaf", type=int, default=None,
                        help="override eval rows per leaf")
    args = parser.parse_args()
    config.utf8_stdout()

    tax = load_taxonomy()
    packs = load_packs()
    harvest = load_harvest_by_leaf()

    eval_per_leaf = args.eval_per_leaf or max(1, config.TARGET_EVAL_ROWS // len(tax.leaves))

    train_text: list[str] = []
    train_leaf: list[str] = []
    eval_text: list[str] = []
    eval_leaf: list[str] = []
    bank_text: list[str] = []
    bank_leaf: list[str] = []

    print(f"Expanding {len(tax.leaves)} leaves...")
    for leaf in tax.leaves:
        pack = packs.get(leaf.key, {})
        harvested = harvest.get(leaf.key, [])
        rows = synth_for_leaf(leaf.key, list(leaf.examples), pack, harvested)
        if not rows:
            print(f"  WARN: no rows for {leaf.key}")
            continue
        RNG.shuffle(rows)

        # eval split: hold out a slice of the most natural rows (phrasings)
        held = rows[:eval_per_leaf]
        train = rows[eval_per_leaf:]

        for t in train:
            train_text.append(t)
            train_leaf.append(leaf.key)
        for t in held:
            eval_text.append(t)
            eval_leaf.append(leaf.key)

        # example bank: clean canonical phrases (aliases + phrasings + examples)
        canon = list(dict.fromkeys(
            list(pack.get("merchant_aliases", []))[:40]
            + list(pack.get("phrasings", []))[:30]
            + list(leaf.examples)
        ))
        for t in canon:
            bank_text.append(t)
            bank_leaf.append(leaf.key)

        print(f"  {leaf.key:24} train={len(train)} eval={len(held)} bank={len(canon)}")

    config.ensure_dirs()
    pq.write_table(pa.table({"text": train_text, "leaf": train_leaf}), config.EXPANDED_TRAIN)
    pq.write_table(pa.table({"text": eval_text, "leaf": eval_leaf}), config.EXPANDED_EVAL)
    pq.write_table(pa.table({"leaf": bank_leaf, "text": bank_text}), config.EXAMPLE_BANK)

    print(f"\nTrain rows: {len(train_text)}  →  {config.EXPANDED_TRAIN}")
    print(f"Eval rows:  {len(eval_text)}  →  {config.EXPANDED_EVAL}")
    print(f"Bank rows:  {len(bank_text)}  →  {config.EXAMPLE_BANK}")
    print("\nNext: modal run jobs/02_train_encoders.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

