"""
Taxonomy loader + strict validator.

Single source of truth for the v2 label space. Everything downstream — data
generation, training, the example bank, the API runtime — derives its label
list from here, so a typo or a duplicate must fail loudly at the door.

Run `python -m taxonomy.taxonomy --validate` to check the JSON before a build.

Guarantees enforced:
  - unique group keys, unique leaf keys (globally), unique leaf names
  - every leaf has a non-empty name, a valid `kind`, a legacy mapping, examples
  - every legacy value maps to one of the v1 23 categories
  - at least one income leaf and one expense leaf exist
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

TAXONOMY_PATH = Path(__file__).with_name("taxonomy.json")

Kind = Literal["expense", "income", "transfer", "neutral"]

# The v1 23-category set every leaf must map back to (backward compatibility
# with the existing API enum + stored transactions). Kept verbatim from
# packages/shared/src/categories.ts.
LEGACY_CATEGORIES: tuple[str, ...] = (
    "Bills & Utilities",
    "Cash & ATM",
    "Childcare",
    "Coffee & Beverages",
    "Convenience",
    "Education",
    "Entertainment",
    "Fast Food",
    "Food Delivery",
    "Gas & Fuel",
    "Giving",
    "Groceries",
    "Healthcare",
    "Housing",
    "Income",
    "Insurance",
    "Other",
    "Restaurants",
    "Shopping & Retail",
    "Subscriptions",
    "Transfers",
    "Transportation",
    "Travel",
)

VALID_KINDS: tuple[Kind, ...] = ("expense", "income", "transfer", "neutral")


@dataclass(frozen=True)
class Leaf:
    key: str
    name: str
    kind: Kind
    legacy: str
    group_key: str
    group_name: str
    examples: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class Group:
    key: str
    name: str
    leaves: tuple[Leaf, ...]


@dataclass(frozen=True)
class Taxonomy:
    version: str
    groups: tuple[Group, ...]

    @property
    def leaves(self) -> tuple[Leaf, ...]:
        return tuple(leaf for g in self.groups for leaf in g.leaves)

    @property
    def leaf_keys(self) -> tuple[str, ...]:
        return tuple(leaf.key for leaf in self.leaves)

    @property
    def leaf_names(self) -> tuple[str, ...]:
        return tuple(leaf.name for leaf in self.leaves)

    def leaf_by_key(self, key: str) -> Leaf | None:
        for leaf in self.leaves:
            if leaf.key == key:
                return leaf
        return None

    def legacy_for(self, key: str) -> str:
        leaf = self.leaf_by_key(key)
        return leaf.legacy if leaf else "Other"


def load(path: Path | None = None) -> Taxonomy:
    raw = json.loads((path or TAXONOMY_PATH).read_text(encoding="utf-8"))
    groups: list[Group] = []
    for g in raw["groups"]:
        leaves = tuple(
            Leaf(
                key=leaf["key"],
                name=leaf["name"],
                kind=leaf["kind"],
                legacy=leaf["legacy"],
                group_key=g["key"],
                group_name=g["name"],
                examples=tuple(leaf.get("examples", [])),
            )
            for leaf in g["leaves"]
        )
        groups.append(Group(key=g["key"], name=g["name"], leaves=leaves))
    return Taxonomy(version=raw["version"], groups=tuple(groups))


def validate(tax: Taxonomy) -> list[str]:
    """Return a list of human-readable problems. Empty list == valid."""
    problems: list[str] = []

    group_keys = [g.key for g in tax.groups]
    _check_unique(group_keys, "group key", problems)

    leaf_keys = [leaf.key for leaf in tax.leaves]
    _check_unique(leaf_keys, "leaf key", problems)

    leaf_names = [leaf.name for leaf in tax.leaves]
    _check_unique(leaf_names, "leaf name", problems)

    for leaf in tax.leaves:
        loc = f"leaf '{leaf.key}'"
        if not leaf.name.strip():
            problems.append(f"{loc}: empty name")
        if leaf.kind not in VALID_KINDS:
            problems.append(f"{loc}: invalid kind '{leaf.kind}' (allowed: {VALID_KINDS})")
        if leaf.legacy not in LEGACY_CATEGORIES:
            problems.append(f"{loc}: legacy '{leaf.legacy}' is not a v1 category")
        if not leaf.examples:
            problems.append(f"{loc}: no examples (needed to seed the example bank)")
        if not leaf.key.islower() or " " in leaf.key:
            problems.append(f"{loc}: key must be lowercase snake_case")

    kinds = {leaf.kind for leaf in tax.leaves}
    if "income" not in kinds:
        problems.append("taxonomy has no income leaf")
    if "expense" not in kinds:
        problems.append("taxonomy has no expense leaf")
    if tax.leaf_by_key("other") is None:
        problems.append("taxonomy must contain an 'other' leaf (last-resort label)")

    return problems


def _check_unique(values: list[str], label: str, problems: list[str]) -> None:
    seen: set[str] = set()
    for v in values:
        if v in seen:
            problems.append(f"duplicate {label}: '{v}'")
        seen.add(v)


def summary(tax: Taxonomy) -> str:
    lines = [
        f"Taxonomy v{tax.version}",
        f"  groups: {len(tax.groups)}",
        f"  leaves: {len(tax.leaves)}",
    ]
    by_kind: dict[str, int] = {}
    for leaf in tax.leaves:
        by_kind[leaf.kind] = by_kind.get(leaf.kind, 0) + 1
    lines.append("  by kind: " + ", ".join(f"{k}={v}" for k, v in sorted(by_kind.items())))
    for g in tax.groups:
        lines.append(f"    [{g.key}] {g.name}: {len(g.leaves)} leaves")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Versifine taxonomy tool")
    parser.add_argument("--validate", action="store_true", help="validate and print summary")
    args = parser.parse_args()

    tax = load()
    print(summary(tax))
    if args.validate:
        problems = validate(tax)
        if problems:
            print("\nVALIDATION FAILED:", file=sys.stderr)
            for p in problems:
                print(f"  - {p}", file=sys.stderr)
            return 1
        print("\nVALIDATION OK — taxonomy is consistent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
