"""
LAPTOP · Phase 0b — turn harvested raw rows into deterministically labeled
(text → leaf) pairs via the crosswalk.

Input:  data/harvest_raw.jsonl   (name, signal_type, signal, source)
Output: data/harvest_pairs.parquet  (text, leaf, source, confidence)

Resolution by signal_type:
  - mcc            : crosswalk.resolve_mcc(int)
  - plaid_pfc      : crosswalk.resolve_plaid(key)
  - fsq_family     : crosswalk.resolve_fsq(family)
  - wikidata_industry : fuzzy map industry label → fsq family → leaf
  - legacy_category   : map v1 category → best v2 leaf

Rows that don't resolve are dropped (logged), never guessed — a wrong label is
worse than a missing one. Output is the high-precision "named merchant" half of
the training set; the synthesis half adds messy-text realism.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from taxonomy.crosswalk import load as load_crosswalk  # noqa: E402
from taxonomy.taxonomy import load as load_taxonomy  # noqa: E402

HARVEST_RAW = config.DATA_DIR / "harvest_raw.jsonl"

# v1 legacy category → best v2 leaf. The merchant DB ships v1 labels; this keeps
# that curated signal usable.
LEGACY_TO_LEAF = {
    "Bills & Utilities": "electricity",
    "Cash & ATM": "cash_atm",
    "Childcare": "childcare",
    "Coffee & Beverages": "coffee_beverages",
    "Convenience": "convenience",
    "Education": "education",
    "Entertainment": "entertainment",
    "Fast Food": "fast_food",
    "Food Delivery": "food_delivery",
    "Gas & Fuel": "fuel",
    "Giving": "charity_donations",
    "Groceries": "groceries",
    "Healthcare": "healthcare_medical",
    "Housing": "rent",
    "Income": "salary",
    "Insurance": "insurance",
    "Other": "other",
    "Restaurants": "restaurants",
    "Shopping & Retail": "shopping_retail",
    "Subscriptions": "subscriptions",
    "Transfers": "transfers",
    "Transportation": "ride_hailing_taxi",
    "Travel": "travel_other",
}

# Wikidata industry label keywords -> fsq family (then crosswalk -> leaf).
# Order matters: more specific keys MUST come before substrings of them
# (e.g. "hospitality" before "hospital", since matching is substring-based and
# "hospital" is a substring of "hospitality"). _industry_to_family checks in
# dict order and returns the first hit.
INDUSTRY_KEYWORDS = {
    "supermarket": "Grocery Store",
    "grocery": "Grocery Store",
    "e-commerce": "Retail",
    "fast food": "Fast Food Restaurant",
    "restaurant": "Dining and Drinking",
    "coffee": "Coffee Shop",
    "beverage": "Coffee Shop",
    "brewery": "Bar",
    "pharmaceutical": "Pharmacy",
    "pharmacy": "Pharmacy",
    "hospitality": "Hotel",          # MUST precede "hospital"
    "hotel": "Hotel",
    "health care": "Hospital",
    "healthcare": "Hospital",
    "hospital": "Hospital",
    "petroleum": "Gas Station",
    "oil and gas": "Gas Station",
    "fuel": "Gas Station",
    "insurance": "Insurance Office",
    "airline": "Airport",
    "telecommunication": "",          # ambiguous (telecom != transit); drop, do not mislabel
    "education": "School",
    "clothing": "Clothing Store",
    "apparel": "Clothing Store",
    "fashion": "Clothing Store",
    "consumer electronics": "Electronics Store",
    "electronics": "Electronics Store",
    "furniture": "Furniture and Home Store",
    "entertainment": "Arts and Entertainment",
    "film": "Movie Theater",
    "automotive": "Automotive Service",
    # NOTE: "retail", "bank", "financial" intentionally REMOVED — they are too
    # broad / mislabel (a bank brand is not a Cash & ATM merchant; "retail"
    # swallows everything). Unmapped industries drop, never guess (P3).
}


def clean_name(name: str) -> str:
    n = " ".join(str(name).split()).strip()
    return n[:80]


def resolve(row: dict, cw, valid_leaves: set[str]) -> tuple[str, float] | None:
    st = row.get("signal_type")
    sig = row.get("signal", "")
    if st == "mcc":
        try:
            leaf = cw.resolve_mcc(int(sig))
        except (TypeError, ValueError):
            leaf = None
        return (leaf, 0.95) if leaf else None
    if st == "plaid_pfc":
        leaf = cw.resolve_plaid(str(sig))
        return (leaf, 0.95) if leaf else None
    if st == "fsq_family":
        leaf = cw.resolve_fsq(str(sig))
        return (leaf, 0.9) if leaf else None
    if st == "legacy_category":
        leaf = LEGACY_TO_LEAF.get(str(sig))
        return (leaf, 0.9) if leaf and leaf in valid_leaves else None
    if st == "wikidata_industry":
        fam = _industry_to_family(str(sig))
        if not fam:
            return None
        leaf = cw.resolve_fsq(fam)
        return (leaf, 0.8) if leaf else None
    return None


def _industry_to_family(industry: str) -> str | None:
    low = industry.lower()
    for kw, fam in INDUSTRY_KEYWORDS.items():
        if kw in low:
            return fam or None  # empty family = intentionally ambiguous → drop
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Build deterministic merchant→leaf pairs")
    parser.add_argument("--min-name-len", type=int, default=2)
    args = parser.parse_args()
    config.utf8_stdout()

    if not HARVEST_RAW.exists():
        print(f"No harvest file at {HARVEST_RAW}. Run local/harvest.py first.", file=sys.stderr)
        return 1

    tax = load_taxonomy()
    cw = load_crosswalk()
    valid = set(tax.leaf_keys)

    texts: list[str] = []
    leaves: list[str] = []
    sources: list[str] = []
    confidences: list[float] = []

    seen: set[tuple[str, str]] = set()
    resolved = 0
    dropped = 0
    by_leaf: Counter[str] = Counter()

    with HARVEST_RAW.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            name = clean_name(row.get("name", ""))
            if len(name) < args.min_name_len:
                dropped += 1
                continue
            res = resolve(row, cw, valid)
            if not res or res[0] not in valid:
                dropped += 1
                continue
            leaf, conf = res
            dedup_key = (name.lower(), leaf)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            texts.append(name)
            leaves.append(leaf)
            sources.append(row.get("source", "unknown"))
            confidences.append(conf)
            by_leaf[leaf] += 1
            resolved += 1

    if resolved == 0:
        print("No rows resolved — check harvest output / crosswalk.", file=sys.stderr)
        return 1

    table = pa.table(
        {
            "text": texts,
            "leaf": leaves,
            "source": sources,
            "confidence": confidences,
        }
    )
    config.ensure_dirs()
    pq.write_table(table, config.HARVEST_PAIRS)

    print(f"Resolved {resolved} pairs, dropped {dropped} → {config.HARVEST_PAIRS}")
    print("Coverage by leaf (top 15):")
    for leaf, n in by_leaf.most_common(15):
        print(f"  {leaf:24} {n}")
    missing = valid - set(by_leaf)
    if missing:
        print(f"\nLeaves with NO harvested merchants ({len(missing)}): {sorted(missing)}")
        print("  (synthesis will cover these from the taxonomy `examples`.)")
    print("\nNext: modal run jobs/01_gemma_generate.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

