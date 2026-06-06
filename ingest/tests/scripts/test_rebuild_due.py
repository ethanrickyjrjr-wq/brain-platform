"""Unit tests for rebuild_due.master_is_stale — the freeze-gate parse hardening.

master_is_stale() decides whether to FORCE a master rebuild regardless of source
ingest. It must fail OPEN (force a rebuild) when master.md exists but its
frontmatter can't be verified — otherwise a corrupt/garbled master silently skips
the rebuild, and the freeze watchdog (which only runs when the rebuild step fires)
never arms. The one False-returning case is a genuine cold start (no master.md).
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from ingest.scripts import rebuild_due


def _write_master(tmp_path, body: str):
    p = tmp_path / "master.md"
    p.write_text(body, encoding="utf-8")
    return p


def _valid_master(refined_at: str, ttl: int = 604800) -> str:
    return (
        f"---\nbrain_id: master\nversion: 5\n"
        f"refined_at: {refined_at}\nttl_seconds: {ttl}\n---\n\nbody\n"
    )


def _iso(days_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


# ── characterization: existing behavior we must not regress ────────────────────


def test_cold_start_returns_false(monkeypatch, tmp_path):
    """No master.md on disk → not 'stale'; the cold start is the normal build's job."""
    monkeypatch.setattr(rebuild_due, "MASTER_MD", tmp_path / "does-not-exist.md")
    assert rebuild_due.master_is_stale() is False


def test_within_ttl_returns_false(monkeypatch, tmp_path):
    """Valid frontmatter, 1 day old vs 7-day TTL → fresh, no forced rebuild."""
    monkeypatch.setattr(
        rebuild_due, "MASTER_MD", _write_master(tmp_path, _valid_master(_iso(1)))
    )
    assert rebuild_due.master_is_stale() is False


def test_past_ttl_returns_true(monkeypatch, tmp_path):
    """Valid frontmatter, 8 days old vs 7-day TTL → due, force a rebuild."""
    monkeypatch.setattr(
        rebuild_due, "MASTER_MD", _write_master(tmp_path, _valid_master(_iso(8)))
    )
    assert rebuild_due.master_is_stale() is True


# ── the fix: unverifiable frontmatter must fail OPEN (force a rebuild) ──────────


def test_unparseable_refined_at_forces_rebuild(monkeypatch, tmp_path):
    """refined_at present but not a real date → freshness can't be verified →
    fail OPEN so the rebuild runs and arms the freeze watchdog."""
    monkeypatch.setattr(
        rebuild_due,
        "MASTER_MD",
        _write_master(tmp_path, _valid_master("not-a-real-date")),
    )
    assert rebuild_due.master_is_stale() is True


def test_missing_frontmatter_keys_forces_rebuild(monkeypatch, tmp_path):
    """master.md exists but has no refined_at/ttl_seconds (drift/corruption) →
    unverifiable → fail OPEN. Returning False here was the silent-freeze hole."""
    monkeypatch.setattr(
        rebuild_due, "MASTER_MD", _write_master(tmp_path, "no frontmatter here\n")
    )
    assert rebuild_due.master_is_stale() is True
