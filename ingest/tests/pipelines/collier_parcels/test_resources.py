"""Tests for the Collier FDOR cadastral parcel ingest (offline — paginator mocked)."""
from __future__ import annotations

from ingest.pipelines.collier_parcels import pipeline, resources

# Verbatim ArcGIS attribute rows (subset of fields) from the FDOR cadastral.
SAMPLE = [
    {
        "PARCEL_ID": "76715007908",
        "JV": 345431,
        "JV_HMSTD": 345431,
        "AV_HMSTD": 320000,
        "AV_SD": 345431,
        "AV_NSD": 345431,
        "TV_NSD": 340000,
        "SALE_YR1": 2025,
        "SALE_MO1": "05",
        "QUAL_CD1": "01",
        "VI_CD1": "I",
        "PHY_ZIPCD": "34117",
        "DOR_UC": "0100",
        "PA_UC": "01",
    },
    # Non-homestead parcel (jv_hmstd = 0) — kept, but excluded from the SOH gap by the view.
    {"PARCEL_ID": "79860004206", "JV": 230730, "JV_HMSTD": 0, "AV_HMSTD": 0},
    # No PARCEL_ID — must be dropped.
    {"JV": 1000, "JV_HMSTD": 500},
]


def test_normalize_maps_coerces_and_drops():
    rows = resources._normalize(SAMPLE)
    assert len(rows) == 2  # the no-PARCEL_ID row is dropped
    r = rows[0]
    assert r["parcel_id"] == "76715007908"
    assert r["jv_hmstd"] == 345431.0
    assert r["av_hmstd"] == 320000.0
    assert r["tv_nsd"] == 340000.0
    assert r["sale_yr1"] == 2025
    assert r["qual_cd1"] == "01"
    assert r["phy_zipcd"] == "34117"


def test_fetch_uses_keyset_paginator(monkeypatch):
    monkeypatch.setattr(resources, "_iter_collier_attrs", lambda *a, **k: iter(SAMPLE))
    rows = resources.fetch_collier_parcels()
    assert len(rows) == 2
    assert all(r["parcel_id"] for r in rows)


def test_dry_run_writes_nothing(monkeypatch, capsys):
    monkeypatch.setattr(
        pipeline, "fetch_collier_parcels", lambda: resources._normalize(SAMPLE)
    )
    monkeypatch.setattr(pipeline, "arcgis_count", lambda *a, **k: 2)
    rc = pipeline.main(["--dry-run"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "dry-run" in out
    assert "2 parcels" in out
