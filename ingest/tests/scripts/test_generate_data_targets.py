"""Unit tests for generate_data_targets.py pure builders — no DB."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from ingest.scripts.generate_data_targets import (
    EXCLUDED_WANTED_SEEDS,
    build_stale_targets,
    build_skill_targets,
    build_low_n_targets,
    build_excluded_targets,
    build_falsifiability_targets,
    keys_to_drop,
)


def test_build_stale_targets_flags_stale_missing_and_low_volume():
    probe = [
        {"name": "fresh_one", "lane": "tier-2", "status": "FRESH",
         "age_days": 1, "threshold_days": 60, "cadence_days": 30, "volume_status": None},
        {"name": "stale_one", "lane": "tier-2", "status": "STALE",
         "age_days": 90, "threshold_days": 60, "cadence_days": 30, "volume_status": None},
        {"name": "missing_one", "lane": "tier-1", "status": "MISSING",
         "age_days": None, "threshold_days": 60, "cadence_days": 30, "volume_status": None},
        {"name": "low_vol", "lane": "tier-2", "status": "FRESH",
         "age_days": 1, "threshold_days": 60, "cadence_days": 30,
         "volume_status": "LOW_VOLUME", "volume_landed": 2, "volume_min": 100},
    ]
    out = build_stale_targets(probe)
    keys = {t["target_key"] for t in out}
    assert keys == {"stale:stale_one", "stale:missing_one", "stale:low_vol"}
    missing = next(t for t in out if t["subject"] == "missing_one")
    assert missing["priority"] == 1               # MISSING is most urgent
    assert all(t["kind"] == "stale" for t in out)
    stale = next(t for t in out if t["subject"] == "stale_one")
    assert "90" in stale["reason"] and "60" in stale["reason"]   # N-stamped (age vs threshold)


def test_build_skill_targets_flags_nonpositive_lift_above_min_n():
    rows = [
        {"slug": "a", "n": 70, "system_accuracy": 0.42, "persistence_accuracy": 0.49, "lift": -0.07},
        {"slug": "b", "n": 70, "system_accuracy": 0.60, "persistence_accuracy": 0.50, "lift": 0.10},
        {"slug": "c", "n": 8,  "system_accuracy": 0.30, "persistence_accuracy": 0.50, "lift": -0.20},
    ]
    out = build_skill_targets(rows, min_n=15)
    keys = {t["target_key"] for t in out}
    assert keys == {"low_skill:a"}               # b beats naive; c is below min_n
    assert out[0]["metric"]["lift"] == -0.07
    assert "N=70" in out[0]["reason"]


def test_build_low_n_targets_flags_under_floor_but_positive():
    counts = {"a": 70, "b": 12, "c": 0}
    out = build_low_n_targets(counts, floor=30, corpus="backtest")
    keys = {t["target_key"] for t in out}
    assert keys == {"low_n:b"}                    # a is fine; c has zero (no calls to grow)
    assert "N=12" in out[0]["reason"]


def test_build_excluded_targets_has_four_seeds():
    out = build_excluded_targets()
    assert len(out) == len(EXCLUDED_WANTED_SEEDS) == 4
    assert {t["subject"] for t in out} == {"zori_rent", "census_acs", "bls_qcew", "tdt_collections"}
    assert all(t["kind"] == "excluded_wanted" and t["status"] == "want" for t in out)


def test_build_falsifiability_targets_flags_high_ungradeable_brain():
    # master: 6 gradeable + 5 ungradeable (claim-bearing) → 45% ungradeable, 0 slug preds.
    claim_counts = {"master": {"gradeable": 6, "ungradeable": 5}}
    out = build_falsifiability_targets(claim_counts, slug_predictions_logged=0,
                                       min_claims=8, max_ungradeable_rate=0.4)
    assert {t["target_key"] for t in out} == {"falsifiability_gap:master"}
    m = out[0]["metric"]
    assert m["ungradeable_n"] == 5 and m["gradeable_n"] == 6 and m["slug_predictions_logged"] == 0


def test_build_falsifiability_targets_ignores_healthy_brain():
    claim_counts = {"good": {"gradeable": 18, "ungradeable": 2}}
    out = build_falsifiability_targets(claim_counts, slug_predictions_logged=5,
                                       min_claims=8, max_ungradeable_rate=0.4)
    assert out == []


def test_keys_to_drop_returns_resolved_generator_keys():
    existing = {"stale:a", "low_skill:b", "excluded_wanted:zori_rent"}
    current = {"low_skill:b", "excluded_wanted:zori_rent"}
    assert keys_to_drop(existing, current) == {"stale:a"}
