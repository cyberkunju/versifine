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
import re
import sys
from collections import defaultdict
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from taxonomy.taxonomy import load as load_taxonomy  # noqa: E402

RNG = random.Random(config.GLOBAL_SEED)

GEMMA_TEMPLATES = config.GEMMA_TEMPLATES  # teacher packs (see config / teacher/README.md)

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
    # Strip any leftover {slot} the model invented but we don't fill, so we
    # never train on literal "{foo}" garbage.
    out = re.sub(r"\{[a-zA-Z_]+\}", "", out)
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


def _norm_key(text: str) -> str:
    """Normalized key for dedup + leakage detection: lowercase, strip noise
    tokens and punctuation/amount formatting so near-duplicates collapse
    (e.g. 'zomato ₹450' and 'Zomato Rs.450' map to the same key)."""
    t = text.lower()
    t = re.sub(r"[₹$/,\.\-#@]", " ", t)
    t = re.sub(r"\b(upi|pos|neft|imps|atm|autopay|ref|txn|inr|rs|online)\b", " ", t)
    t = re.sub(r"\d+", " ", t)            # drop all digits (amounts/refs/ids)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def synth_for_leaf(
    leaf_key: str,
    leaf_examples: list[str],
    pack: dict,
    harvested: list[str],
) -> tuple[list[str], list[str]]:
    """Return (natural_rows, synth_rows) as two DEDUPED, DETERMINISTICALLY
    ORDERED lists.

    natural_rows = the human-like phrasings/code-mixed/examples + raw harvested
    merchant names. The eval + calibration splits are drawn ONLY from these, so
    we never test on a template fill (which would inflate accuracy).

    synth_rows = template fills + UPI-wrapped names + perturbations — the
    high-volume material used for TRAIN only.

    Determinism: we build ordered lists (no set iteration), dedup by insertion
    order, and only ever shuffle with the seeded RNG.
    """
    # ---- natural rows: eval/calib are drawn ONLY from genuine natural-language
    # descriptions (LLM phrasings + code-mixed). Merchant NAMES (examples,
    # aliases, harvested) are NOT eval-eligible — the model SHOULD learn
    # merchant->category from them, so they stay in train/bank. This makes eval
    # measure understanding of new phrasings/noise, not memorised merchants,
    # and avoids the quarantine nuking all merchant signal from train. ----
    natural_seen: set[str] = set()
    natural: list[str] = []

    def add_natural(text: str) -> None:
        text = " ".join(str(text).split()).strip()
        if not text:
            return
        key = text.lower()
        if key in natural_seen:
            return
        natural_seen.add(key)
        natural.append(text)

    for src in (pack.get("phrasings", []), pack.get("code_mixed", [])):
        for p in src:
            add_natural(p)

    # ---- synthetic + merchant-name rows (TRAIN only) ----
    harvested_sorted = sorted(set(harvested))
    aliases = [a for a in (list(pack.get("merchant_aliases", [])) + list(leaf_examples)) if a]
    harvested_names = harvested_sorted[:4000]
    merchant_pool = aliases + harvested_names
    if not merchant_pool:
        merchant_pool = ["store"]
    merchant_pool = sorted(set(merchant_pool))  # deterministic pool

    templates = list(pack.get("templates", []))

    synth_seen: set[str] = set()
    synth: list[str] = []

    def add_synth(text: str) -> None:
        text = " ".join(str(text).split()).strip()
        if not text or text.lower() in natural_seen:
            return
        key = text.lower()
        if key in synth_seen:
            return
        synth_seen.add(key)
        synth.append(text)

    # merchant names + examples are train signal (model learns merchant->cat)
    for name in merchant_pool:
        add_synth(name)
    # raw harvested names + UPI-wrapped variants
    for name in harvested_names:
        add_synth(upi_wrap(name))
    # typo variants of the natural phrasings go to TRAIN (not eval)
    for ph in natural:
        v = apply_typos(ph)
        if v != ph:
            add_synth(v)

    # template fills (the volume driver) — deterministic, guarded loop
    target = config.MIN_ROWS_PER_LEAF
    guard = 0
    max_guard = target * 6
    while len(synth) < target and guard < max_guard:
        guard += 1
        if templates and RNG.random() < 0.7:
            add_synth(fill_template(RNG.choice(templates), merchant_pool, leaf_key))
        else:
            add_synth(f"{RNG.choice(merchant_pool)} {amount_sample(leaf_key)}")

    # cap synth (natural is small; keep all of it)
    RNG.shuffle(synth)
    synth = synth[: config.MAX_ROWS_PER_LEAF]
    return natural, synth


def main() -> int:
    parser = argparse.ArgumentParser(description="Explode packs into the training set")
    parser.add_argument("--eval-per-leaf", type=int, default=None,
                        help="override eval rows per leaf")
    args = parser.parse_args()
    config.utf8_stdout()

    tax = load_taxonomy()
    packs = load_packs()
    harvest = load_harvest_by_leaf()

    # eval + calib are drawn from NATURAL rows only, split per leaf.
    held_per_leaf = args.eval_per_leaf or max(2, config.TARGET_EVAL_ROWS // len(tax.leaves))

    train_text: list[str] = []
    train_leaf: list[str] = []
    eval_text: list[str] = []
    eval_leaf: list[str] = []
    calib_text: list[str] = []
    calib_leaf: list[str] = []
    bank_text: list[str] = []
    bank_leaf: list[str] = []

    starved: list[str] = []
    total_leak_blocked = 0

    print(f"Expanding {len(tax.leaves)} leaves...")
    for leaf in tax.leaves:
        pack = packs.get(leaf.key, {})
        harvested = harvest.get(leaf.key, [])
        natural, synth = synth_for_leaf(leaf.key, list(leaf.examples), pack, harvested)

        if not natural and not synth:
            print(f"  WARN: no rows for {leaf.key}")
            starved.append(leaf.key)
            continue

        # ---- hold out eval + calib from NATURAL rows only ----
        natural = list(natural)
        RNG.shuffle(natural)
        # Reserve up to half the natural rows for holdout, split evenly between
        # eval and calib; the rest stays in train. Never starve train.
        max_hold = max(0, len(natural) // 2)
        want_hold = min(max_hold, held_per_leaf * 2)
        n_eval = want_hold // 2
        n_calib = want_hold - n_eval
        eval_rows = natural[:n_eval]
        calib_rows = natural[n_eval : n_eval + n_calib]
        train_natural = natural[n_eval + n_calib :]

        # ---- quarantine: normalized keys of held-out rows must NOT appear in
        # train or bank (prevents near-duplicate leakage across the split) ----
        quarantine = {_norm_key(t) for t in eval_rows + calib_rows}

        def keep(t: str) -> bool:
            nonlocal total_leak_blocked
            if _norm_key(t) in quarantine:
                total_leak_blocked += 1
                return False
            return True

        train_rows = [t for t in (train_natural + synth) if keep(t)]

        for t in train_rows:
            train_text.append(t)
            train_leaf.append(leaf.key)
        for t in eval_rows:
            eval_text.append(t)
            eval_leaf.append(leaf.key)
        for t in calib_rows:
            calib_text.append(t)
            calib_leaf.append(leaf.key)

        # example bank: clean canonical phrases, also quarantined from eval/calib
        canon = [
            t for t in dict.fromkeys(
                list(pack.get("merchant_aliases", []))[:40]
                + list(pack.get("phrasings", []))[:30]
                + list(leaf.examples)
            )
            if t and keep(t)
        ]
        for t in canon:
            bank_text.append(t)
            bank_leaf.append(leaf.key)

        if len(train_rows) < config.MIN_ROWS_PER_LEAF // 2:
            starved.append(leaf.key)
        print(f"  {leaf.key:24} train={len(train_rows)} eval={len(eval_rows)} calib={len(calib_rows)} bank={len(canon)}")

    config.ensure_dirs()
    pq.write_table(pa.table({"text": train_text, "leaf": train_leaf}), config.EXPANDED_TRAIN)
    pq.write_table(pa.table({"text": eval_text, "leaf": eval_leaf}), config.EXPANDED_EVAL)
    pq.write_table(pa.table({"text": calib_text, "leaf": calib_leaf}), config.EXPANDED_CALIB)
    pq.write_table(pa.table({"leaf": bank_leaf, "text": bank_text}), config.EXAMPLE_BANK)

    print(f"\nTrain rows: {len(train_text)}  ->  {config.EXPANDED_TRAIN}")
    print(f"Eval rows:  {len(eval_text)}  ->  {config.EXPANDED_EVAL}")
    print(f"Calib rows: {len(calib_text)}  ->  {config.EXPANDED_CALIB}")
    print(f"Bank rows:  {len(bank_text)}  ->  {config.EXAMPLE_BANK}")
    print(f"Leakage rows blocked from train/bank: {total_leak_blocked}")
    if starved:
        print(f"\nWARN: {len(starved)} leaves thin on data (add harvest/Gemma): {starved}")
    print("\nNext: modal run jobs/02_train_encoders.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

