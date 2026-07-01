"""Deterministic tests for Phase-2 Part A — organic sold capture (off-market hook).

Three pure layers, all network-free / DB-free:
  • classify_off_market  — current_status-authoritative WHY-it-left decision (extract_api).
  • plan_off_market_checks / apply_off_market_resolutions — budget sampling + fold-back (transitions).
  • fetch_sold_event      — the one network wrapper (mocked HTTP here).
Plus a pipeline-wiring block proving the hook is gated to LIVE api runs (never dry-run / seed) and
threads the paid-call budget.

Vendor shape verified live 06/30/2026 (RULE 0.4) from docs.steadyapi.com/collection.json:
/property-tax-history -> {meta:{current_status,...}, body:{status, property_history:[{date, event_name,
price, source_name, listing:{...}}], statistics:{transactions:{sales_count,...}}}}.
"""
from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import MagicMock, patch

from ingest.pipelines.listing_lifecycle import extract_api
from ingest.pipelines.listing_lifecycle.extract_api import (
    classify_off_market,
    fetch_sold_event,
)
from ingest.pipelines.listing_lifecycle.transitions import (
    apply_off_market_resolutions,
    plan_off_market_checks,
)

TODAY = "2026-07-01"


def _hist(current_status="for_sale", events=None):
    return {
        "meta": {"current_status": current_status, "total_transactions": len(events or [])},
        "body": {"status": current_status, "property_history": events or []},
    }


def _ev(date, event_name, price):
    return {"date": date, "event_name": event_name, "price": price,
            "source_name": "FLGulfCoastMLS", "listing": {"listing_id": "x"}}


# ------------------------------------------------------------------ classify_off_market (pure)

def test_recent_sold_event_is_sold_with_price_and_date():
    h = _hist("sold", [_ev("2026-01-10", "Listed", 375000), _ev("2026-06-20", "Sold", 355000)])
    r = classify_off_market(h, since=TODAY, at=TODAY)
    assert r["outcome"] == "sold"
    assert r["sold_price"] == 355000 and r["sold_date"] == "2026-06-20"


def test_old_sale_only_is_not_a_recent_sold():
    # A 2015 sale (prior owner) must NOT read as "just sold" — window rejects it; still for_sale -> holding.
    h = _hist("for_sale", [_ev("2015-03-01", "Sold", 120000), _ev("2026-06-01", "Listed", 375000)])
    r = classify_off_market(h, since=TODAY, at=TODAY)
    assert r["outcome"] == "holding"


def test_pending_current_status_stays_holding_not_withdrawn():
    # The advisor's load-bearing fix: 'no sold event' is NOT a withdrawal — a pending listing hasn't closed.
    h = _hist("pending", [_ev("2026-06-01", "Listed", 375000)])
    r = classify_off_market(h, since=TODAY, at=TODAY)
    assert r["outcome"] == "holding" and r["reason"].startswith("pending")


def test_positively_off_market_with_no_sale_is_withdrawn():
    h = _hist("off_market", [_ev("2026-06-01", "Listed", 375000)])
    assert classify_off_market(h, since=TODAY, at=TODAY)["outcome"] == "withdrawn"


def test_still_for_sale_with_no_sale_is_holding():
    h = _hist("for_sale", [_ev("2026-06-01", "Listed", 375000)])
    assert classify_off_market(h, since=TODAY, at=TODAY)["outcome"] == "holding"


def test_current_status_sold_recovers_sale_when_event_name_label_differs():
    # event_name matching misses the vendor's exact label, but current_status is authoritative.
    h = _hist("sold", [_ev("2026-06-25", "Sale Recorded", 360000)])
    r = classify_off_market(h, since=TODAY, at=TODAY)
    assert r["outcome"] == "sold" and r["sold_price"] == 360000


def test_recheck_window_accepts_a_sale_after_it_left_active():
    # Left active 2026-05-01 (recheck), closed 2026-05-20 — inside [since-45d .. today+7d].
    h = _hist("sold", [_ev("2026-05-20", "Sold", 342000)])
    r = classify_off_market(h, since="2026-05-01", at=TODAY)
    assert r["outcome"] == "sold" and r["sold_date"] == "2026-05-20"


def test_empty_history_claims_nothing():
    assert classify_off_market(_hist("", []), since=TODAY, at=TODAY)["outcome"] == "holding"


# ------------------------------------------------------------------ fetch_sold_event (network wrapper)

def _resp(status, body):
    m = MagicMock()
    m.status_code = status
    m.json.return_value = body
    return m


def test_fetch_sold_event_no_key_is_gap_no_network(monkeypatch):
    monkeypatch.delenv("PHOTOS_API", raising=False)
    with patch.object(extract_api.requests, "get") as mock_get:
        r = fetch_sold_event("123", since=TODAY, at=TODAY, key=None)
    mock_get.assert_not_called()
    assert r["outcome"] == "gap"


def test_fetch_sold_event_200_classifies_sold():
    h = _hist("sold", [_ev("2026-06-20", "Sold", 355000)])
    with patch.object(extract_api.requests, "get", return_value=_resp(200, h)):
        r = fetch_sold_event("123", since=TODAY, at=TODAY, key="p")
    assert r["outcome"] == "sold" and r["sold_price"] == 355000


def test_fetch_sold_event_non_200_is_gap():
    with patch.object(extract_api.requests, "get", return_value=_resp(429, {})):
        r = fetch_sold_event("123", since=TODAY, at=TODAY, key="p")
    assert r["outcome"] == "gap"


# ------------------------------------------------------------------ plan_off_market_checks (pure)

def _dep_trans(addr, price, days):
    return {"address_key": addr, "sale_or_rent": "sale", "to_state": "holding", "at": TODAY,
            "price": price, "days_in_prev_state": days}


def _prior_active(addr, pid, price):
    return {"state": "active", "property_id": pid, "list_price": price,
            "address_key": addr, "sale_or_rent": "sale"}


def _prior_holding(addr, pid, price, holding_age_days, sold_check_at=None):
    # Holding age is derived from last_seen (frozen at holding entry), NOT days_in_state (freezes at 0).
    entered = (date.fromisoformat(TODAY) - timedelta(days=holding_age_days)).isoformat()
    return {"state": "holding", "property_id": pid, "list_price": price, "last_seen": entered,
            "sold_check_at": sold_check_at, "address_key": addr, "sale_or_rent": "sale"}


def test_plan_caps_total_and_prioritizes_higher_value_departures():
    trans = [_dep_trans(f"A{i}", price=100000 + i * 10000, days=i) for i in range(6)]
    prior = {(f"A{i}", "sale"): _prior_active(f"A{i}", pid=str(i), price=100000 + i * 10000) for i in range(6)}
    checks, stats = plan_off_market_checks([], trans, prior, TODAY, cap=3)
    assert len(checks) == 3 and stats["departures_checked"] == 3 and stats["dropped"] == 3
    picked = {c["key"][0] for c in checks}
    assert picked == {"A5", "A4", "A3"}          # highest list_price first (operator's 'higher-value')


def test_plan_skips_departures_without_property_id():
    trans = [_dep_trans("A", 400000, 10)]
    prior = {("A", "sale"): {"state": "active", "list_price": 400000}}  # no property_id
    checks, stats = plan_off_market_checks([], trans, prior, TODAY, cap=5)
    assert checks == [] and stats["departures_available"] == 0


def test_plan_recheck_eligibility_window_and_interval():
    prior = {
        ("young", "sale"): _prior_holding("young", "1", 500000, holding_age_days=5),    # too new (<21)
        ("ripe", "sale"): _prior_holding("ripe", "2", 500000, holding_age_days=40),     # eligible
        ("stale", "sale"): _prior_holding("stale", "3", 500000, holding_age_days=400),  # too old (>180)
        ("checked", "sale"): _prior_holding("checked", "4", 500000, holding_age_days=40,
                                            sold_check_at="2026-06-25"),                # probed <30d ago
    }
    checks, stats = plan_off_market_checks([], [], prior, TODAY, cap=5)
    assert stats["rechecks_available"] == 1
    assert {c["key"][0] for c in checks} == {"ripe"}


def test_plan_recheck_ages_off_last_seen_not_frozen_days_in_state():
    # Regression (advisor blocker): diff freezes a holding row's days_in_state at 0, so eligibility MUST
    # come from last_seen. A 40-day-old holding with days_in_state=0 is still eligible; `since` = entry day.
    row = _prior_holding("H", "9", 500000, holding_age_days=40)
    row["days_in_state"] = 0                          # what the pipeline actually stores
    checks, stats = plan_off_market_checks([], [], {("H", "sale"): row}, TODAY, cap=5)
    assert stats["rechecks_available"] == 1
    assert checks[0]["since"] == "2026-05-22"         # TODAY - 40d = the day it entered holding


def test_plan_reserves_budget_for_rechecks_when_both_exist():
    trans = [_dep_trans(f"D{i}", price=900000, days=i) for i in range(10)]          # 10 departures
    prior = {(f"D{i}", "sale"): _prior_active(f"D{i}", str(i), 900000) for i in range(10)}
    prior[("R", "sale")] = _prior_holding("R", "99", 800000, holding_age_days=40)    # 1 eligible recheck
    checks, stats = plan_off_market_checks([], trans, prior, TODAY, cap=4)
    assert len(checks) == 4
    assert stats["rechecks_checked"] == 1          # reserve kept a slot despite 10 departures
    assert stats["departures_checked"] == 3


def test_plan_departures_take_full_cap_when_no_rechecks():
    trans = [_dep_trans(f"D{i}", price=900000, days=i) for i in range(10)]
    prior = {(f"D{i}", "sale"): _prior_active(f"D{i}", str(i), 900000) for i in range(10)}
    _, stats = plan_off_market_checks([], trans, prior, TODAY, cap=4)
    assert stats["departures_checked"] == 4 and stats["rechecks_checked"] == 0


# ------------------------------------------------------------------ apply_off_market_resolutions (pure)

def _holding_trans(addr):
    return {"address_key": addr, "sale_or_rent": "sale", "from_state": "active",
            "to_state": "holding", "at": TODAY, "listing_id": "l", "price": 400000,
            "price_delta": None, "days_in_prev_state": 30, "seed": False}


def _holding_ups(addr):
    return {"address_key": addr, "sale_or_rent": "sale", "state": "holding", "list_price": 400000}


def test_departure_sold_mutates_transition_in_place_with_price_and_date():
    ups, trans = [_holding_ups("A")], [_holding_trans("A")]
    checks = [{"kind": "departure", "key": ("A", "sale"), "property_id": "1", "since": TODAY}]
    res = [{"outcome": "sold", "sold_price": 355000, "sold_date": "2026-06-20"}]
    stats = apply_off_market_resolutions(ups, trans, checks, res, {}, TODAY)
    assert len(trans) == 1                         # still ONE transition (mutated, not duplicated)
    assert trans[0]["to_state"] == "sold"
    assert trans[0]["sold_price"] == 355000 and trans[0]["sold_date"] == "2026-06-20"
    assert ups[0]["state"] == "sold"
    assert stats["sold"] == 1 and ("A", "sale") in stats["checked_keys"]


def test_departure_withdrawn_flips_state():
    ups, trans = [_holding_ups("A")], [_holding_trans("A")]
    checks = [{"kind": "departure", "key": ("A", "sale"), "property_id": "1", "since": TODAY}]
    apply_off_market_resolutions(ups, trans, checks, [{"outcome": "withdrawn"}], {}, TODAY)
    assert trans[0]["to_state"] == "withdrawn" and ups[0]["state"] == "withdrawn"


def test_departure_gap_leaves_holding_and_is_not_marked_checked():
    ups, trans = [_holding_ups("A")], [_holding_trans("A")]
    checks = [{"kind": "departure", "key": ("A", "sale"), "property_id": "1", "since": TODAY}]
    stats = apply_off_market_resolutions(ups, trans, checks, [{"outcome": "gap"}], {}, TODAY)
    assert trans[0]["to_state"] == "holding"       # unchanged
    assert ("A", "sale") not in stats["checked_keys"]   # NOT stamped -> retried next run
    assert stats["holding_unresolved"] == 1


def test_departure_real_holding_pending_keeps_holding_but_is_checked():
    ups, trans = [_holding_ups("A")], [_holding_trans("A")]
    checks = [{"kind": "departure", "key": ("A", "sale"), "property_id": "1", "since": TODAY}]
    stats = apply_off_market_resolutions(ups, trans, checks, [{"outcome": "holding"}], {}, TODAY)
    assert trans[0]["to_state"] == "holding"
    assert ("A", "sale") in stats["checked_keys"]  # pending -> stamped so we don't re-probe immediately


def test_recheck_sold_appends_fresh_transition_and_terminal_upsert():
    prior = {("H", "sale"): _prior_holding("H", "9", 420000, holding_age_days=45)}
    ups, trans = [], []
    checks = [{"kind": "recheck", "key": ("H", "sale"), "property_id": "9", "since": "2026-05-15"}]
    res = [{"outcome": "sold", "sold_price": 410000, "sold_date": "2026-06-10"}]
    stats = apply_off_market_resolutions(ups, trans, checks, res, prior, TODAY)
    assert len(trans) == 1 and trans[0]["from_state"] == "holding" and trans[0]["to_state"] == "sold"
    assert trans[0]["sold_price"] == 410000 and trans[0]["sold_date"] == "2026-06-10"
    assert len(ups) == 1 and ups[0]["state"] == "sold"
    assert stats["sold"] == 1 and ("H", "sale") in stats["checked_keys"]


def test_recheck_still_holding_touches_nothing_but_is_checked():
    prior = {("H", "sale"): _prior_holding("H", "9", 420000, holding_age_days=45)}
    ups, trans = [], []
    checks = [{"kind": "recheck", "key": ("H", "sale"), "property_id": "9", "since": "2026-05-15"}]
    stats = apply_off_market_resolutions(ups, trans, checks, [{"outcome": "holding"}], prior, TODAY)
    assert ups == [] and trans == []               # nothing new asserted; stamped via checked_keys only
    assert ("H", "sale") in stats["checked_keys"] and stats["holding_unresolved"] == 1


def test_cap_bounds_call_count_and_known_sold_yields_priced_transition():
    # The plan's explicit verification: sampling cap holds the call count; a known sold -> priced transition.
    trans = [_dep_trans(f"A{i}", price=500000 - i, days=i) for i in range(10)]  # 10 candidates
    prior = {(f"A{i}", "sale"): _prior_active(f"A{i}", str(i), 500000 - i) for i in range(10)}
    ups = [_holding_ups(f"A{i}") for i in range(10)]
    checks, _ = plan_off_market_checks(ups, trans, prior, TODAY, cap=3)
    assert len(checks) == 3                         # <= cap: the sampling holds the paid-call count
    resolutions = [{"outcome": "sold", "sold_price": 355000, "sold_date": "2026-06-20"} for _ in checks]
    stats = apply_off_market_resolutions(ups, trans, checks, resolutions, prior, TODAY)
    assert stats["sold"] == 3 and len(stats["checked_keys"]) == 3
    sold = [t for t in trans if t["to_state"] == "sold"]
    assert len(sold) == 3 and all(t["sold_price"] == 355000 and t["sold_date"] for t in sold)


# ------------------------------------------------------------------ pipeline wiring (gated to LIVE api)

import ingest.pipelines.listing_lifecycle.pipeline as P  # noqa: E402


def _api_row(**kw):
    base = dict(street_address="1 A St", zip_code="33909", county="Lee", state="FL", city="Cape Coral",
                sale_or_rent="sale", list_price=400000, property_type="single_family", listing_id="rc-1",
                lat=26.68, lon=-81.96, county_fips="12071", days_on_market=None, property_id="p1")
    base.update(kw)
    return base


def _wire(monkeypatch, calls):
    monkeypatch.setattr(P, "scan_county_api", lambda c, k=None, **kw: {
        "rows": [_api_row()], "exhausted": True, "count": 1, "last_status": 200,
        "county_total": 1, "search_calls": 1, "enrich_calls": 0})
    monkeypatch.setattr(P.distill, "load_current_state",
                        lambda *a, **k: {("Z", "sale"): {**_prior_holding("Z", "9", 500000, 40), "county": "Lee"}})
    monkeypatch.setattr(P.distill, "upsert_state", lambda ups, **k: len(ups))
    monkeypatch.setattr(P.distill, "append_transitions", lambda tr, **k: len(tr))
    monkeypatch.setattr(P.distill, "stamp_sold_checked", lambda keys, **k: len(keys))

    def fake_fetch(pid, **k):
        calls.append(pid)
        return {"outcome": "gap"}
    monkeypatch.setattr(P, "fetch_sold_event", fake_fetch)


def test_hook_never_fires_on_dry_run(monkeypatch):
    calls: list = []
    _wire(monkeypatch, calls)
    P.run(dry_run=True, only_county="Lee", today=TODAY, source="api")
    assert calls == []                              # dry-run must make ZERO paid probes


def test_hook_never_fires_on_seed_catchup(monkeypatch):
    calls: list = []
    _wire(monkeypatch, calls)
    P.run(dry_run=False, only_county="Lee", today=TODAY, source="api", catchup=True)
    assert calls == []                              # seed/catch-up baseline: no sold-capture spend


def test_hook_fires_live_and_threads_budget(monkeypatch):
    calls: list = []
    _wire(monkeypatch, calls)
    # One eligible recheck in prior -> the live hook should fire exactly one probe.
    P.run(dry_run=False, only_county="Lee", today=TODAY, source="api")
    assert calls == ["9"]                            # the eligible holding was probed, live
