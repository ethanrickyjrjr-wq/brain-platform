"""Corridor broker narrative quarterly ingest (GitHub Actions cron).

For each SWFL broker market-report page, calls Firecrawl /v2/agent to extract
per-corridor positioning, then UPDATEs `corridor_profiles.character_broker_narrative_pending`
(JSONB) on rows matching by canonical corridor name. The cre-swfl pack reads
`character_broker_narrative` (the non-pending column), so newly-ingested rows
are inert until a human spot-checks them and runs:

    UPDATE corridor_profiles
    SET character_broker_narrative = character_broker_narrative_pending,
        character_broker_narrative_pending = NULL
    WHERE corridor_name IN ('...');

This mirrors the verified=false gate on data_lake.marketbeat_swfl.

Never INSERTs into corridor_profiles (brokers can't author canonical corridors)
and never touches the hand-authored `character` TEXT column (the cre-swfl synthesis
prompt quotes it verbatim — overwriting would destroy editorial intent).

Env: FIRECRAWL_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_KEY +
DESTINATION__POSTGRES__CREDENTIALS.

CLI:
  python -m ingest.pipelines.corridor_narratives.pipeline
  python -m ingest.pipelines.corridor_narratives.pipeline --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

import psycopg

from ingest.lib.firecrawl_client import agent, extract_agent_rows


BROKER_SOURCES = [
    {"broker": "CRE Consultants",            "url": "https://www.creconsultants.com/research/"},
    {"broker": "LSI Companies",              "url": "https://lsicompanies.com/market-reports/"},
    {"broker": "Investment Properties Corp", "url": "https://ipcswfl.com/research/"},
    {"broker": "SVN Commercial Partners",    "url": "https://svnswfl.com/market-reports"},
]

# Alias table: broker shorthand -> canonical corridor_profiles.corridor_name.
# KEEP IN SYNC with refinery/sources/cre-source.mts CITY_TO_COUNTY assumptions
# and the corridor pipeline's master alias table (per [[corridor-pipeline-mcp-bundle]]).
# When unmatched corridors appear in the run summary, grow this table next quarter.
CORRIDOR_ALIASES: dict[str, str] = {
    "Immokalee Road":              "Immokalee Rd North Naples",
    "Immokalee Rd":                "Immokalee Rd North Naples",
    "US-41 / Cleveland":           "US-41 / Cleveland Ave Fort Myers",
    "US 41 Cleveland":             "US-41 / Cleveland Ave Fort Myers",
    "Tamiami Trail North Naples":  "Airport-Pulling North Naples",
    "Tamiami Trail Naples":        "Airport-Pulling Naples",
    "Daniels Pkwy":                "Daniels Parkway Fort Myers",
    "Daniels Parkway":             "Daniels Parkway Fort Myers",
}


AGENT_PROMPT = (
    "Extract per-corridor broker positioning for Southwest Florida commercial real "
    "estate. For each corridor named in the report, return: corridor_name (exactly "
    "as the broker names it), market_positioning (the broker's framing of where this "
    "corridor sits in the market today, 1-3 sentences), dominant_tenant_types "
    "(1 short clause), development_pipeline_notes (any active development, "
    "deliveries, or expirations mentioned). Quarter should be the reporting "
    "quarter formatted YYYY-QN. Use null for any field the report does not cover "
    "— never invent."
)

AGENT_SCHEMA = {
    "type": "object",
    "properties": {
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["corridor_name", "quarter"],
                "properties": {
                    "corridor_name":              {"type": "string"},
                    "quarter":                    {"type": "string", "pattern": r"^\d{4}-Q[1-4]$"},
                    "market_positioning":         {"type": ["string", "null"]},
                    "dominant_tenant_types":      {"type": ["string", "null"]},
                    "development_pipeline_notes": {"type": ["string", "null"]},
                },
            },
        }
    },
}


def normalize_corridor_name(raw: str) -> str:
    """Apply alias table; trim whitespace; pass-through if no alias match."""
    if not raw:
        return ""
    trimmed = raw.strip()
    return CORRIDOR_ALIASES.get(trimmed, trimmed)


UPDATE_SQL = """
UPDATE corridor_profiles
SET character_broker_narrative_pending = %(narrative)s::jsonb
WHERE corridor_name = %(corridor_name)s
  AND deleted_at IS NULL
  AND verification_status = 'verified'
RETURNING corridor_name;
"""


def _pg_connect() -> psycopg.Connection:
    return psycopg.connect(
        os.environ["DESTINATION__POSTGRES__CREDENTIALS"],
        sslmode="require",
        connect_timeout=30,
    )


def apply_narratives(rows: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    """Returns (updated_corridor_names, unmatched_corridor_names_raw)."""
    updated: list[str] = []
    unmatched: list[str] = []
    with _pg_connect() as conn:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(
                    UPDATE_SQL,
                    {
                        "corridor_name": row["corridor_name_canonical"],
                        "narrative": json.dumps(row["narrative"]),
                    },
                )
                hit = cur.fetchone()
                if hit:
                    updated.append(hit[0])
                else:
                    unmatched.append(row["corridor_name_raw"])
        conn.commit()
    return updated, unmatched


def dispatch_daily_rebuild(*, pack_id: str = "cre-swfl") -> None:
    import requests

    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        print("dispatch_daily_rebuild: GITHUB_TOKEN/GITHUB_REPOSITORY unset — skipping.")
        return
    url = f"https://api.github.com/repos/{repo}/actions/workflows/daily-rebuild.yml/dispatches"
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        json={"ref": "main", "inputs": {"pack_id": pack_id, "force": "false"}},
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(
            f"daily-rebuild dispatch failed: {resp.status_code} {resp.text[:300]}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-credits", type=int, default=750)
    args = parser.parse_args(argv)

    all_rows: list[dict[str, Any]] = []
    for source in BROKER_SOURCES:
        print(f"corridor_narratives: scraping {source['broker']} ({source['url']})...")
        response = agent(
            AGENT_PROMPT,
            urls=[source["url"]],
            schema=AGENT_SCHEMA,
            max_credits=args.max_credits,
            strict_constrain_to_urls=True,
        )
        raw_rows = extract_agent_rows(response)
        print(f"  -> {len(raw_rows)} raw rows")
        for r in raw_rows:
            canonical = normalize_corridor_name(r.get("corridor_name", ""))
            if not canonical:
                continue
            all_rows.append({
                "corridor_name_canonical": canonical,
                "corridor_name_raw": r["corridor_name"],
                "source_broker": source["broker"],
                "source_url": source["url"],
                "narrative": {
                    "quarter":                    r.get("quarter"),
                    "market_positioning":         r.get("market_positioning"),
                    "dominant_tenant_types":      r.get("dominant_tenant_types"),
                    "development_pipeline_notes": r.get("development_pipeline_notes"),
                },
            })

    if not all_rows:
        raise RuntimeError(
            "corridor_narratives: Firecrawl returned zero rows across all broker pages — investigate."
        )

    print(f"corridor_narratives: {len(all_rows)} rows ready for UPDATE.")

    if args.dry_run:
        print("corridor_narratives: --dry-run, skipping Postgres + dispatch.")
        for r in all_rows:
            print(f"  {r['corridor_name_canonical']:40s} [from {r['source_broker']}]")
        return 0

    updated, unmatched = apply_narratives(all_rows)
    print(f"corridor_narratives: updated {len(updated)} corridor_profiles rows.")
    if unmatched:
        # Don't fail — partial coverage is the steady state. Surface the raw
        # names so the alias table can be grown next quarter.
        print(f"corridor_narratives: {len(unmatched)} corridors did not match any canonical row:")
        for name in sorted(set(unmatched)):
            print(f"  - {name!r}")
        print("  (grow CORRIDOR_ALIASES in pipeline.py to capture these next run.)")

    print("corridor_narratives: dispatching daily-rebuild.yml (pack_id=cre-swfl)...")
    dispatch_daily_rebuild()
    print("corridor_narratives: dispatch sent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
