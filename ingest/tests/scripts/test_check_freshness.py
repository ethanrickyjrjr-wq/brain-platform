"""Unit tests for check_freshness.py — mocked psycopg connections."""
import os
import sys
from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from ingest.scripts.check_freshness import (
    check_tier1_entry,
    check_tier2_entry,
    load_registry,
)

_REGISTRY_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "ingest", "cadence_registry.yaml"
)


# ── mock helpers ──────────────────────────────────────────────────────────────


def _tier1_conn(updated_at_val):
    """Mock connection whose cursor fetchone returns (updated_at_val,) or None."""
    row = (updated_at_val,) if updated_at_val is not None else None
    cur = MagicMock()
    cur.fetchone.return_value = row
    conn = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    return conn


def _tier2_conn(inserted_at_val):
    """Mock connection whose cursor fetchone returns (inserted_at_val,) or None."""
    row = (inserted_at_val,) if inserted_at_val is not None else None
    cur = MagicMock()
    cur.fetchone.return_value = row
    conn = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    return conn


# ── test 1: fresh tier-1 ──────────────────────────────────────────────────────


def test_tier1_fresh_not_stale():
    """A tier-1 entry whose updated_at is today must have status FRESH."""
    conn = _tier1_conn(date.today())
    entry = {
        "name": "zori_swfl",
        "lane": "tier-1-duckdb",
        "cadence_days": 30,
        "tolerance_multiplier": 2.0,
        "inventory_id": "lake-tier1/market/zori_swfl.parquet",
        "inventory_key_type": "exact",
    }
    result = check_tier1_entry(conn, entry)
    assert result["status"] == "FRESH"
    assert result["age_days"] == 0


# ── test 2: stale tier-1 ──────────────────────────────────────────────────────


def test_tier1_stale_when_age_exceeds_threshold():
    """updated_at 90 days ago with cadence=30, tolerance=2.0 (threshold=60) → STALE."""
    stale = date.today() - timedelta(days=90)
    conn = _tier1_conn(stale)
    entry = {
        "name": "storm_history_swfl",
        "lane": "tier-1-duckdb",
        "cadence_days": 30,
        "tolerance_multiplier": 2.0,
        "inventory_id": "lake-tier1/environmental/storm_events_swfl.parquet",
        "inventory_key_type": "exact",
    }
    result = check_tier1_entry(conn, entry)
    assert result["status"] == "STALE"
    assert result["age_days"] == 90
    assert result["threshold_days"] == 60


# ── test 3: fresh tier-2 ──────────────────────────────────────────────────────


def test_tier2_fresh_not_stale():
    """A tier-2 entry loaded today must have status FRESH."""
    conn = _tier2_conn(datetime.now(tz=timezone.utc))
    entry = {
        "name": "bls_laus",
        "lane": "tier-2",
        "cadence_days": 30,
        "tolerance_multiplier": 2.0,
        "dlt_schema_name": "bls_laus",
    }
    result = check_tier2_entry(conn, entry)
    assert result["status"] == "FRESH"
    assert result["age_days"] == 0


# ── test 4: missing tier-1 ────────────────────────────────────────────────────


def test_tier1_missing_when_no_db_row():
    """A tier-1 entry with no row in _tier1_inventory must be flagged MISSING."""
    conn = _tier1_conn(None)
    entry = {
        "name": "fred_g17",
        "lane": "tier-1",
        "cadence_days": 30,
        "tolerance_multiplier": 2.0,
        "inventory_id": "lake-tier1/macro/fred_g17/",
        "inventory_key_type": "prefix",
    }
    result = check_tier1_entry(conn, entry)
    assert result["status"] == "MISSING"
    assert result["last_run"] is None
    assert result["age_days"] is None


# ── test 5: registry smoke test ───────────────────────────────────────────────


def test_registry_loads_and_iterates():
    """cadence_registry.yaml parses and has at least one active pipeline with required keys."""
    registry = load_registry(_REGISTRY_PATH)
    assert "pipelines" in registry, "registry must have a 'pipelines' key"
    assert len(registry["pipelines"]) > 0, "registry must have at least one active pipeline"
    first = registry["pipelines"][0]
    for key in ("name", "lane", "cadence_days", "tolerance_multiplier"):
        assert key in first, f"pipeline entry missing required key: {key}"
