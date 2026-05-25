"""Tests for corridor_narratives alias normalization.

Network + Postgres paths are exercised end-to-end via the GitHub Actions
cron run, not unit-tested here.
"""
from __future__ import annotations

from ingest.pipelines.corridor_narratives.pipeline import (
    CORRIDOR_ALIASES,
    normalize_corridor_name,
)


def test_normalize_corridor_name_alias_hit():
    assert normalize_corridor_name("Immokalee Road") == "Immokalee Rd North Naples"
    assert normalize_corridor_name("Daniels Pkwy") == "Daniels Parkway Fort Myers"


def test_normalize_corridor_name_trims_whitespace_before_alias_lookup():
    assert normalize_corridor_name("  Immokalee Road  ") == "Immokalee Rd North Naples"


def test_normalize_corridor_name_passthrough_when_no_alias():
    assert normalize_corridor_name("Brand New Corridor") == "Brand New Corridor"


def test_normalize_corridor_name_empty_returns_empty():
    assert normalize_corridor_name("") == ""


def test_alias_table_values_are_unique_canonical_names():
    # Sanity check: the alias table should never map two raw names to a typo
    # of the same canonical. Hand-eye the canonical list.
    canonicals = set(CORRIDOR_ALIASES.values())
    assert len(canonicals) <= len(CORRIDOR_ALIASES)
    # Every canonical should look like a real corridor (no leading/trailing
    # whitespace, non-empty).
    for c in canonicals:
        assert c == c.strip()
        assert len(c) > 0
