#!/usr/bin/env python3
"""SWFL CRE intelligence probe — quarterly corridor data extraction.

Extracts per-corridor/submarket CRE metrics from confirmed-live sources
via the two-vendor extract() wrapper (firecrawl → spider fallback).

Source tiers (each an independent extract() call — property types differ):
  Tier 1  C&W MarketBeat PDFs — direct assets.cushmanwakefield.com URLs.
           Industrial + Office Q1 2026 confirmed in search index; retail URL
           pattern-guessed (both hyphen variants) and may 404.
  Tier 2  Colliers SWFL HTML pages — spider stealth unlocks gated summaries.
           Retail Q3 2025 + Office/Industrial Q1 2026 confirmed; retail Q1 2026
           URL is pattern-guessed.
  Tier 3  Academic + editorial — FGCU RERI Q1 2026 report, MHS Appraisal blog.

Dead URLs already burned (see brief — do not re-add):
  creconsultants.com/research/ — 404
  lsicompanies.com/market-reports/ — 404
  ipcswfl.com/research/ — 525 (anti-bot even with stealth)
  svnswfl.com/market-reports — 525
  cushmanwakefield.com/.../fort-myers-naples-marketbeats — landing hub, 0 rows
  lsicompanies.com/market-reports — 200 / all-null
  cpswfl.com/market-reports/ — 200 / 0 rows

Usage:
  python scripts/swfl_cre_intel_probe.py              # run all tiers
  python scripts/swfl_cre_intel_probe.py --dry-run    # print URL plan, no API calls
  python scripts/swfl_cre_intel_probe.py --tier 1     # single tier only
  python scripts/swfl_cre_intel_probe.py --out results/cre_intel.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _bootstrap() -> None:
    """Add repo root to sys.path and load .env.local (same pattern as smoke test)."""
    repo_root = Path(__file__).resolve().parent.parent
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    for candidate in (
        repo_root / ".env.local",
        repo_root / ".env",
        repo_root / "ingest" / ".env.local",
    ):
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        break


_bootstrap()

from ingest.lib.extract_client import ExtractError, extract  # noqa: E402
from ingest.lib.firecrawl_client import extract_agent_rows  # noqa: E402


EXTRACT_PROMPT = """
Extract every quarterly Southwest Florida commercial real estate metric on this page or PDF.
For each submarket or corridor, return one row with ALL of the following fields
(null if not shown — do NOT invent numbers or percentages):
  - corridor_name       (string)  submarket or corridor as written in the source
  - quarter             (string)  reporting quarter, e.g. "2026 Q1"
  - asking_rent_psf     (number)  NNN asking rent per square foot in USD
  - vacancy_pct         (number, 0-100)  vacancy rate as a percentage
  - net_absorption_sqft (number)  net absorption in square feet; negative = net loss
  - notable_transactions (array of strings)  notable sales or leases mentioned, if any
  - narrative           (string)  what is driving or stalling activity, 1-3 sentences
  - source_url          (string)  URL of this page or document
  - as_of_date          (string, YYYY-MM-DD)  publication or report date if stated
Return results as a JSON array under the key "rows".
Omit any field that is not present — zero is a valid value but null means absent.
"""

# ── Source tiers ──────────────────────────────────────────────────────────────
# Each tier is an independent extract() call.  We run all tiers regardless
# of upstream success because property types differ (office ≠ retail ≠ industrial).

TIERS: list[dict[str, Any]] = [
    {
        "tier": 1,
        "label": "C&W MarketBeat PDFs (confirmed + pattern-guessed)",
        "note": "Industrial + Office Q1 2026 confirmed in search index. "
                "Retail URLs are pattern-guessed — one or both may 404.",
        "urls": [
            # ✅ Confirmed in search index 2026-05-26
            "https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q1/us-reports/industrial/fortmyers_naples_americas_alliance_marketbeat_industrial_q12026.pdf",
            # ✅ Confirmed in search index 2026-05-26
            "https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q1/us-reports/office/fort-myers_naples_americas_alliance_marketbeat_office_q12026.pdf",
            # ⚠ Pattern-guessed — CW uses both "fortmyers" and "fort-myers"; try both
            "https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q1/us-reports/retail/fortmyers_naples_americas_alliance_marketbeat_retail_q12026.pdf",
            "https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q1/us-reports/retail/fort-myers_naples_americas_alliance_marketbeat_retail_q12026.pdf",
        ],
        "max_credits": 1500,
    },
    {
        "tier": 2,
        "label": "Colliers SWFL HTML pages",
        "note": "Retail Q3 2025 + Office/Industrial Q1 2026 confirmed. "
                "Retail Q1 2026 is pattern-guessed.",
        "urls": [
            # ⚠ Pattern-guessed — confirmed Q3/Q1/Q2 2025 exist; Q1 2026 may not be published yet
            "https://www.colliers.com/en/research/ft-myers/southwest-florida-retail-market-report-2026-q1",
            # ✅ Confirmed in search index 2026-05-26
            "https://www.colliers.com/en/research/ft-myers/southwest-florida-retail-market-report-2025-q3",
            # ✅ Confirmed in search index 2026-05-26
            "https://www.colliers.com/en/research/ft-myers/southwest-florida-office-market-report-2026-q1",
            # ✅ Confirmed in search index 2026-05-26
            "https://www.colliers.com/en/research/ft-myers/southwest-florida-industrial-market-report-2026-q1",
        ],
        "max_credits": 1500,
    },
    {
        "tier": 3,
        "label": "Academic + editorial",
        "note": "FGCU RERI confirmed; MHS Appraisal is a 2026 market blog post.",
        "urls": [
            # ✅ Confirmed in search index 2026-05-26
            "https://www.fgcu.edu/cob/reri/news/reports/swfl-real-estate-first-quarter-2026-report",
            # ✅ Confirmed in search index 2026-05-26
            "https://mhsappraisal.com/southwest-florida-commercial-real-estate-in-2026-what-the-data-actually-shows/",
        ],
        "max_credits": 800,
    },
]


def run_tier(tier_spec: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Run extract() for one tier.  Returns (rows, provenance)."""
    try:
        response = extract(
            EXTRACT_PROMPT,
            urls=tier_spec["urls"],
            schema=None,  # spider rejects arbitrary JSON Schema — prompt-only extraction
            max_credits=tier_spec["max_credits"],
        )
    except ExtractError as exc:
        print(f"  [BOTH VENDORS FAILED] {exc}")
        return [], []

    rows = extract_agent_rows(response)
    provenance = response.get("_provenance", [])
    return rows, provenance


def print_provenance(provenance: list[dict[str, Any]]) -> None:
    for entry in provenance:
        vendor = entry.get("vendor", "?")
        urls = entry.get("url") or entry.get("urls", [])
        n_rows = entry.get("rows", 0)
        ok = entry.get("ok", False)
        err = entry.get("error", "")
        skipped = entry.get("skipped", False)
        if skipped:
            print(f"    [{vendor}] SKIPPED — {entry.get('reason', '')}")
        elif err:
            print(f"    [{vendor}] FAIL  rows={n_rows}  {err[:120]}")
        else:
            print(f"    [{vendor}] OK    rows={n_rows}  urls={urls!r:.80s}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Print URL plan; skip API calls.")
    parser.add_argument("--tier", type=int, choices=[1, 2, 3], help="Run a single tier only.")
    parser.add_argument("--out", metavar="PATH", help="Write all rows to this JSON file.")
    args = parser.parse_args(argv)

    tiers_to_run = [t for t in TIERS if args.tier is None or t["tier"] == args.tier]

    if args.dry_run:
        print("swfl_cre_intel_probe: DRY RUN — no API calls.\n")
        for tier in tiers_to_run:
            print(f"Tier {tier['tier']}: {tier['label']}")
            print(f"  Note: {tier['note']}")
            for url in tier["urls"]:
                print(f"  {url}")
        return 0

    all_rows: list[dict[str, Any]] = []
    run_at = datetime.now(timezone.utc).isoformat()

    for tier in tiers_to_run:
        print(f"\n── Tier {tier['tier']}: {tier['label']} ──")
        print(f"   {len(tier['urls'])} URL(s), max_credits={tier['max_credits']}")
        rows, provenance = run_tier(tier)
        print_provenance(provenance)
        print(f"   {len(rows)} row(s) extracted")
        for row in rows:
            tag = row.get("corridor_name") or row.get("submarket") or "?"
            print(f"     {tag}  |  q={row.get('quarter')}  rent={row.get('asking_rent_psf')}  "
                  f"vac={row.get('vacancy_pct')}  abs={row.get('net_absorption_sqft')}")
        all_rows.extend(rows)

    print(f"\n── Summary ──")
    print(f"   Total rows: {len(all_rows)}")
    print(f"   Non-null asking_rent_psf: {sum(1 for r in all_rows if r.get('asking_rent_psf') is not None)}")
    print(f"   Non-null vacancy_pct:     {sum(1 for r in all_rows if r.get('vacancy_pct') is not None)}")
    print(f"   Non-null absorption_sqft: {sum(1 for r in all_rows if r.get('net_absorption_sqft') is not None)}")

    if args.out:
        out_path = args.out
        os.makedirs(os.path.dirname(out_path) if os.path.dirname(out_path) else ".", exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump({"run_at": run_at, "rows": all_rows}, fh, indent=2)
        print(f"\n   Saved → {out_path}")

    return 0 if all_rows else 1


if __name__ == "__main__":
    sys.exit(main())
