"""Scraper tests — parse a captured Accela result page into typed rows."""
from pathlib import Path
import pytest
from .scraper import parse_accela_result_page, PermitRow

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_accela_result_page_returns_typed_rows() -> None:
    html = (FIXTURES / "sample_accela_page.html").read_text(encoding="utf-8")
    rows = parse_accela_result_page(html)
    assert len(rows) >= 1, "expected at least one permit row in the fixture"
    r = rows[0]
    assert isinstance(r, PermitRow)
    assert r.permit_id, "permit_id must be non-empty"
    assert r.issued_date, "issued_date must be ISO YYYY-MM-DD"
    assert len(r.issued_date) == 10
    assert r.permit_type_raw is not None
    # ZIP is optional on list view but address must be present
    assert r.address, "address must be non-empty"


def test_parse_accela_result_page_empty_returns_empty_list() -> None:
    assert parse_accela_result_page("") == []
    assert parse_accela_result_page("<html><body>no permits</body></html>") == []
