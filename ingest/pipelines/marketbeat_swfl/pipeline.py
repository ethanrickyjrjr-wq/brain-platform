"""MarketBeat SWFL quarterly ingest (GitHub Actions cron).

Calls Firecrawl /v2/agent once across the three broker MarketBeat pages, validates
each row against the range table from the 2026-05-25 firecrawl-pipeline-skeleton
plan (halt-and-alert on violation), and UPSERTs into `data_lake.marketbeat_swfl`
with `verified = false`. The cre-swfl pack's source connector filters
`verified = true`, so the new rows are a no-op until a human spot-checks the
data and flips the flag with a single UPDATE.

After a successful upsert, dispatches the existing daily-rebuild.yml workflow
with pack_id=cre-swfl so the brain regenerates picking up the new rows
(only takes effect once the verified flag is flipped).

Env:
  FIRECRAWL_API_KEY              — required, repo secret.
  SUPABASE_URL                       — required.
  SUPABASE_SERVICE_KEY               — required (service-role; bypasses RLS).
  DESTINATION__POSTGRES__CREDENTIALS — required (postgresql://user:pass@host:port/db).

CLI:
  python -m ingest.pipelines.marketbeat_swfl.pipeline           # ship for real
  python -m ingest.pipelines.marketbeat_swfl.pipeline --dry-run # validate but skip writes
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


# Range table — halt-and-alert on the first violation. Per the plan, this is a
# small-batch quarterly dataset (~5-15 rows); "investigate" beats "silently
# quarantine" any day.
RANGES: dict[str, tuple[float, float]] = {
    "vacancy_rate": (1.0, 40.0),
    "asking_rent_nnn": (8.0, 80.0),
    "absorption_sqft": (-600_000, 600_000),
}

QUARTER_RE = r"^\d{4}-Q[1-4]$"

BROKER_URLS = [
    "https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats",
    "https://lsicompanies.com/market-reports",
    "https://cpswfl.com/market-reports/",
]

AGENT_PROMPT = (
    "Extract Southwest Florida commercial real estate market data: vacancy rate "
    "(percent, 0-100), net absorption (square feet), average asking rent "
    "(USD per square foot, NNN), reporting submarket name. Return one record "
    "per submarket. Quarter should be the reporting quarter formatted YYYY-QN "
    "(e.g. 2026-Q3). Use null if a value is not present — never invent."
)

AGENT_SCHEMA = {
    "type": "object",
    "properties": {
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["submarket", "quarter"],
                "properties": {
                    "submarket":       {"type": "string"},
                    "quarter":         {"type": "string", "pattern": QUARTER_RE},
                    "vacancy_rate":    {"type": ["number", "null"]},
                    "asking_rent_nnn": {"type": ["number", "null"]},
                    "absorption_sqft": {"type": ["number", "null"]},
                    "source_url":      {"type": ["string", "null"]},
                },
            },
        }
    },
}


class ValidationError(RuntimeError):
    """Raised when a row violates the range table — halts the run."""


def validate_row(row: dict[str, Any]) -> dict[str, Any]:
    """Halt-and-alert validation. Returns row with normalized fields on success."""
    import re

    submarket = row.get("submarket")
    if not isinstance(submarket, str) or not submarket.strip():
        raise ValidationError(f"Missing/blank submarket on row: {row!r}")
    quarter = row.get("quarter")
    if not isinstance(quarter, str) or not re.match(QUARTER_RE, quarter):
        raise ValidationError(
            f'Invalid quarter "{quarter}" on submarket "{submarket}" — expected YYYY-QN.'
        )
    for field, (lo, hi) in RANGES.items():
        v = row.get(field)
        if v is None:
            continue
        if not isinstance(v, (int, float)) or v < lo or v > hi:
            raise ValidationError(
                f'Range violation: {field}={v} on "{submarket}" (allowed {lo}..{hi}).'
            )
    return {
        "id": f"{submarket}_{quarter}",
        "submarket": submarket,
        "quarter": quarter,
        "vacancy_rate": row.get("vacancy_rate"),
        "asking_rent_nnn": row.get("asking_rent_nnn"),
        "absorption_sqft": row.get("absorption_sqft"),
        "source_url": row.get("source_url"),
    }


UPSERT_SQL = """
INSERT INTO data_lake.marketbeat_swfl
    (id, submarket, quarter, vacancy_rate, asking_rent_nnn, absorption_sqft,
     source_url, verified, _source_model, _ingested_at)
VALUES
    (%(id)s, %(submarket)s, %(quarter)s, %(vacancy_rate)s, %(asking_rent_nnn)s,
     %(absorption_sqft)s, %(source_url)s, false, 'spark-1-mini', %(_ingested_at)s)
ON CONFLICT (submarket, quarter) DO UPDATE SET
    vacancy_rate    = EXCLUDED.vacancy_rate,
    asking_rent_nnn = EXCLUDED.asking_rent_nnn,
    absorption_sqft = EXCLUDED.absorption_sqft,
    source_url      = EXCLUDED.source_url,
    _source_model   = EXCLUDED._source_model,
    _ingested_at    = EXCLUDED._ingested_at;
"""


def _pg_connect() -> psycopg.Connection:
    return psycopg.connect(
        os.environ["DESTINATION__POSTGRES__CREDENTIALS"],
        sslmode="require",
        connect_timeout=30,
    )


def upsert_rows(rows: list[dict[str, Any]]) -> int:
    ingested_at = datetime.now(timezone.utc).isoformat()
    written = 0
    with _pg_connect() as conn:
        with conn.cursor() as cur:
            for row in rows:
                params = {**row, "_ingested_at": ingested_at}
                cur.execute(UPSERT_SQL, params)
                written += 1
        conn.commit()
    return written


def dispatch_daily_rebuild(*, pack_id: str = "cre-swfl") -> None:
    """Fire daily-rebuild.yml via the GitHub REST API using GITHUB_TOKEN."""
    import requests

    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")  # set by GitHub Actions runner
    if not token or not repo:
        print(
            "dispatch_daily_rebuild: GITHUB_TOKEN/GITHUB_REPOSITORY unset — skipping dispatch (likely local run)."
        )
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
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate Firecrawl output and print rows, but skip Postgres + dispatch.",
    )
    parser.add_argument(
        "--max-credits",
        type=int,
        default=1000,
        help="Firecrawl credit budget (default 1000).",
    )
    args = parser.parse_args(argv)

    print(f"marketbeat_swfl: calling Firecrawl Agent across {len(BROKER_URLS)} broker pages...")
    response = agent(
        AGENT_PROMPT,
        urls=BROKER_URLS,
        schema=AGENT_SCHEMA,
        max_credits=args.max_credits,
    )
    raw_rows = extract_agent_rows(response)
    if not raw_rows:
        # Empty result here is suspicious — quarterly broker reports always have
        # data. Treat as a hard failure so the operator investigates.
        raise RuntimeError(
            f"marketbeat_swfl: Firecrawl returned zero rows. "
            f"Response head: {json.dumps(response)[:500]}"
        )

    validated = [validate_row(r) for r in raw_rows]
    print(f"marketbeat_swfl: validated {len(validated)} rows.")
    for r in validated:
        print(f"  {r['submarket']:30s} {r['quarter']}  vac={r['vacancy_rate']}  rent={r['asking_rent_nnn']}  abs={r['absorption_sqft']}")

    if args.dry_run:
        print("marketbeat_swfl: --dry-run, skipping Postgres upsert + dispatch.")
        return 0

    written = upsert_rows(validated)
    print(f"marketbeat_swfl: upserted {written} rows into data_lake.marketbeat_swfl (verified=false).")
    print("marketbeat_swfl: dispatching daily-rebuild.yml (pack_id=cre-swfl)...")
    dispatch_daily_rebuild()
    print("marketbeat_swfl: dispatch sent. cre-swfl will pick up the new rows once verified=true.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
