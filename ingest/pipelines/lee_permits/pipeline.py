"""Lee County building permits dlt pipeline.

Writes to `data_lake.lee_building_permits` in Tier 2 Postgres via merge on permit_id.
Live runs pull via Firecrawl (see scraper.py); tests inject fixture rows directly.
"""
from __future__ import annotations
from datetime import date
from typing import Iterable, Optional
import argparse
import dlt

from .buckets import classify_permit_type
from .scraper import fetch_permit_pages, parse_accela_result_page


@dlt.resource(
    name="lee_building_permits",
    primary_key="permit_id",
    write_disposition="merge",
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
        yield {
            "permit_id": r["permit_id"],
            "issued_date": r["issued_date"],
            "permit_type_raw": r.get("permit_type_raw", ""),
            "permit_description_raw": r.get("permit_description_raw", ""),
            "bucket": bucket,
            "address": r.get("address", ""),
            "zip_code": r.get("zip_code"),
            "lat": r.get("lat"),
            "lon": r.get("lon"),
            "declared_value_usd": r.get("declared_value_usd"),
            "status": r.get("status"),
            "_ingest_metadata": {
                "source": "lee_accela_citizen_access",
                "scraped_via": "firecrawl",
            },
        }


def run_pipeline(start_date: date, end_date: date) -> None:
    """Live entry point. Pulls Firecrawl pages, parses, loads via dlt."""
    pages = fetch_permit_pages(start_date, end_date)
    rows: list[dict] = []
    for html in pages:
        for r in parse_accela_result_page(html):
            rows.append(r.__dict__)

    pipeline = dlt.pipeline(
        pipeline_name="lee_permits",
        destination="postgres",
        dataset_name="data_lake",
    )
    pipeline.run(permits_resource(rows=rows))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--start", type=lambda s: date.fromisoformat(s), required=True)
    p.add_argument("--end", type=lambda s: date.fromisoformat(s), required=True)
    args = p.parse_args()
    run_pipeline(args.start, args.end)


if __name__ == "__main__":
    main()
