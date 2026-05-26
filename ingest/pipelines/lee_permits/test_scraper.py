"""Scraper tests — parse a captured Accela result page into typed rows."""
from pathlib import Path
import pytest
from .scraper import (
    PermitRow,
    parse_accela_result_page,
    parse_cap_detail_html,
    parse_page_count,
)

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


# ---------------------------------------------------------------------------
# v2 tests — pagination, TMP filtering, cap_detail_url, detail-page parser
# ---------------------------------------------------------------------------

def test_parse_page_count_reads_fixture() -> None:
    """sample_accela_page.html carries pagecount="11"."""
    html = (FIXTURES / "sample_accela_page.html").read_text(encoding="utf-8")
    assert parse_page_count(html) == 11


def test_parse_page_count_returns_1_when_absent() -> None:
    assert parse_page_count("<html><body>no pager</body></html>") == 1
    assert parse_page_count("") == 1


def test_parse_accela_result_page_filters_tmp_rows() -> None:
    """26TMP-* rows must not appear in the parsed result."""
    html = (FIXTURES / "sample_accela_page.html").read_text(encoding="utf-8")
    rows = parse_accela_result_page(html, issued_date_fallback="2026-05-22")
    assert rows, "should have at least one non-TMP row"
    for r in rows:
        assert not r.permit_id.startswith("26TMP-"), (
            f"TMP row leaked into result: {r.permit_id}"
        )


def test_parse_accela_result_page_cap_detail_url_present() -> None:
    """Non-TMP rows that have a CapDetail.aspx <a> tag must carry the URL."""
    html = (FIXTURES / "sample_accela_page.html").read_text(encoding="utf-8")
    rows = parse_accela_result_page(html, issued_date_fallback="2026-05-22")
    # All non-TMP rows in the fixture have <a href="...CapDetail.aspx..."> links
    assert all(r.cap_detail_url is not None for r in rows), (
        "expected every non-TMP row in the fixture to carry a cap_detail_url"
    )
    # URL must contain the real host and CapDetail path
    for r in rows:
        assert "aca-prod.accela.com" in (r.cap_detail_url or "")
        assert "CapDetail.aspx" in (r.cap_detail_url or "")


def test_parse_accela_result_page_cap_detail_url_decoded() -> None:
    """BeautifulSoup should decode &amp; in hrefs to & so URLs are valid."""
    html = (FIXTURES / "sample_accela_page.html").read_text(encoding="utf-8")
    rows = parse_accela_result_page(html, issued_date_fallback="2026-05-22")
    for r in rows:
        if r.cap_detail_url:
            assert "&amp;" not in r.cap_detail_url, (
                f"HTML entity not decoded in cap_detail_url: {r.cap_detail_url}"
            )


# --- parse_cap_detail_html ---

def test_parse_cap_detail_html_issued_date() -> None:
    html = (FIXTURES / "sample_capdetail_page.html").read_text(encoding="utf-8")
    result = parse_cap_detail_html(html)
    assert result["issued_date"] == "2026-04-15", (
        f"expected 2026-04-15, got {result['issued_date']!r}"
    )


def test_parse_cap_detail_html_declared_value() -> None:
    html = (FIXTURES / "sample_capdetail_page.html").read_text(encoding="utf-8")
    result = parse_cap_detail_html(html)
    assert result["declared_value_usd"] == 25000.0, (
        f"expected 25000.0, got {result['declared_value_usd']!r}"
    )


def test_parse_cap_detail_html_permit_type() -> None:
    html = (FIXTURES / "sample_capdetail_page.html").read_text(encoding="utf-8")
    result = parse_cap_detail_html(html)
    assert result["permit_type_raw"] == "Building Residential", (
        f"expected 'Building Residential', got {result['permit_type_raw']!r}"
    )


def test_parse_cap_detail_html_empty_returns_none_fields() -> None:
    result = parse_cap_detail_html("")
    assert result["issued_date"] is None
    assert result["declared_value_usd"] is None
    assert result["permit_type_raw"] is None


def test_parse_cap_detail_html_missing_fields_return_none() -> None:
    result = parse_cap_detail_html("<html><body><p>No fields here</p></body></html>")
    assert result["issued_date"] is None
    assert result["declared_value_usd"] is None
    assert result["permit_type_raw"] in (None, "")
