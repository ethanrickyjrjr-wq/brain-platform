"""Scraper tests — parse a captured Accela result page into typed rows."""
from pathlib import Path
import pytest
from .scraper import parse_accela_result_page, PermitRow

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_accela_result_page_returns_typed_rows() -> None:
    html = (FIXTURES / "sample_accela_page.html").read_text(encoding="utf-8")
    rows = parse_accela_result_page(html, issued_date_fallback="2026-05-22")
    assert len(rows) >= 1, "expected at least one permit row in the fixture"
    r = rows[0]
    assert isinstance(r, PermitRow)
    assert r.permit_id, "permit_id must be non-empty"
    # v1 stamps issued_date from search end_date (list view has no date column)
    assert r.issued_date == "2026-05-22"
    # v1 leaves permit_type_raw empty (no column on list view)
    assert r.permit_type_raw == ""
    # ZIP and address: list view always carries an address; ZIP extracted by regex
    assert r.address, "address must be non-empty"
    assert r.zip_code is None or len(r.zip_code) == 5


def test_parse_accela_result_page_skips_header_row() -> None:
    """Header text 'Record Number' must not become a permit_id."""
    html = (FIXTURES / "sample_accela_page.html").read_text(encoding="utf-8")
    rows = parse_accela_result_page(html, issued_date_fallback="2026-05-22")
    assert all(r.permit_id.lower() != "record number" for r in rows)


def test_parse_accela_result_page_column_mapping() -> None:
    """Lock the post-2026-05-25 column map. If a future portal change shifts
    columns, this fails with a clear signal instead of silently loading
    addresses-as-permit-ids."""
    import re
    html = (FIXTURES / "sample_accela_page.html").read_text(encoding="utf-8")
    rows = parse_accela_result_page(html, issued_date_fallback="2026-05-22")
    assert rows, "fixture should produce at least one row"
    permit_pattern = re.compile(r"^[A-Z]{2,5}\d{4}-\d{3,6}(?:-R\d+)?$|^\d{2}TMP-\d{4,6}$")
    fl_zip_pattern = re.compile(r"\bFL\s+33\d{3}\b")
    for r in rows:
        assert permit_pattern.match(r.permit_id), (
            f"permit_id {r.permit_id!r} doesn't match Lee's permit-id pattern — "
            f"likely a column-map regression"
        )
        assert fl_zip_pattern.search(r.address), (
            f"address {r.address!r} lacks a Lee County FL ZIP — column map drifted"
        )


def test_parse_accela_result_page_empty_returns_empty_list() -> None:
    assert parse_accela_result_page("") == []
    assert parse_accela_result_page("<html><body>no permits</body></html>") == []
