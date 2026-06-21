"""Unit tests for ingest/pipelines/lee_permits/scraper.py JS builders + helpers.

Moved here from ingest/tests/lib/test_crawl4ai_client.py (C2 consolidation): these assert the
Accela-specific date-search / pagination / wait-predicate JS the lee_permits pipeline injects
via Crawl4aiSession.step(). They belong with the pipeline, not the generic crawl4ai client.
Pure string assertions — no browser, no network.
"""
from ingest.pipelines.lee_permits.scraper import (
    GRID_OR_TERMINAL_WAIT,
    _committed_date,
    build_date_search_js,
    build_next_page_js,
    page_changed_wait,
)


def test_date_search_js_sets_both_fields_and_clicks():
    js = build_date_search_js("05/01/2026", "06/16/2026")
    assert "txtGSStartDate" in js and "txtGSEndDate" in js
    assert "05/01/2026" in js and "06/16/2026" in js
    # readback-verify: sets value then checks el.value === val, retries
    assert "el.value === val" in js
    assert "btnNewSearch" in js and ".click()" in js
    # full event set so masked inputs commit
    for ev in ("input", "change", "keyup", "blur"):
        assert ev in js


def test_next_page_js_stashes_markers_before_click():
    js = build_next_page_js()
    assert "window.__prevFirstRow" in js
    assert "CapDetail.aspx" in js  # first-row id derived from the first detail link
    assert "aca_pagination_PrevNext" in js
    # stash MUST precede click (else nothing to compare against)
    assert js.index("__prevFirstRow") < js.index("click()")


def test_page_changed_wait_requires_markers_defined():
    pred = page_changed_wait()
    # the silent-corruption guard: undefined markers must NOT resolve true
    assert "window.__prevFirstRow !== undefined" in pred
    assert "!== window.__prevFirstRow" in pred
    assert pred.startswith("js:")


def test_grid_or_terminal_wait_covers_terminal_states():
    assert GRID_OR_TERMINAL_WAIT.startswith("js:")
    assert "gdvPermitList" in GRID_OR_TERMINAL_WAIT
    # terms compared lowercase — the predicate's regex is lowercase + /i flag
    for term in ("no records", "unable to proceed", "valid datetime"):
        assert term in GRID_OR_TERMINAL_WAIT.lower()


def test_committed_date_reads_input_value_by_id_suffix():
    # the post-search Accela form echoes the submitted value on the masked input
    html = (
        '<div id="ctl00_..._txtGSStartDate_parentGrid" class="grid_7">'
        '<input name="x" id="ctl00_PlaceHolderMain_generalSearchForm_txtGSStartDate"'
        ' type="text" value="05/01/2026" class="masked"></div>'
    )
    assert _committed_date(html, "txtGSStartDate") == "05/01/2026"


def test_committed_date_empty_when_field_absent():
    # un-verifiable (field not echoed) returns "" — caller must NOT treat as a mismatch
    assert _committed_date("<html><body>no form here</body></html>", "txtGSStartDate") == ""
