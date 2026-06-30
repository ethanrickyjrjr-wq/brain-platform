"""Orchestrator for the listing lifecycle state machine — SEED once, then daily tick + diff.

Per county: scan_county (full active walk) -> coverage_guard.scan_is_complete -> diff_states
(is_seed when we hold no prior state for that county) -> distill.upsert_state + append_transitions.

The operator's model: seed the bulk once; thereafter every listing still on the market ages a day
(DOM = days in the current active spell, ticked by diff_states); a listing that leaves the active
feed moves to HOLDING (never deleted); if it reappears it comes back out of holding (a relist). We
persist ONLY the changes — unchanged listings just age. Fail loud only if EVERY county returns 0.

Run:
  python -m ingest.pipelines.listing_lifecycle.pipeline [--dry-run] [--county NAME]
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

from ingest.pipelines.listing_lifecycle import distill
from ingest.pipelines.listing_lifecycle.distill import address_key_to_street
from ingest.pipelines.listing_lifecycle.address_key import address_key
from ingest.pipelines.listing_lifecycle.coverage_guard import scan_is_complete
from ingest.pipelines.listing_lifecycle.constants_api import API_SOURCE_NAME
from ingest.pipelines.listing_lifecycle.extract import SWFL_COUNTIES, scan_county
from ingest.pipelines.listing_lifecycle.extract_api import scan_county_api
from ingest.pipelines.listing_lifecycle.transitions import diff_states

# Counties the API feed covers (RentCast/SteadyAPI scope gate = Lee + Collier FIPS).
API_COUNTIES = ["Lee", "Collier"]


def _keyed_scan(rows: list[dict]) -> dict[tuple[str, str], dict]:
    """Build the diff's `scanned` dict keyed on (address_key, sale_or_rent). Source B is the active
    for-sale feed, so every card is state='active'; the source identity is composite (region:mls)."""
    out: dict[tuple[str, str], dict] = {}
    for r in rows:
        r["state"] = "active"
        # API rows carry their own listing_id (RentCast id / SteadyAPI property_id); the scrape rows
        # don't, so fall back to the composite (region:mls) source identity for those.
        r["listing_id"] = r.get("listing_id") or f"{r.get('mls_region')}:{r.get('mls')}"
        ak = address_key(r.get("street_address") or "", r.get("zip_code") or "")
        r["street_address"] = address_key_to_street(ak)
        out[(ak, r.get("sale_or_rent") or "sale")] = r
    return out


def run(*, dry_run: bool = False, only_county: str | None = None,
        today: str | None = None, source: str = "api") -> dict:
    today = today or str(date.today())
    # The ONLY swapped part is the extractor + the source identity it lands under; the diff engine,
    # DB layer, coverage guard and state shape are reused unchanged (capture wide, slice late).
    src_name = API_SOURCE_NAME if source == "api" else distill.SOURCE_NAME
    scan = scan_county_api if source == "api" else scan_county
    counties = [only_county] if only_county else (API_COUNTIES if source == "api" else SWFL_COUNTIES)
    prior_all = distill.load_current_state(source_name=src_name)
    totals = {"scanned": 0, "upserts": 0, "transitions": 0}
    for county in counties:
        result = scan(county)
        rows = result["rows"]
        totals["scanned"] += len(rows)
        prior = {k: v for k, v in prior_all.items() if v.get("county") == county}
        is_seed = len(prior) == 0
        complete, why = scan_is_complete(
            {"exhausted": result["exhausted"], "count": len(rows), "last_status": result["last_status"]},
            last_trusted_count=(len(prior) or None),
            baseline_total=result.get("county_total"),  # cap-aware: flag a seed far below the printed total
        )
        if not complete:
            print(f"[skip] {county}: untrustworthy scan ({why}) — no diff emitted", flush=True)
            continue
        scanned = _keyed_scan(rows)
        ups, trans = diff_states(prior, scanned, today, scan_complete=complete, is_seed=is_seed)
        for u in ups:
            u.setdefault("county", county)
            if source != "api":
                # Scrape cards carry no real DOM, so the days-in-active-spell tick stands in for it.
                u["days_on_market"] = u.get("days_in_state")
            # API path: keep the row's own days_on_market — REAL (RentCast) or None (SteadyAPI-only).
            # NEVER fall back to days_in_state (0 on the seed): the view's avg(days_on_market) must
            # reflect only sourced DOM, else every photo-only listing fakes a 0-day average.
        n_u = distill.upsert_state(ups, source_name=src_name, dry_run=dry_run)
        n_t = distill.append_transitions(trans, source_name=src_name, dry_run=dry_run)
        totals["upserts"] += n_u
        totals["transitions"] += n_t
        print(f"[ok] {county}: scanned={len(rows)} seed={is_seed} upserts={n_u} transitions={n_t} ({why})", flush=True)
    print(f"[done] {totals} dry_run={dry_run} source={source}", flush=True)
    if totals["scanned"] == 0:
        print("[fatal] every county returned 0 rows — failing loud (no silent fake-green)", flush=True)
        sys.exit(1)
    return totals


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Windows console: crawl4ai emits unicode
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="Listing lifecycle scan/diff (API feed | Source-B scrape).")
    ap.add_argument("--dry-run", action="store_true", help="extract + diff, print, no DB write")
    ap.add_argument("--county", help="scan one county only (e.g. Lee)")
    ap.add_argument("--source", choices=["api", "scrape"], default="api",
                    help="api = RentCast+SteadyAPI (default); scrape = legacy Source-B crawl4ai")
    args = ap.parse_args()
    run(dry_run=args.dry_run, only_county=args.county, source=args.source)


if __name__ == "__main__":
    main()
