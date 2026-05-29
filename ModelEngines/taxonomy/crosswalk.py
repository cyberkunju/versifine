"""
Crosswalk loader + validator.

Maps external taxonomies (ISO 18245 MCC ranges, Plaid PFC primary keys,
Foursquare category families) onto our v2 leaf keys, so harvested merchant/POI
rows get a deterministic label without an LLM.

`resolve_mcc` / `resolve_plaid` / `resolve_fsq` are the lookup helpers the
harvest crosswalk uses. Validation guarantees every leaf referenced here exists
in the taxonomy — a dangling reference fails the build.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from .taxonomy import Taxonomy, load as load_taxonomy

CROSSWALK_PATH = Path(__file__).with_name("crosswalk.json")


@dataclass(frozen=True)
class MccRange:
    start: int
    end: int
    leaf: str
    note: str


@dataclass(frozen=True)
class Crosswalk:
    version: str
    mcc_ranges: tuple[MccRange, ...]
    plaid_pfc: dict[str, str]
    foursquare_families: dict[str, str]

    def resolve_mcc(self, code: int) -> str | None:
        # Most-specific (narrowest) matching range wins. This lets a precise
        # single-code rule (e.g. 5541 fuel) override a broad band (5511-5599
        # vehicle_maintenance) regardless of declaration order.
        best: MccRange | None = None
        for r in self.mcc_ranges:
            if r.start <= code <= r.end:
                if best is None or (r.end - r.start) < (best.end - best.start):
                    best = r
        return best.leaf if best else None

    def resolve_plaid(self, key: str) -> str | None:
        return self.plaid_pfc.get(key.strip().upper())

    def resolve_fsq(self, family: str) -> str | None:
        # case-insensitive exact, then substring fallback
        fam = family.strip()
        if fam in self.foursquare_families:
            return self.foursquare_families[fam]
        low = fam.lower()
        for k, v in self.foursquare_families.items():
            if k.lower() == low:
                return v
        for k, v in self.foursquare_families.items():
            if k.lower() in low or low in k.lower():
                return v
        return None


def load(path: Path | None = None) -> Crosswalk:
    raw = json.loads((path or CROSSWALK_PATH).read_text(encoding="utf-8"))
    mcc = tuple(
        MccRange(start=int(r["from"]), end=int(r["to"]), leaf=r["leaf"], note=r.get("note", ""))
        for r in raw["mcc_ranges"]
    )
    return Crosswalk(
        version=raw["version"],
        mcc_ranges=mcc,
        plaid_pfc=dict(raw["plaid_pfc"]),
        foursquare_families=dict(raw["foursquare_families"]),
    )


def validate(cw: Crosswalk, tax: Taxonomy) -> list[str]:
    problems: list[str] = []
    valid = set(tax.leaf_keys)

    for r in cw.mcc_ranges:
        if r.start > r.end:
            problems.append(f"MCC range {r.start}-{r.end}: start > end")
        if r.leaf not in valid:
            problems.append(f"MCC range {r.start}-{r.end}: leaf '{r.leaf}' not in taxonomy")

    for k, v in cw.plaid_pfc.items():
        if v not in valid:
            problems.append(f"plaid '{k}': leaf '{v}' not in taxonomy")

    for k, v in cw.foursquare_families.items():
        if v not in valid:
            problems.append(f"fsq '{k}': leaf '{v}' not in taxonomy")

    # Overlap check: flag only TRUE ambiguities — two ranges of identical width
    # covering the same code with different leaves. Nested ranges (a specific
    # code inside a broad band) are fine because resolve_mcc picks the
    # narrowest match.
    for i, a in enumerate(cw.mcc_ranges):
        for b in cw.mcc_ranges[i + 1 :]:
            overlap = a.start <= b.end and b.start <= a.end
            if not overlap or a.leaf == b.leaf:
                continue
            width_a = a.end - a.start
            width_b = b.end - b.start
            nested = (a.start <= b.start and a.end >= b.end) or (
                b.start <= a.start and b.end >= a.end
            )
            if width_a == width_b and not nested:
                problems.append(
                    f"MCC ambiguous overlap (same width, different leaf): "
                    f"{a.start}-{a.end}({a.leaf}) vs {b.start}-{b.end}({b.leaf})"
                )

    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Versifine crosswalk tool")
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()

    tax = load_taxonomy()
    cw = load()
    print(f"Crosswalk v{cw.version}")
    print(f"  MCC ranges: {len(cw.mcc_ranges)}")
    print(f"  Plaid PFC keys: {len(cw.plaid_pfc)}")
    print(f"  Foursquare families: {len(cw.foursquare_families)}")

    if args.validate:
        problems = validate(cw, tax)
        if problems:
            print("\nCROSSWALK VALIDATION FAILED:", file=sys.stderr)
            for p in problems:
                print(f"  - {p}", file=sys.stderr)
            return 1
        print("\nVALIDATION OK — every crosswalk target exists in the taxonomy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
