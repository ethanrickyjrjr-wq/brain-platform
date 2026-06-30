"""Dry-run / orchestration wiring test for the lifecycle pipeline (no network, no DB).

Monkeypatches the scan + DB layer so we test ONLY the orchestration: seed detection, the keyed
diff, the composite listing_id, DOM = days-in-active-spell, and that dry_run never writes."""
from __future__ import annotations

import ingest.pipelines.listing_lifecycle.pipeline as P


def _row(**kw):
    base = dict(
        mls="X1", mls_region="116", list_price=400000, street_address="100 Main St",
        city="Fort Myers", zip_code="33901", state="FL", beds=3, baths=2.0, sqft=1500,
        lot_acres=None, property_type="residential", subdivision="Dean Park",
        brokerage="ABC Realty", listing_url="/x/", sale_or_rent="sale", unit=None,
    )
    base.update(kw)
    return base


def test_seed_dry_run_emits_new_active_transition_without_writing(monkeypatch):
    monkeypatch.setattr(P, "scan_county",
                        lambda c: {"rows": [_row()], "exhausted": True, "count": 1, "last_status": 200})
    monkeypatch.setattr(P.distill, "load_current_state", lambda *a, **k: {})
    cap: dict = {}
    monkeypatch.setattr(P.distill, "upsert_state", lambda ups, **k: (cap.update(ups=ups, ups_kw=k), len(ups))[1])
    monkeypatch.setattr(P.distill, "append_transitions", lambda tr, **k: (cap.update(tr=tr, tr_kw=k), len(tr))[1])

    res = P.run(dry_run=True, only_county="Lee", today="2026-07-01", source="scrape")

    assert res == {"scanned": 1, "upserts": 1, "transitions": 1}
    assert cap["ups_kw"]["dry_run"] is True and cap["tr_kw"]["dry_run"] is True
    u = cap["ups"][0]
    assert u["state"] == "active"
    assert u["listing_id"] == "116:X1"          # composite (region:mls) source identity
    assert u["days_on_market"] == 0             # DOM = days in active spell, 0 on seed day
    t = cap["tr"][0]
    assert t["from_state"] is None and t["to_state"] == "active" and t["seed"] is True
