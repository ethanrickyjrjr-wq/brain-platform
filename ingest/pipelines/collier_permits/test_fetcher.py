"""Tests for collier_permits fetcher pure functions.

_parse_listing_html and _build_click_js are fully testable without network.
"""
from __future__ import annotations

from ingest.pipelines.collier_permits.fetcher import (
    MonthlyReport,
    _build_click_js,
    _parse_listing_html,
)

# ---------------------------------------------------------------------------
# Sample listing page HTML (mimics colliercountyfl.gov structure)
# ---------------------------------------------------------------------------

_LISTING_HTML = """
<html><body>
  <ul>
    <li><a href="/files/2026-april-issued-permits.xlsx">April 2026</a></li>
    <li><a href="/files/2026-march-issued-permits.xlsx">March 2026</a></li>
    <li><a href="/files/2026-april-applied-permits.xlsx">April 2026</a></li>
    <li><a href="/files/2026-february-issued-permits.xlsx">February 2026</a></li>
    <li><a href="/files/not-a-permit.pdf">Annual Report</a></li>
  </ul>
</body></html>
"""

_BASE_URL = "https://www.colliercountyfl.gov"


# ---------------------------------------------------------------------------
# _parse_listing_html
# ---------------------------------------------------------------------------

def test_parse_listing_html_returns_issued_only() -> None:
    reports = _parse_listing_html(_LISTING_HTML)
    for r in reports:
        assert "applied" not in r.url.lower()


def test_parse_listing_html_sorted_newest_first() -> None:
    reports = _parse_listing_html(_LISTING_HTML)
    assert len(reports) == 3
    assert reports[0].year == 2026 and reports[0].month == 4
    assert reports[1].year == 2026 and reports[1].month == 3
    assert reports[2].year == 2026 and reports[2].month == 2


def test_parse_listing_html_builds_absolute_url() -> None:
    reports = _parse_listing_html(_LISTING_HTML)
    assert all(r.url.startswith(_BASE_URL) for r in reports)


def test_parse_listing_html_ignores_non_xlsx() -> None:
    reports = _parse_listing_html(_LISTING_HTML)
    assert all(r.url.endswith(".xlsx") for r in reports)


def test_parse_listing_html_empty_html_returns_empty() -> None:
    assert _parse_listing_html("") == []


def test_parse_listing_html_no_issued_links_returns_empty() -> None:
    html = '<html><body><a href="/files/annual.pdf">Annual</a></body></html>'
    assert _parse_listing_html(html) == []


# ---------------------------------------------------------------------------
# _build_click_js
# ---------------------------------------------------------------------------

def test_build_click_js_contains_full_url() -> None:
    url = "https://www.colliercountyfl.gov/files/2026-april-issued-permits.xlsx"
    js = _build_click_js(url)
    assert url in js


def test_build_click_js_contains_relative_path() -> None:
    url = "https://www.colliercountyfl.gov/files/2026-april-issued-permits.xlsx"
    js = _build_click_js(url)
    assert "/files/2026-april-issued-permits.xlsx" in js


def test_build_click_js_is_iife() -> None:
    js = _build_click_js("https://www.colliercountyfl.gov/files/test.xlsx")
    assert js.strip().startswith("(()") or js.strip().startswith("(() =>")
    assert js.strip().endswith("})();")


def test_build_click_js_handles_url_without_base_url_prefix() -> None:
    url = "https://www.other-host.gov/file.xlsx"
    js = _build_click_js(url)
    # When URL doesn't start with BASE_URL, rel == url (no strip)
    assert url in js
