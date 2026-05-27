"""SWFL corridor grounded web context — quarterly ingest -> Tier 1 cold storage.

For each SWFL corridor in corridor_profiles, makes one Anthropic web_search_20250305
call to capture current market context (asking rents, recent transactions, development
news). Writes the full API response + flattened citations[] as NDJSON to:

  lake-tier1/corridor_grounded/{corridor_slug}/year=YYYY/month=MM/run-{iso}.ndjson

Stage C (refinery/tools/synthesize-corridor-character.mts) reads these blobs to build
grounded web context for the two-block corridor character output.

Tool version: web_search_20250305 (stable) — NOT web_search_20260209.
The 20260209 "dynamic filtering" routes results through Python code execution and
emits text from variables, suppressing per-claim citations[] entirely.
Verified 2026-05-26 A/B: 9 cited_text spans on 20250305 vs 0 on 20260209.
See docs/vendor-notes/anthropic-web-search-wire-up.md.

Env: ANTHROPIC_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_KEY +
DESTINATION__POSTGRES__CREDENTIALS (for inventory upsert).

CLI:
  python -m ingest.pipelines.corridor_grounded.pipeline --corridor "Pine Ridge Rd Naples"
  python -m ingest.pipelines.corridor_grounded.pipeline --all
  python -m ingest.pipelines.corridor_grounded.pipeline --corridor "Pine Ridge Rd Naples" --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import anthropic
from dotenv import load_dotenv

# Local dev: load .env.local at repo root before importing helpers that read
# os.environ at module-init time. GHA injects the same vars as workflow secrets,
# so this is a no-op on CI.
load_dotenv(Path(__file__).resolve().parents[3] / ".env.local")

from ingest.lib.storage_uploader import _upload_bytes  # noqa: E402
from ingest.lib.tier1_inventory import (  # noqa: E402
    _get_connection as _inventory_get_connection,
    upsert_inventory_row,
)


# audited 2026-05-26 — do not add news-press.com or naplesnews.com (block Anthropic crawler)
ALLOWED_DOMAINS = [
    # SWFL brokerages
    "cushmanwakefield.com",
    "lsicompanies.com",
    "creconsultants.com",
    "ipcnaples.com",
    "cbre.com",
    "colliers.com",
    # County / municipal
    "leegov.com",
    "colliercountyfl.gov",
    "leepa.org",
    "collierappraiser.com",
    # News (Gulfshore Business only — News-Press and Naples News block Anthropic's crawler)
    "gulfshorebusiness.com",
    # Federal / state data
    "fred.stlouisfed.org",
    "bls.gov",
    "census.gov",
    "fema.gov",
    "fdot.gov",
]

USER_LOCATION = {
    "type": "approximate",
    "city": "Naples",
    "region": "Florida",
    "country": "US",
    "timezone": "America/New_York",
}

QUERY_TEMPLATE = (
    "Provide a commercial real estate market summary for {corridor_name}, a key corridor "
    "in Southwest Florida. Cover both areas:\n\n"
    "1. MARKET METRICS (2024-2026): Asking rents per square foot for commercial, office, "
    "or retail space on or near this corridor (NNN basis preferred). Vacancy rates, "
    "absorption data, or occupancy trends for this corridor or nearest SWFL submarket.\n\n"
    "2. RECENT DEVELOPMENTS (2024 through early 2026): Significant lease signings, "
    "building sales, construction starts, planning-board approvals, major tenant "
    "announcements, or noteworthy development news affecting this corridor.\n\n"
    "Quote specific figures from broker reports, county records, or news coverage. "
    "Cite each number or claim to its primary source."
)

MODEL = "claude-sonnet-4-6"
SEARCH_TOOL_VERSION = "web_search_20250305"
BUCKET = "lake-tier1"


def slug(corridor_name: str) -> str:
    """Slugify a corridor name into a filesystem-safe path component.

    Must stay byte-identical with the TypeScript `slug()` in
    `refinery/tools/synthesize-corridor-character.mts` — divergence breaks
    Stage C's `resolveGroundedPath()` lookup against this pipeline's NDJSON
    output. Both implementations are pinned by
    `fixtures/corridor-slug-parity.json` and verified in both language test
    suites; if you change the rule here, update the TS copy + regenerate
    the fixture's `expected` values.
    """
    return re.sub(r"[^a-z0-9]+", "-", corridor_name.lower()).strip("-")


def _extract_citations(content: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten all non-null citations from model_dump() content blocks."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for block in content:
        for c in block.get("citations") or []:
            key = f"{c.get('url')}|{c.get('cited_text', '')[:60]}"
            if key not in seen:
                seen.add(key)
                out.append({
                    "url": c.get("url"),
                    "title": c.get("title"),
                    "cited_text": c.get("cited_text"),
                    "type": c.get("type"),
                })
    return out


def build_record(
    corridor_name: str,
    query: str,
    response_dump: dict[str, Any],
    run_at: str,
) -> dict[str, Any]:
    """Build the NDJSON record from a model_dump() response."""
    content = response_dump.get("content", [])
    citations = _extract_citations(content)
    usage = response_dump.get("usage", {}) or {}
    return {
        "corridor_name": corridor_name,
        "corridor_slug": slug(corridor_name),
        "query": query,
        "model": MODEL,
        "tool_version": SEARCH_TOOL_VERSION,
        "run_at": run_at,
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "stop_reason": response_dump.get("stop_reason"),
        "response": response_dump,
        "citations": citations,
        "cited_text_count": len(citations),
    }


def run_grounded_search(corridor_name: str, run_at: str) -> dict[str, Any]:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    query = QUERY_TEMPLATE.format(corridor_name=corridor_name)
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        tools=[
            {
                "type": SEARCH_TOOL_VERSION,
                # Required field per Anthropic web search tool spec
                # (verified 2026-05-26 against docs.anthropic.com). Omitting it
                # returns 400 invalid_request_error "tools.0.web_search_20250305.name: Field required".
                "name": "web_search",
                "max_uses": 8,
                "allowed_domains": ALLOWED_DOMAINS,
                "user_location": USER_LOCATION,
            }
        ],
        messages=[{"role": "user", "content": query}],
    )
    return build_record(corridor_name, query, response.model_dump(), run_at)


def get_corridors(corridor_filter: str | None = None) -> list[str]:
    """Fetch verified corridor names from corridor_profiles."""
    # Reuse the inventory helper's connection — it accepts
    # DESTINATION__POSTGRES__CREDENTIALS when present and falls back to
    # .dlt/secrets.toml otherwise, keeping local-dev runs working without
    # mirroring the GHA secret into .env.local.
    conn = _inventory_get_connection()
    try:
        with conn.cursor() as cur:
            if corridor_filter:
                cur.execute(
                    "SELECT corridor_name FROM corridor_profiles "
                    "WHERE corridor_name = %s AND deleted_at IS NULL "
                    "AND verification_status = 'verified'",
                    (corridor_filter,),
                )
            else:
                # ORDER BY city (not county) — corridor_profiles has no county
                # column; county is derived in code via CITY_TO_COUNTY in
                # refinery/sources/cre-source.mts. Grouping by city still
                # clusters Naples-area corridors together and Lee cities
                # together, preserving spread for progress visibility.
                cur.execute(
                    "SELECT corridor_name FROM corridor_profiles "
                    "WHERE deleted_at IS NULL AND verification_status = 'verified' "
                    "ORDER BY city, corridor_name"
                )
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def to_ndjson(records: list[dict[str, Any]]) -> bytes:
    return ("\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n").encode("utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--corridor", metavar="NAME",
        help="Run for a single corridor by exact corridor_name.",
    )
    parser.add_argument(
        "--all", dest="run_all", action="store_true",
        help="Run for all verified corridors in corridor_profiles.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Run search; write NDJSON to a local file instead of uploading.",
    )
    args = parser.parse_args(argv)

    if not args.corridor and not args.run_all:
        parser.error("Specify --corridor 'NAME' for one corridor or --all for all corridors.")

    corridors = get_corridors(corridor_filter=args.corridor if not args.run_all else None)
    if not corridors:
        name_hint = f" for '{args.corridor}'" if args.corridor else ""
        raise RuntimeError(
            f"corridor_grounded: no matching corridors found{name_hint} — "
            "check corridor_profiles.verification_status."
        )

    print(f"corridor_grounded: {len(corridors)} corridor(s) to process.")

    now = datetime.now(timezone.utc)
    run_at = now.isoformat()
    # URL-safe compact form for the Storage object-key path component.
    # `:` and `+` from isoformat (run-2026-05-26T14:30:00+00:00.ndjson) are
    # not safe in path segments — Supabase Storage URL-encodes the `+` to
    # `%2B`, which breaks any tool that reads the path back literally. The
    # full ISO timestamp is still preserved inside the NDJSON payload's
    # `run_at` field, so audit trails are unaffected.
    run_key = now.strftime("%Y%m%dT%H%M%SZ")
    yyyy = f"{now.year:04d}"
    mm = f"{now.month:02d}"

    errors: list[str] = []

    for name in corridors:
        print(f"corridor_grounded: querying '{name}'...")
        t0 = datetime.now(timezone.utc)
        try:
            record = run_grounded_search(name, run_at)
        except Exception as exc:
            print(f"  -> ERROR: {exc!r}")
            errors.append(name)
            continue

        elapsed = (datetime.now(timezone.utc) - t0).total_seconds()
        cited = record["cited_text_count"]
        print(
            f"  -> {cited} cited_text spans | "
            f"{record['input_tokens']} in / {record['output_tokens']} out tokens | "
            f"{elapsed:.1f}s"
        )
        if cited == 0:
            print(
                f"  -> WARNING: zero cited_text spans — verify SEARCH_TOOL_VERSION "
                f"is still '{SEARCH_TOOL_VERSION}' (not web_search_20260209)"
            )

        corridor_slug = slug(name)
        path = f"corridor_grounded/{corridor_slug}/year={yyyy}/month={mm}/run-{run_key}.ndjson"
        body = to_ndjson([record])

        if args.dry_run:
            local_path = f"/tmp/{corridor_slug}-{yyyy}-{mm}.ndjson"
            with open(local_path, "wb") as f:
                f.write(body)
            print(f"  -> --dry-run: {len(body)} bytes written to {local_path}")
            print(f"  -> would upload to {BUCKET}/{path}")
            continue

        _upload_bytes(BUCKET, path, body, "application/x-ndjson")
        print(f"  -> uploaded to {BUCKET}/{path}.")

        upsert_inventory_row(
            bucket=BUCKET,
            path=path,
            vintage=f"{yyyy}-{mm}",
            byte_size=len(body),
            pack_id=None,
            source_url=None,
        )
        print(f"  -> tier1_inventory row written.")

    if errors:
        print(f"corridor_grounded: {len(errors)} corridor(s) errored:")
        for e in errors:
            print(f"  - {e!r}")
        if len(errors) == len(corridors):
            raise RuntimeError("corridor_grounded: all corridors failed — investigate.")
        # Non-zero exit on ANY failure — keeps GHA red so a partial run
        # doesn't quietly leave gaps in the Tier-1 capture and graduate to
        # cadence-registry "active" status with bad coverage.
        print("corridor_grounded: partial run complete (some corridors failed). Exiting non-zero.")
        return 1

    print(f"corridor_grounded: {len(corridors)} corridor(s) complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
