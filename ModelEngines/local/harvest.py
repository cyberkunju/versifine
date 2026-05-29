"""
LAPTOP · Phase 0a — harvest real merchant/POI names from public sources.

Network-bound and CPU-light, so it runs free on the laptop (overnight is fine).
Each source yields rows of (name, signal, source) where `signal` is whatever
the source gives us to map to a category later (an MCC code, a Plaid PFC key, a
Foursquare family, or a Wikidata industry label). The crosswalk step
(crosswalk_build.py) turns `signal` into a deterministic leaf label.

Sources (all open / commercially usable — see DATA_PROVENANCE.md):
  - Wikidata (CC0): businesses/brands + industry, multilingual labels
  - Foursquare OS Places (Apache-2.0): POI name + category family
  - OpenStreetMap Name Suggestion Index (BSD): global brand → category tags
  - HF transaction datasets (per-repo license): description + coarse category
  - the repo's own merchant DB (apps/api/src/data/merchants.json): India seed

Everything streams to DATA_DIR as parquet/jsonl. Re-runnable: a source that
fails (rate limit, offline) is skipped with a warning; partial harvest still
produces a usable dataset. Use --only to run a single source.

Usage:
  python local/harvest.py                # all sources
  python local/harvest.py --only wikidata osm_nsi
  python local/harvest.py --limit 5000   # cap per source (dev)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import requests

# Make the package importable whether run as script or module.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402

HARVEST_RAW = config.DATA_DIR / "harvest_raw.jsonl"

USER_AGENT = "VersifineCategorizer/2.0 (research; contact: dev@versifine.com)"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
NSI_URL = "https://raw.githubusercontent.com/osmlab/name-suggestion-index/main/dist/nsi.json"
REPO_MERCHANTS = (
    config.ROOT.parent / "apps" / "api" / "src" / "data" / "merchants.json"
)

# Wikidata industries (P452) / instance-of (P31) we care about, mapped to a
# Foursquare-style family so the crosswalk can resolve them uniformly.
# Query is chunked by country to stay under WDQS timeouts; India first.
WIKIDATA_QUERY = """
SELECT ?itemLabel ?industryLabel WHERE {{
  ?item wdt:P31/wdt:P279* wd:Q4830453 .          # instance of business/enterprise
  ?item wdt:P17 wd:{country} .                    # country
  OPTIONAL {{ ?item wdt:P452 ?industry. }}        # industry
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,hi,ta,te,ml,kn". }}
}}
LIMIT {limit}
"""

# Country QIDs to sweep (India, then a few high-coverage English markets to add
# global brand names that also appear in Indian statements).
WIKIDATA_COUNTRIES = {
    "India": "Q668",
    "United States": "Q30",
    "United Kingdom": "Q145",
}


def _append(rows: list[dict], fh) -> None:
    for r in rows:
        fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def harvest_repo_merchants(fh, limit: int | None) -> int:
    """The curated India merchant DB already ships category labels (v1). We
    pass the v1 category as a `legacy_category` signal; crosswalk_build maps it
    to the best v2 leaf."""
    if not REPO_MERCHANTS.exists():
        print(f"  [repo_merchants] not found at {REPO_MERCHANTS}, skipping")
        return 0
    data = json.loads(REPO_MERCHANTS.read_text(encoding="utf-8"))
    entries = data.get("merchants", [])
    n = 0
    rows = []
    for e in entries:
        name = e.get("displayName") or e.get("pattern")
        if not name:
            continue
        rows.append(
            {
                "name": str(name),
                "signal_type": "legacy_category",
                "signal": e.get("category", "Other"),
                "source": "repo_merchants",
            }
        )
        n += 1
        if limit and n >= limit:
            break
    _append(rows, fh)
    print(f"  [repo_merchants] {n} rows")
    return n


def harvest_osm_nsi(fh, limit: int | None) -> int:
    """OpenStreetMap Name Suggestion Index: curated global brand → OSM tags.
    We map the primary tag (shop=…, amenity=…, cuisine=…) to a FSQ-ish family
    string the crosswalk can resolve."""
    try:
        resp = requests.get(NSI_URL, headers={"User-Agent": USER_AGENT}, timeout=120)
        resp.raise_for_status()
        nsi = resp.json()
    except Exception as exc:  # noqa: BLE001
        print(f"  [osm_nsi] failed: {exc}")
        return 0

    n = 0
    rows = []
    items = nsi.get("nsi", nsi) if isinstance(nsi, dict) else {}
    for _key, block in items.items():
        for item in (block or {}).get("items", []):
            name = item.get("displayName") or (item.get("tags", {}) or {}).get("brand")
            tags = item.get("tags", {}) or {}
            family = _osm_tag_to_family(tags)
            if not name or not family:
                continue
            rows.append(
                {
                    "name": str(name),
                    "signal_type": "fsq_family",
                    "signal": family,
                    "source": "osm_nsi",
                }
            )
            n += 1
            if limit and n >= limit:
                break
        if limit and n >= limit:
            break
    _append(rows, fh)
    print(f"  [osm_nsi] {n} rows")
    return n


def _osm_tag_to_family(tags: dict) -> str | None:
    """Map OSM tags to a Foursquare-style family string in our crosswalk."""
    shop = tags.get("shop")
    amenity = tags.get("amenity")
    if amenity in ("restaurant",):
        return "Dining and Drinking"
    if amenity in ("fast_food",):
        return "Fast Food Restaurant"
    if amenity in ("cafe",):
        return "Coffee Shop"
    if amenity in ("bar", "pub", "nightclub"):
        return "Bar"
    if amenity in ("pharmacy",):
        return "Pharmacy"
    if amenity in ("hospital", "clinic", "doctors"):
        return "Hospital"
    if amenity in ("fuel",):
        return "Gas Station"
    if amenity in ("bank",):
        return "Bank"
    if amenity in ("atm",):
        return "ATM"
    if amenity in ("cinema",):
        return "Movie Theater"
    if amenity in ("school", "college", "university"):
        return "University"
    if amenity in ("place_of_worship",):
        return "Religious Place"
    if amenity in ("parking",):
        return "Parking"
    if shop in ("supermarket", "grocery", "greengrocer"):
        return "Grocery Store"
    if shop in ("convenience", "kiosk"):
        return "Convenience Store"
    if shop in ("clothes", "shoes", "boutique"):
        return "Clothing Store"
    if shop in ("electronics", "mobile_phone", "computer"):
        return "Electronics Store"
    if shop in ("furniture", "houseware"):
        return "Furniture and Home Store"
    if shop in ("gift",):
        return "Gift Store"
    if shop in ("hairdresser", "beauty"):
        return "Salon / Barbershop"
    if shop in ("pet",):
        return "Pet Store"
    if shop in ("car_repair", "tyres"):
        return "Automotive Service"
    if shop in ("mall", "department_store", "variety_store"):
        return "Retail"
    return None


def harvest_wikidata(fh, limit: int | None) -> int:
    """Wikidata businesses by country with industry labels (CC0)."""
    per_country = (limit or 20000) // max(1, len(WIKIDATA_COUNTRIES))
    total = 0
    for cname, qid in WIKIDATA_COUNTRIES.items():
        query = WIKIDATA_QUERY.format(country=qid, limit=per_country)
        try:
            resp = requests.get(
                WIKIDATA_SPARQL,
                params={"query": query, "format": "json"},
                headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"},
                timeout=180,
            )
            resp.raise_for_status()
            bindings = resp.json()["results"]["bindings"]
        except Exception as exc:  # noqa: BLE001
            print(f"  [wikidata:{cname}] failed: {exc}")
            continue
        rows = []
        for b in bindings:
            name = b.get("itemLabel", {}).get("value")
            industry = b.get("industryLabel", {}).get("value")
            if not name or name.startswith("Q"):  # skip unlabeled QIDs
                continue
            rows.append(
                {
                    "name": name,
                    "signal_type": "wikidata_industry",
                    "signal": industry or "",
                    "source": f"wikidata:{cname}",
                }
            )
        _append(rows, fh)
        total += len(rows)
        print(f"  [wikidata:{cname}] {len(rows)} rows")
        time.sleep(1.0)  # be polite to WDQS
    return total


SOURCES = {
    "repo_merchants": harvest_repo_merchants,
    "osm_nsi": harvest_osm_nsi,
    "wikidata": harvest_wikidata,
    # Foursquare OS Places + HF transaction datasets are large and gated; they
    # are harvested via the dedicated `harvest_bulk.py` (DuckDB over the
    # HF/ClickHouse parquet) to keep this script dependency-light. See
    # DATA_PROVENANCE.md.
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Harvest merchant/POI names")
    parser.add_argument("--only", nargs="*", choices=list(SOURCES), help="run only these sources")
    parser.add_argument("--limit", type=int, default=None, help="cap rows per source")
    args = parser.parse_args()
    config.utf8_stdout()

    config.ensure_dirs()
    sources = args.only or list(SOURCES)

    print(f"Harvesting {len(sources)} source(s) → {HARVEST_RAW}")
    total = 0
    with HARVEST_RAW.open("w", encoding="utf-8") as fh:
        for name in sources:
            print(f"- {name}")
            total += SOURCES[name](fh, args.limit)
    print(f"\nDone. {total} raw rows written to {HARVEST_RAW}")
    print("Next: python local/crosswalk_build.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
