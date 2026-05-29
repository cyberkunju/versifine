"""
LAPTOP · Phase 0a (bulk) — harvest Foursquare OS Places / Overture Places via
DuckDB, filtered to India, mapped to our leaves through the Foursquare-family
crosswalk.

These datasets are huge (100M+ POIs) but DuckDB streams the remote parquet and
only pulls the columns + rows we ask for, so 16 GB RAM is plenty. We never
download the whole thing.

Output appends to the same data/harvest_raw.jsonl that harvest.py writes, so
crosswalk_build.py picks both up.

Foursquare OS Places (Apache-2.0) is the default — it has clean category
labels. Overture is an alternative if you prefer its taxonomy.

Usage:
  python local/harvest_bulk.py --source foursquare --country IN --limit 200000
  python local/harvest_bulk.py --source overture --bbox 68,6,98,38

Note: requires `pip install duckdb`. The remote parquet URLs occasionally
change; if a query 404s, check the dataset's current S3/HF path and pass
--url. This script is best-effort and skips cleanly on failure.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402

HARVEST_RAW = config.DATA_DIR / "harvest_raw.jsonl"

# Foursquare OS Places parquet (HF dataset, Apache-2.0). The places file holds
# name + fsq_category_labels. Path may need updating per release.
FSQ_DEFAULT_URL = (
    "hf://datasets/foursquare/fsq-os-places/release/dt=2025-01-10/places/parquet/*.parquet"
)
# Overture places (GeoParquet on S3). bbox filter via bbox struct.
OVERTURE_DEFAULT_URL = (
    "s3://overturemaps-us-west-2/release/2026-04-23.0/theme=places/type=place/*"
)


def harvest_foursquare(url: str, country: str, limit: int) -> int:
    import duckdb

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    # fsq schema: name, fsq_category_labels (list), country
    query = f"""
        SELECT name, fsq_category_labels
        FROM read_parquet('{url}')
        WHERE country = '{country}'
          AND name IS NOT NULL
          AND fsq_category_labels IS NOT NULL
        LIMIT {limit}
    """
    try:
        rows = con.execute(query).fetchall()
    except Exception as exc:  # noqa: BLE001
        print(f"  [foursquare] query failed: {exc}")
        print("  (check the current parquet path; pass --url to override)")
        return 0

    n = 0
    with HARVEST_RAW.open("a", encoding="utf-8") as fh:
        for name, labels in rows:
            family = _fsq_top_family(labels)
            if not name or not family:
                continue
            fh.write(json.dumps({
                "name": str(name),
                "signal_type": "fsq_family",
                "signal": family,
                "source": "foursquare_os",
            }, ensure_ascii=False) + "\n")
            n += 1
    print(f"  [foursquare] {n} rows appended")
    return n


def _fsq_top_family(labels) -> str | None:
    """fsq_category_labels looks like ['Dining and Drinking > Restaurant', ...].
    Take the top-level family of the first label."""
    if not labels:
        return None
    first = labels[0] if isinstance(labels, (list, tuple)) else str(labels)
    top = str(first).split(">")[0].strip()
    return top or None


def harvest_overture(url: str, bbox: str, limit: int) -> int:
    import duckdb

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    try:
        xmin, ymin, xmax, ymax = (float(x) for x in bbox.split(","))
    except ValueError:
        print("  [overture] --bbox must be 'xmin,ymin,xmax,ymax'")
        return 0
    query = f"""
        SELECT names.primary AS name, categories.primary AS category
        FROM read_parquet('{url}', filename=true, hive_partitioning=1)
        WHERE bbox.xmin BETWEEN {xmin} AND {xmax}
          AND bbox.ymin BETWEEN {ymin} AND {ymax}
          AND names.primary IS NOT NULL
        LIMIT {limit}
    """
    try:
        rows = con.execute(query).fetchall()
    except Exception as exc:  # noqa: BLE001
        print(f"  [overture] query failed: {exc}")
        return 0
    n = 0
    with HARVEST_RAW.open("a", encoding="utf-8") as fh:
        for name, category in rows:
            if not name or not category:
                continue
            fh.write(json.dumps({
                "name": str(name),
                "signal_type": "fsq_family",   # overture categories ≈ fsq families
                "signal": str(category).replace("_", " ").title(),
                "source": "overture",
            }, ensure_ascii=False) + "\n")
            n += 1
    print(f"  [overture] {n} rows appended")
    return n


def main() -> int:
    parser = argparse.ArgumentParser(description="Bulk POI harvest via DuckDB")
    parser.add_argument("--source", choices=["foursquare", "overture"], default="foursquare")
    parser.add_argument("--country", default="IN", help="ISO country (foursquare)")
    parser.add_argument("--bbox", default="68,6,98,38", help="xmin,ymin,xmax,ymax (overture; default India)")
    parser.add_argument("--limit", type=int, default=200_000)
    parser.add_argument("--url", default=None, help="override the dataset parquet URL")
    args = parser.parse_args()
    config.utf8_stdout()

    config.ensure_dirs()
    if not HARVEST_RAW.exists():
        HARVEST_RAW.touch()

    if args.source == "foursquare":
        harvest_foursquare(args.url or FSQ_DEFAULT_URL, args.country, args.limit)
    else:
        harvest_overture(args.url or OVERTURE_DEFAULT_URL, args.bbox, args.limit)

    print("Next: python local/crosswalk_build.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
