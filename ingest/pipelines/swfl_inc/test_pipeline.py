"""Parser tests for the swfl_inc Tier-2 pipeline.

Feeds the captured live /blog/ markdown (ingest/pipelines/swfl_inc/__fixtures__/*.md)
through parse_announcements() and asserts the parser reads the REAL page shape —
link-based titles + non-zero-padded MM/DD/YYYY "Date posted" lines — rather than the
old H2/H3 + "Month DD, YYYY" shape it was written for. Also covers the run()-level
cross-feed dedup.

These fixtures are the regression guard against the synthetic-fixture trap: if a future
edit breaks parsing of the live shape, these fail even though the TS pack fixture stays
green.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from pathlib import Path

from ingest.pipelines.swfl_inc.pipeline import (
    SWFL_INC_FEEDS,
    dedup_rows,
    parse_announcements,
)

FIXTURE_DIR = Path(__file__).parent / "__fixtures__"
FIXTURES = {
    "https://www.swflinc.com/blog/business-development": "blog_business_development.md",
    "https://www.swflinc.com/blog/chamber-news": "blog_chamber_news.md",
    "https://www.swflinc.com/blog/policy": "blog_policy.md",
}

# Nav-category labels that must never be mistaken for an article title.
_CHROME_TITLES = {
    "Accommodations & Hotels", "Advocacy & Policy", "Business Builders",
    "Business Development", "Business Guide", "Chamber News", "Email Marketing",
    "Hurricane Ian Resources", "Nonprofit News", "Shop Local", "Social Media",
    "Veteran Resources", "Website & SEO", "Topic/Category", "Search",
    "Page Not Found", "404",
}

_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _load(name: str) -> str:
    return (FIXTURE_DIR / name).read_text(encoding="utf-8")


def test_fixtures_exist_for_every_feed() -> None:
    """Every configured feed has a captured fixture (and vice-versa)."""
    assert set(FIXTURES) == set(SWFL_INC_FEEDS)
    for name in FIXTURES.values():
        assert (FIXTURE_DIR / name).exists(), name


def test_each_fixture_parses_rows_with_iso_dates_and_real_titles() -> None:
    for feed_url, name in FIXTURES.items():
        rows = parse_announcements(_load(name), feed_url)
        assert len(rows) > 0, f"{name}: parsed zero rows"
        for r in rows:
            # Date parsed from MM/DD/YYYY → non-null ISO string.
            assert r["announced_date"] is not None, f"{name}: null date for {r['title']!r}"
            assert _ISO.match(r["announced_date"]), f"{name}: non-ISO date {r['announced_date']!r}"
            # Title is a real headline, not page chrome.
            assert r["title"] not in _CHROME_TITLES, f"{name}: chrome leaked as title: {r['title']!r}"
            assert len(r["title"]) >= 10, f"{name}: implausibly short title {r['title']!r}"
            # source_url points at a /blog/ article (not a bare category feed).
            assert r["source_url"].startswith("https://www.swflinc.com/blog/"), r["source_url"]
            assert r["source_url"].rstrip("/") not in SWFL_INC_FEEDS, (
                f"{name}: source_url is a category feed, not an article: {r['source_url']}"
            )


def test_known_entries_parse_with_expected_dates() -> None:
    """Anchor on specific live entries, including a non-zero-padded date."""
    bd = parse_announcements(_load("blog_business_development.md"),
                             "https://www.swflinc.com/blog/business-development")
    by_title = {r["title"]: r for r in bd}

    express = next((r for r in bd if r["title"].startswith("Express Employment")), None)
    assert express is not None, "Express Employment entry missing"
    assert express["announced_date"] == "2026-05-27"

    # Non-zero-padded day: '04/4/2022' must parse to 2022-04-04, not fail.
    podcast = next((r for r in bd if "Podcast" in r["title"]), None)
    assert podcast is not None and podcast["announced_date"] == "2022-04-04", podcast


def test_count_matches_date_posted_anchors() -> None:
    """One row per 'Date posted MM/DD/YYYY' anchor — no chrome rows, no drops."""
    for feed_url, name in FIXTURES.items():
        md = _load(name)
        anchors = len(re.findall(r"Date\s*posted\s*\d{1,2}/\d{1,2}/\d{4}", md, re.I))
        rows = parse_announcements(md, feed_url)
        assert len(rows) == anchors, f"{name}: {len(rows)} rows vs {anchors} date anchors"


# ── Cross-feed dedup (run()-level) ────────────────────────────────────────────

_NAV = "\n".join(
    f"[{c}](https://www.swflinc.com/blog/{s})"
    for c, s in [("Business Development", "business-development"), ("Chamber News", "chamber-news")]
)

# An article tagged in two categories appears on two feeds with identical text.
_SHARED_ENTRY = """[
Acme Robotics Relocates Headquarters to Fort Myers
](https://www.swflinc.com/blog/acme-robotics-relocates-headquarters-to-fort-myers)
[Business Development](https://www.swflinc.com/blog/business-development),
[Chamber News](https://www.swflinc.com/blog/chamber-news),
[
Acme Robotics Relocates Headquarters to Fort Myers
](https://www.swflinc.com/blog/acme-robotics-relocates-headquarters-to-fort-myers)
Acme Robotics announced it will relocate its headquarters to Fort Myers, Lee County. [Continue Reading](https://www.swflinc.com/blog/acme-robotics-relocates-headquarters-to-fort-myers)
Date posted05/20/2026"""


def test_cross_feed_dedup_collapses_shared_article() -> None:
    feed_a = f"{_NAV}\n{_SHARED_ENTRY}"
    feed_b = f"{_NAV}\n{_SHARED_ENTRY}"

    rows = []
    rows += parse_announcements(feed_a, "https://www.swflinc.com/blog/business-development")
    rows += parse_announcements(feed_b, "https://www.swflinc.com/blog/chamber-news")

    assert len(rows) == 2, "each feed should yield the article once before dedup"
    deduped = dedup_rows(rows)
    acme = [r for r in deduped if r["title"].startswith("Acme Robotics")]
    assert len(acme) == 1, f"cross-feed dedup failed: {[r['title'] for r in deduped]}"
    assert acme[0]["announced_date"] == "2026-05-20"
