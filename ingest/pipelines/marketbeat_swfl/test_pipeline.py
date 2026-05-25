"""Tests for marketbeat_swfl validation helper.

Network + Postgres paths are not covered here — they require live creds and
get exercised end-to-end via the GitHub Actions cron run.
"""
from __future__ import annotations

import pytest

from ingest.pipelines.marketbeat_swfl.pipeline import ValidationError, validate_row


def test_validate_row_happy_path():
    out = validate_row({
        "submarket": "Naples",
        "quarter": "2026-Q3",
        "vacancy_rate": 5.5,
        "asking_rent_nnn": 38.0,
        "absorption_sqft": 25000,
        "source_url": "https://example.com/q3",
    })
    assert out["id"] == "Naples_2026-Q3"
    assert out["vacancy_rate"] == 5.5


def test_validate_row_nullable_metrics_pass_through():
    out = validate_row({
        "submarket": "Fort Myers",
        "quarter": "2026-Q3",
        "vacancy_rate": None,
        "asking_rent_nnn": None,
        "absorption_sqft": None,
        "source_url": None,
    })
    assert out["vacancy_rate"] is None
    assert out["asking_rent_nnn"] is None


def test_validate_row_rejects_blank_submarket():
    with pytest.raises(ValidationError, match="submarket"):
        validate_row({"submarket": "", "quarter": "2026-Q3"})


def test_validate_row_rejects_invalid_quarter():
    with pytest.raises(ValidationError, match="quarter"):
        validate_row({"submarket": "Naples", "quarter": "Q3 2026"})


def test_validate_row_rejects_vacancy_above_max():
    with pytest.raises(ValidationError, match="vacancy_rate=99"):
        validate_row({
            "submarket": "Naples",
            "quarter": "2026-Q3",
            "vacancy_rate": 99,
        })


def test_validate_row_rejects_rent_below_min():
    with pytest.raises(ValidationError, match="asking_rent_nnn=2"):
        validate_row({
            "submarket": "Naples",
            "quarter": "2026-Q3",
            "asking_rent_nnn": 2,
        })


def test_validate_row_accepts_negative_absorption():
    # Negative absorption is valid (give-back).
    out = validate_row({
        "submarket": "Estero Blvd",
        "quarter": "2026-Q3",
        "absorption_sqft": -50000,
    })
    assert out["absorption_sqft"] == -50000


def test_validate_row_rejects_absorption_out_of_window():
    with pytest.raises(ValidationError, match="absorption_sqft"):
        validate_row({
            "submarket": "Naples",
            "quarter": "2026-Q3",
            "absorption_sqft": 1_000_000,
        })
