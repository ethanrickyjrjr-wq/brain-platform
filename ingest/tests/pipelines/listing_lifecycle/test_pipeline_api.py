"""Orchestration wiring test for the API feed (source='api') — no network, no DB.

Verifies the API source routes to scan_county_api, threads the neutral source_name through every
distill call, and — the headline — keeps RentCast's REAL days_on_market while leaving an unsourced
(SteadyAPI-only) DOM NULL instead of faking it to the seed-day 0 tick (advisor's DOM fix)."""
from __future__ import annotations

import ingest.pipelines.listing_lifecycle.pipeline as P
from ingest.pipelines.listing_lifecycle.constants_api import API_SOURCE_NAME


def _api_row(**kw):
    base = dict(
        street_address="311 Ne 15th St", zip_code="33909", county="Lee", state="FL",
        city="Cape Coral", sale_or_rent="sale", list_price=359999, beds=3, baths=2.0,
        sqft=1672, lot_acres=0.2, property_type="single_family", listing_id="rc-1",
        photo_url="https://ap.rdcpix.com/x.webp", lat=26.68, lon=-81.96, county_fips="12071",
        mls_number="2026027839", mls_name="FLGulfCoastMLS", listing_type="New Construction",
        listed_date="2026-06-26", days_on_market=5,
    )
    base.update(kw)
    return base


def _scan(rows):
    return {"rows": rows, "exhausted": True, "count": len(rows),
            "last_status": 200, "county_total": len(rows)}


def test_run_api_routes_to_scan_county_api_and_threads_source_name(monkeypatch):
    cap: dict = {}
    monkeypatch.setattr(P, "scan_county_api", lambda c, k=None, **kw: _scan([_api_row()]))

    def fake_load(*a, source_name=None, **k):
        cap["load_src"] = source_name
        return {}

    monkeypatch.setattr(P.distill, "load_current_state", fake_load)
    monkeypatch.setattr(P.distill, "upsert_state",
                        lambda ups, *, source_name=None, dry_run=False: (cap.update(ups=ups, up_src=source_name, up_dry=dry_run), len(ups))[1])
    monkeypatch.setattr(P.distill, "append_transitions",
                        lambda tr, *, source_name=None, dry_run=False: (cap.update(tr_src=source_name), len(tr))[1])

    res = P.run(dry_run=True, only_county="Lee", today="2026-07-01", source="api")

    assert cap["load_src"] == API_SOURCE_NAME
    assert cap["up_src"] == API_SOURCE_NAME
    assert cap["tr_src"] == API_SOURCE_NAME
    assert cap["up_dry"] is True
    assert res["upserts"] == 1
    u = cap["ups"][0]
    assert u["listing_id"] == "rc-1"          # API row's own id (NOT the scrape region:mls composite)
    assert u["photo_url"].endswith(".webp")   # the new wide column rides through to the upsert
    assert u["county_fips"] == "12071"


def test_run_api_preserves_real_dom_and_keeps_unsourced_dom_null(monkeypatch):
    rc = _api_row(listing_id="rc-1", days_on_market=5)                                  # RentCast: real DOM
    sa_only = _api_row(street_address="999 Photo Ln", listing_id="sa-1",
                       days_on_market=None, mls_number=None, mls_name="mls")            # SteadyAPI-only: no DOM
    cap: dict = {}
    monkeypatch.setattr(P, "scan_county_api", lambda c, k=None, **kw: _scan([rc, sa_only]))
    monkeypatch.setattr(P.distill, "load_current_state", lambda *a, **k: {})
    monkeypatch.setattr(P.distill, "upsert_state", lambda ups, **k: (cap.update(ups=ups), len(ups))[1])
    monkeypatch.setattr(P.distill, "append_transitions", lambda tr, **k: len(tr))

    P.run(dry_run=True, only_county="Lee", today="2026-07-01", source="api")

    by_id = {u["listing_id"]: u for u in cap["ups"]}
    assert by_id["rc-1"]["days_on_market"] == 5     # real RentCast DOM preserved, NOT overwritten by the tick
    assert by_id["sa-1"]["days_on_market"] is None   # unsourced DOM stays NULL — never faked to 0 (drags avg)
