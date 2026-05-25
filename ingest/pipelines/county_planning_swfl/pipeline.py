"""SWFL county planning monthly ingest -> Tier 1 cold storage (GitHub Actions cron).

Two parallel Firecrawl /v2/agent calls (one per county) extracting recent
planning + zoning commission decisions, merged into a single NDJSON file
under `lake-tier1/county-planning/year=YYYY/month=MM/`. Same Tier 1 cold
storage pattern as news_swfl.

Env: same as news_swfl.

CLI:
  python -m ingest.pipelines.county_planning_swfl.pipeline
  python -m ingest.pipelines.county_planning_swfl.pipeline --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from typing import Any

from ingest.lib.firecrawl_client import agent, extract_agent_rows
from ingest.lib.storage_uploader import _upload_bytes  # type: ignore[attr-defined]
from ingest.lib.tier1_inventory import upsert_inventory_row


COUNTY_CONFIGS = [
    {
        "county": "Lee",
        "urls": [
            "https://www.leegov.com/dcd/planning",
            "https://www.leegov.com/dcd/zoning",
        ],
    },
    {
        "county": "Collier",
        "urls": [
            "https://www.colliercountyfl.gov/your-government/divisions-a-e/development-review",
            "https://www.colliercountyfl.gov/your-government/divisions-a-e/zoning",
        ],
    },
]


def _build_prompt(county: str) -> str:
    return (
        f"Extract recent planning commission and zoning board decisions for {county} "
        f"County, Florida. For each decision, return: decision_date (ISO YYYY-MM-DD), "
        f"decision_type (one of: approved, denied, deferred, withdrawn, continued), "
        f"location (address or parcel), description (1-2 sentence summary), "
        f"source_url (link to the staff report or agenda item PDF). Include only "
        f"decisions issued in the last 90 days. Use null when a field is not "
        f"available — never invent."
    )


AGENT_SCHEMA = {
    "type": "object",
    "properties": {
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "decision_date":  {"type": ["string", "null"], "pattern": r"^\d{4}-\d{2}-\d{2}$"},
                    "decision_type":  {"type": ["string", "null"]},
                    "location":       {"type": ["string", "null"]},
                    "description":    {"type": ["string", "null"]},
                    "source_url":     {"type": ["string", "null"]},
                },
            },
        }
    },
}


def collect_decisions(now: datetime) -> list[dict[str, Any]]:
    """Run one Firecrawl Agent call per county; merge into a flat list."""
    iso = now.isoformat()
    decisions: list[dict[str, Any]] = []
    for cfg in COUNTY_CONFIGS:
        county = cfg["county"]
        urls = cfg["urls"]
        print(f"county_planning_swfl: scraping {county} ({len(urls)} URLs)...")
        try:
            response = agent(
                _build_prompt(county),
                urls=urls,
                schema=AGENT_SCHEMA,
                max_credits=1500,
                strict_constrain_to_urls=False,
            )
        except Exception as exc:
            print(f"  -> ERROR scraping {county}: {exc!r}")
            continue
        raw_rows = extract_agent_rows(response)
        print(f"  -> {len(raw_rows)} decisions")
        for r in raw_rows:
            decisions.append({
                "county":        county,
                "decision_date": r.get("decision_date"),
                "decision_type": r.get("decision_type"),
                "location":      r.get("location"),
                "description":   r.get("description"),
                "source_url":    r.get("source_url"),
                "_ingested_at":  iso,
            })
    return decisions


def to_ndjson(decisions: list[dict[str, Any]]) -> bytes:
    return ("\n".join(json.dumps(d, ensure_ascii=False) for d in decisions) + "\n").encode("utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    now = datetime.now(timezone.utc)
    decisions = collect_decisions(now)
    if not decisions:
        raise RuntimeError(
            "county_planning_swfl: zero decisions across both counties — "
            "investigate (both Lee and Collier have reshuffled their planning "
            "sites in the past; URLs in COUNTY_CONFIGS may need updating)."
        )

    yyyy = f"{now.year:04d}"
    mm = f"{now.month:02d}"
    iso = now.isoformat()
    path = f"county-planning/year={yyyy}/month={mm}/lee-collier-{iso}.ndjson"
    bucket = "lake-tier1"
    body = to_ndjson(decisions)

    print(f"county_planning_swfl: built {len(decisions)} decisions, {len(body)} bytes NDJSON.")

    if args.dry_run:
        print(f"county_planning_swfl: --dry-run, skipping upload to {bucket}/{path}.")
        return 0

    _upload_bytes(bucket, path, body, "application/x-ndjson")
    print(f"county_planning_swfl: uploaded to {bucket}/{path}.")
    upsert_inventory_row(
        bucket=bucket,
        path=path,
        vintage=f"{yyyy}-{mm}-01",
        byte_size=len(body),
        pack_id=None,
        source_url=None,
    )
    print(f"county_planning_swfl: tier1_inventory row written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
