"""SWFL city pulse — daily current-events capture -> Tier-1 cold + Tier-2 distilled.

Per city: one Anthropic web_search_20250305 call captures current signals
(openings, layoffs, construction starts, major sales, disasters). The raw
response + flattened citations[] is written to Tier-1 cold storage; distill.py
then turns it into citation-backed rows in data_lake.city_pulse.

Tool version: web_search_20250305 — NOT web_search_20260209. The 20260209
dynamic filtering suppresses per-claim citations[] (repo A/B 2026-05-26:
9 vs 0 cited_text spans). Per-claim citations are the no-hallucination spine.
See ingest/pipelines/corridor_grounded/pipeline.py and
docs/vendor-notes/anthropic-web-search-wire-up.md.

Env: ANTHROPIC_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_KEY +
DESTINATION__POSTGRES__CREDENTIALS.

CLI:
  python -m ingest.pipelines.city_pulse.pipeline
  python -m ingest.pipelines.city_pulse.pipeline --dry-run
  python -m ingest.pipelines.city_pulse.pipeline --city "Naples"
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
from ingest.lib import firecrawl_client

load_dotenv(Path(__file__).resolve().parents[3] / ".env.local")

from ingest.lib.storage_uploader import _upload_bytes  # noqa: E402
from ingest.lib.tier1_inventory import upsert_inventory_row  # noqa: E402
from ingest.pipelines.city_pulse.distill import (  # noqa: E402
    distill_capture, write_rows, prune_expired, reconcile_supersession,
)

CITIES = [
    "Lehigh Acres", "Cape Coral", "Fort Myers", "Naples",
    "Estero", "Bonita Springs", "Fort Myers Beach",
]

MODEL = "claude-sonnet-4-6"
SEARCH_TOOL_VERSION = "web_search_20250305"
BUCKET = "lake-tier1"

# Audited domains. naplesnews.com + news-press.com BLOCK Anthropic's crawler
# (verified in corridor_grounded), so SWFL news comes from the publishers below
# plus county/gov/state primary sources. Do NOT add the blocked papers.
ALLOWED_DOMAINS = [
    "gulfshorebusiness.com",
    "businessobserverfl.com",
    "winknews.com",
    "leegov.com",
    "colliercountyfl.gov",
    "capecoral.gov",
    "cityftmyers.com",
    "leepa.org",
    "collierappraiser.com",
    "floridajobs.org",
    "bls.gov",
    "census.gov",
]


def slug(city: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", city.lower()).strip("-")


QUERY_TEMPLATE = (
    "Provide a current-events briefing for {city}, Florida (Southwest Florida, "
    "Lee or Collier County) covering the LAST 60 DAYS. Surface concrete, dated "
    "developments in these areas:\n"
    "- New business openings, closings, expansions, or major hiring/layoffs.\n"
    "- Commercial building sales, large lease signings, or land acquisitions.\n"
    "- Construction starts, planning-board approvals, or permit milestones.\n"
    "- Storm, flood, or disaster impacts to the local economy.\n\n"
    "Quote specific figures, company names, dollar amounts, and dates. Cite each "
    "claim to its primary source (local news, county records, company releases)."
)

USER_LOCATION = {
    "type": "approximate",
    "city": "Fort Myers",
    "region": "Florida",
    "country": "US",
    "timezone": "America/New_York",
}


def _extract_citations(content: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten all non-null citations from model_dump() content blocks, deduped."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for block in content:
        for c in block.get("citations") or []:
            key = f"{c.get('url')}|{c.get('cited_text', '')[:60]}"
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "url": c.get("url"),
                "title": c.get("title"),
                "cited_text": c.get("cited_text"),
                "type": c.get("type"),
            })
    return out


def build_record(city: str, query: str, response_dump: dict[str, Any], run_at: str) -> dict[str, Any]:
    content = response_dump.get("content", [])
    citations = _extract_citations(content)
    usage = response_dump.get("usage", {}) or {}
    return {
        "city": city,
        "city_slug": slug(city),
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


def run_city_search(city: str, run_at: str) -> dict[str, Any]:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    query = QUERY_TEMPLATE.format(city=city)
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        tools=[{
            "type": SEARCH_TOOL_VERSION,
            "name": "web_search",
            "max_uses": 8,
            "allowed_domains": ALLOWED_DOMAINS,
            "user_location": USER_LOCATION,
        }],
        messages=[{"role": "user", "content": query}],
    )
    return build_record(city, query, response.model_dump(), run_at)


_FIRECRAWL_CITATION_MAX_CHARS = 1500


def capture(city: str, run_at: str, provider: str) -> dict[str, Any]:
    """Dispatch to the appropriate capture provider.

    'anthropic' and 'firecrawl' force that provider with no fallback.
    'auto' tries Firecrawl first; falls back to Anthropic web_search if
    Firecrawl raises or returns zero citations.
    """
    if provider == "anthropic":
        return run_city_search(city, run_at)
    if provider == "firecrawl":
        return capture_firecrawl(city, run_at)
    # auto: Firecrawl primary, Anthropic web_search fallback on failure/empty.
    try:
        rec = capture_firecrawl(city, run_at)
        if rec.get("cited_text_count", 0) > 0:
            return rec
        print("  -> firecrawl returned 0 citations; falling back to anthropic web_search")
    except Exception as exc:
        print(f"  -> firecrawl capture failed ({exc!r}); falling back to anthropic web_search")
    return run_city_search(city, run_at)


def capture_firecrawl(city: str, run_at: str) -> dict[str, Any]:
    """Capture city pulse signals via Firecrawl /v2/search (side-by-side with Anthropic path).

    Returns a record with the same keys as build_record() so distill_capture()
    works unchanged. Token fields are None (Firecrawl has no token concept).
    """
    query = (
        f"{city} Florida business news openings closings construction "
        "real estate development"
    )
    response = firecrawl_client.search(
        query,
        limit=15,
        sources=[{"type": "web"}, {"type": "news"}],
        tbs="qdr:m",
        location=f"{city}, Florida, United States",
        # A cited business-news reporter should not source from social/UGC.
        # Excluding at the API also saves the scrape credits on those results.
        exclude_domains=[
            "facebook.com", "instagram.com", "twitter.com", "x.com",
            "tiktok.com", "reddit.com", "youtube.com", "pinterest.com",
        ],
        scrape_markdown=True,
    )

    data = response.get("data") or {}
    web_results = data.get("web") or []
    news_results = data.get("news") or []
    all_results = web_results + news_results

    citations: list[dict[str, Any]] = []
    for result in all_results:
        url = result.get("url") or (result.get("metadata") or {}).get("sourceURL")
        if not url:
            continue
        title = result.get("title") or ""
        raw_text = result.get("markdown") or result.get("description") or ""
        cited_text = raw_text[:_FIRECRAWL_CITATION_MAX_CHARS] if raw_text else ""
        if not cited_text:
            continue
        citations.append({"url": url, "title": title, "cited_text": cited_text})

    return {
        "city": city,
        "city_slug": slug(city),
        "query": query,
        "model": "firecrawl/v2/search",
        "tool_version": "firecrawl-search",
        "run_at": run_at,
        "input_tokens": None,
        "output_tokens": None,
        "response": response,
        "citations": citations,
        "cited_text_count": len(citations),
        "credits_used": response.get("creditsUsed"),
    }


def to_ndjson(records: list[dict[str, Any]]) -> bytes:
    return ("\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n").encode("utf-8")


def tier1_path(city: str, run_key: str, yyyy: str, mm: str) -> str:
    return f"city_pulse/{slug(city)}/year={yyyy}/month={mm}/run-{run_key}.ndjson"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--city", metavar="NAME", help="Run a single city by exact name.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Run search + distill; print rows, skip Tier-1 upload and DB write.")
    parser.add_argument(
        "--source-provider",
        choices=["auto", "firecrawl", "anthropic"],
        default="auto",
        help="Capture provider: 'auto' (default — Firecrawl primary, Anthropic web_search fallback), "
             "'firecrawl' (/v2/search, no fallback), or 'anthropic' (web_search_20250305, no fallback).",
    )
    args = parser.parse_args(argv)

    cities = [args.city] if args.city else CITIES
    if args.city and args.city not in CITIES:
        parser.error(f"--city must be one of {CITIES}")

    now = datetime.now(timezone.utc)
    run_at = now.isoformat()
    run_key = now.strftime("%Y%m%dT%H%M%SZ")
    yyyy, mm = f"{now.year:04d}", f"{now.month:02d}"

    errors: list[str] = []
    total_new = 0
    for city in cities:
        print(f"city_pulse: querying '{city}' via {args.source_provider}...")
        try:
            record = capture(city, run_at, args.source_provider)
        except Exception as exc:
            print(f"  -> ERROR (search): {exc!r}")
            errors.append(city)
            continue

        cited = record["cited_text_count"]
        if record.get("tool_version") == "firecrawl-search":
            print(f"  -> {cited} cited_text spans | credits_used={record.get('credits_used')}")
        else:
            print(f"  -> {cited} cited_text spans | {record['input_tokens']} in / {record['output_tokens']} out")
        if cited == 0 and record.get("tool_version") != "firecrawl-search":
            print(f"  -> WARNING: zero cited_text spans — verify SEARCH_TOOL_VERSION is '{SEARCH_TOOL_VERSION}'")

        path = tier1_path(city, run_key, yyyy, mm)
        body = to_ndjson([record])

        try:
            rows = distill_capture(record)
        except Exception as exc:
            print(f"  -> ERROR (distill): {exc!r}")
            errors.append(city)
            continue
        print(f"  -> distilled {len(rows)} citation-backed facts")

        if args.dry_run:
            for r in rows:
                print(f"     [{r['topic']}] {r['fact']}  <{r['source_url']}>")
            print(f"  -> --dry-run: would upload {len(body)} bytes to {BUCKET}/{path} and write {len(rows)} rows")
            continue

        try:
            _upload_bytes(BUCKET, path, body, "application/x-ndjson")
            upsert_inventory_row(bucket=BUCKET, path=path, vintage=f"{yyyy}-{mm}",
                                 byte_size=len(body), pack_id="city-pulse-swfl", source_url=None)
            new = write_rows(rows)
        except Exception as exc:
            # Tier-1 may have been written; Tier-2 can be re-distilled from it.
            print(f"  -> ERROR (persist): {exc!r} — Tier-1 raw may exist; re-distill from it.")
            errors.append(city)
            continue
        total_new += new
        print(f"  -> uploaded Tier-1 + wrote {new} new rows (deduped {len(rows) - new})")

        # Sequence is capture -> distill -> upsert -> prune. Prune runs ONCE here,
        # AFTER the full per-city loop, in this single process — never concurrent
        # with an upsert. Doubly safe: prune deletes only expires_at < now(), and a
        # just-refreshed row is fresh (expires_at > now()), so it is never pruned.
    if not args.dry_run:
        try:
            retired = reconcile_supersession()
            print(f"city_pulse: superseded {retired} non-head rows into story heads.")
        except Exception as exc:
            # Writes already committed; a reconcile failure must not red the cron or block prune.
            print(f"  -> WARNING (reconcile skipped this run): {exc!r}")
        pruned = prune_expired()
        print(f"city_pulse: pruned {pruned} expired Tier-2 rows (raw audit retained in Tier-1).")

    print(f"city_pulse: complete. {total_new} new rows across {len(cities)} cities.")
    if errors:
        print(f"city_pulse: {len(errors)} city(ies) errored: {errors}")
        if len(errors) == len(cities):
            raise RuntimeError("city_pulse: all cities failed — investigate.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
