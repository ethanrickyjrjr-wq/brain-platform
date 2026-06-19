"""Lee County building permits dlt pipeline.

Writes to `data_lake.lee_building_permits` in Tier 2 Postgres via merge on permit_id.
Live runs pull via crawl4ai + UndetectedAdapter (see scraper.py); tests inject fixture rows directly.
"""
from __future__ import annotations
from datetime import date
from typing import Iterable, Optional
import argparse
import dlt

import json
import pathlib

from .buckets import classify_permit_type
from .geocoder import assign_corridor, geocode_batch, load_lee_centroids
from .scraper import enrich_rows_with_details, fetch_permit_pages, parse_accela_result_page
from ingest.lib.geo_utils import coord_to_zip

_SCOPE_FIXTURE = pathlib.Path(__file__).parents[3] / "fixtures" / "swfl-zip-county.json"


def _load_in_scope_zips() -> frozenset[str]:
    data = json.loads(_SCOPE_FIXTURE.read_text())
    return frozenset(e["zip"] for e in data["entries"])


@dlt.resource(
    name="lee_building_permits",
    primary_key="permit_id",
    write_disposition="merge",
    columns={"issued_date": {"data_type": "date"}},
)
def permits_resource(rows: Optional[Iterable[dict]] = None):
    """Emit typed permit rows with bucket classification applied."""
    if rows is None:
        rows = []

    for r in rows:
        bucket = classify_permit_type(
            r.get("permit_type_raw", ""),
            r.get("permit_description_raw", ""),
        )
        issued = r.get("issued_date")
        if isinstance(issued, str) and issued:
            issued = date.fromisoformat(issued)
        elif not issued:
            issued = None
        yield {
            "permit_id": r["permit_id"],
            "issued_date": issued,
            "permit_type_raw": r.get("permit_type_raw", ""),
            "permit_description_raw": r.get("permit_description_raw", ""),
            "bucket": bucket,
            "address": r.get("address", ""),
            "zip_code": r.get("zip_code"),
            "lat": r.get("lat"),
            "lon": r.get("lon"),
            "corridor": r.get("corridor"),
            "declared_value_usd": r.get("declared_value_usd"),
            "status": r.get("status"),
            "_ingest_metadata": {
                "source": "lee_accela_citizen_access",
                "scraped_via": "crawl4ai",
            },
        }


def run_pipeline(start_date: date, end_date: date) -> None:
    """Live entry point. Pulls crawl4ai pages, parses, enriches, loads via dlt."""
    pages = fetch_permit_pages(start_date, end_date)
    # issued_date_fallback is overwritten for each row by enrich_rows_with_details();
    # it stays as the search end_date only for rows whose detail fetch fails.
    issued_fallback = end_date.isoformat()
    permit_rows = []
    for html in pages:
        permit_rows.extend(parse_accela_result_page(html, issued_date_fallback=issued_fallback))

    permit_rows = enrich_rows_with_details(permit_rows)
    rows = [r.__dict__ for r in permit_rows]

    addresses = [r["address"] for r in rows if r.get("address")]
    geo = geocode_batch(addresses)
    centroids = load_lee_centroids()
    for r in rows:
        addr = r.get("address") or ""
        lat_lon = geo.get(addr) if addr else None
        lat, lon = lat_lon if lat_lon else (None, None)
        r["lat"] = lat
        r["lon"] = lon
        r["corridor"] = assign_corridor(lat, lon, centroids)

    in_scope_zips = _load_in_scope_zips()
    for r in rows:
        raw_zip = r.get("zip_code")
        lat, lon = r.get("lat"), r.get("lon")
        if raw_zip and raw_zip in in_scope_zips:
            pass  # already a valid site ZIP — keep it
        elif lat and lon:
            r["zip_code"] = coord_to_zip(lat, lon)
        else:
            r["zip_code"] = None

    pipeline = dlt.pipeline(
        pipeline_name="lee_permits",
        destination="postgres",
        dataset_name="data_lake",
    )
    pipeline.run(permits_resource(rows=rows))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--start", type=lambda s: date.fromisoformat(s), required=True)
    p.add_argument("--end", type=lambda s: date.fromisoformat(s), required=True)
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and parse only; skip detail enrichment and dlt write.",
    )
    args = p.parse_args(argv)

    if args.dry_run:
        issued_fallback = args.end.isoformat()
        pages = fetch_permit_pages(args.start, args.end)
        rows: list = []
        for html in pages:
            rows.extend(parse_accela_result_page(html, issued_date_fallback=issued_fallback))
        print(f"lee_permits dry-run: {len(rows)} rows (detail enrichment skipped)")
        if rows:
            print("first row:", rows[0])
        return 0

    run_pipeline(args.start, args.end)
    return 0


if __name__ == "__main__":
    main()
