"""
SWFL Inc. Economic Development Announcements — weekly ingest pipeline.

Scrapes the SWFL Inc. blog category feeds (https://www.swflinc.com/blog/...) via
Firecrawl (primary) / Spider (fallback), extracts economic development
announcement records, writes raw NDJSON to Tier-1 cold storage, and
upserts structured rows into public.swfl_inc_announcements.

Source: Southwest Florida Inc. — Lee County Economic Development Organization
  Feeds: /blog/business-development, /blog/chamber-news, /blog/policy
  (The bare /blog/ index and these category sub-feeds carry the news/announcement
   stream. There is NO /news/ page — it 404s. See SWFL_INC_FEEDS below.)
  Cadence: weekly (new project announcements released continuously)

Usage:
  python -m ingest.pipelines.swfl_inc.pipeline [--dry-run]

Environment:
  FIRECRAWL_API_KEY                  — Firecrawl API key (required)
  DESTINATION__POSTGRES__CREDENTIALS — psycopg3 connection URI (required unless --dry-run)
  SUPABASE_URL                       — Supabase project URL (required unless --dry-run)
  SUPABASE_SERVICE_KEY               — Supabase service key (required unless --dry-run)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from typing import Any

import psycopg

from ingest.lib.extract_client import scrape_with_fallback
from ingest.lib.storage_uploader import _upload_bytes  # type: ignore[attr-defined]
from ingest.lib.tier1_inventory import upsert_inventory_row

# ── Constants ─────────────────────────────────────────────────────────────────

# SWFL Inc. publishes its announcement stream under /blog/ category feeds. The
# econ-dev-relevant categories (verified 200 + listing structure 2026-05-30):
SWFL_INC_FEEDS = [
    "https://www.swflinc.com/blog/business-development",
    "https://www.swflinc.com/blog/chamber-news",
    "https://www.swflinc.com/blog/policy",
]

TABLE = "swfl_inc_announcements"
TIER1_BUCKET = "lake-tier1"

# Nav-category slugs that appear as links on every page — these are NOT articles.
# Any /blog/<slug> link whose slug is in this set is the category chrome, not a story.
_CATEGORY_SLUGS = {
    "accommodations-and-hotels",
    "policy",
    "business-builders",
    "business-development",
    "business-guide",
    "chamber-news",
    "email-marketing",
    "hurricane-ian-resources",
    "nonprofit-news",
    "shop-local",
    "social-media",
    "veteran-resources",
    "website-and-seo",
}

# Each listing entry ends with a "Date posted MM/DD/YYYY" line (day/month NOT
# zero-padded, e.g. 05/3/2023). This is the anchor we split entries on.
_DATE_POSTED = re.compile(
    r"Date\s*posted\s*(\d{1,2})/(\d{1,2})/(\d{4})",
    re.IGNORECASE,
)

# Markdown link to a blog article: [text](https://www.swflinc.com/blog/slug).
# Link text may span multiple lines, so [^\]] (which includes newlines) is used.
_ARTICLE_LINK = re.compile(
    r"\[\s*([^\]]+?)\s*\]\(\s*(https?://www\.swflinc\.com/blog/[^)\s]+?)\s*\)",
)

_NON_TITLE_LINK_TEXT = {"continue reading", "read more", "learn more", "view", "watch"}

_MONTH_NAMES: dict[str, int] = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7,
    "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_DATE_MDY = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|"
    r"October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
    r"\.?\s+(\d{1,2}),?\s+(\d{4})\b",
    re.IGNORECASE,
)
_DATE_YMD = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_DATE_SLASH = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")

_INVESTMENT_SCALED = re.compile(
    r"\$\s*([\d,]+(?:\.\d+)?)\s*(billion|million|thousand|B|M|K)\b",
    re.IGNORECASE,
)
_INVESTMENT_CONTEXT = re.compile(
    r"\$\s*([\d,]+(?:\.\d+)?)\s*(?:in|of)?\s*(?:capital\s+)?(?:investment|funding|expansion|project)",
    re.IGNORECASE,
)

_JOBS_RE = re.compile(
    r"\b(\d{1,5})\s*(?:new\s+)?(?:full[- ]time\s+)?jobs?\b",
    re.IGNORECASE,
)

_COUNTY_MAP: list[tuple[str, str]] = [
    ("lee county", "lee"),
    ("collier county", "collier"),
    ("charlotte county", "charlotte"),
    ("hendry county", "hendry"),
    ("fort myers", "lee"),
    ("cape coral", "lee"),
    ("bonita springs", "lee"),
    ("estero", "lee"),
    ("naples", "collier"),
    ("marco island", "collier"),
]

_CATEGORY_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\breloca|headquarter|new\s+facilit|new\s+office|new\s+plant|moving\s+to\b", re.I), "relocation"),
    (re.compile(r"\bexpan|additional\s+(?:facilit|jobs?|employees?|space)\b", re.I), "expansion"),
    (re.compile(r"\bgrant\b|award(?:ed)?\b|funding\b|incentive\b", re.I), "grant"),
    (re.compile(r"\binfrastructur|road\b|port\b|airport\b|transit\b|utility\b", re.I), "infrastructure"),
    (re.compile(r"\bpartner|agreement|memorandum|MOU\b|coalition\b", re.I), "partnership"),
    (re.compile(r"\bworkforce|training\b|talent\b|jobs\s+program\b", re.I), "workforce"),
]

Row = dict[str, Any]


# ── Parsing helpers ───────────────────────────────────────────────────────────


def _clean_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _slug_of(url: str) -> str:
    m = re.search(r"/blog/([^/?#]+)", url)
    return m.group(1).lower() if m else ""


def _parse_date(text: str) -> date | None:
    m = _DATE_MDY.search(text)
    if m:
        month = _MONTH_NAMES.get(m.group(1).lower().rstrip("."))
        if month:
            try:
                return date(int(m.group(3)), month, int(m.group(2)))
            except ValueError:
                pass
    m2 = _DATE_YMD.search(text)
    if m2:
        try:
            return date(int(m2.group(1)), int(m2.group(2)), int(m2.group(3)))
        except ValueError:
            pass
    m3 = _DATE_SLASH.search(text)
    if m3:
        try:
            return date(int(m3.group(3)), int(m3.group(1)), int(m3.group(2)))
        except ValueError:
            pass
    return None


def _parse_investment_usd(text: str) -> float | None:
    m = _INVESTMENT_SCALED.search(text)
    if m:
        raw = float(m.group(1).replace(",", ""))
        unit = m.group(2).lower()
        multipliers = {"billion": 1e9, "b": 1e9, "million": 1e6, "m": 1e6, "thousand": 1e3, "k": 1e3}
        return raw * multipliers.get(unit, 1)
    m2 = _INVESTMENT_CONTEXT.search(text)
    if m2:
        try:
            return float(m2.group(1).replace(",", ""))
        except ValueError:
            pass
    return None


def _parse_jobs(text: str) -> int | None:
    m = _JOBS_RE.search(text)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            pass
    return None


def _infer_county(text: str) -> str:
    lower = text.lower()
    for pattern, county in _COUNTY_MAP:
        if pattern in lower:
            return county
    return "swfl"


def _infer_category(text: str) -> str | None:
    for pattern, cat in _CATEGORY_PATTERNS:
        if pattern.search(text):
            return cat
    return None


def _make_id(title: str, announced_date: date | None, scraped_date: date) -> str:
    key = (
        f"{title.strip().lower()}|"
        f"{announced_date.isoformat() if announced_date else scraped_date.isoformat()}"
    )
    return hashlib.md5(key.encode("utf-8")).hexdigest()[:16]


def _entry_summary(entry_text: str) -> str | None:
    """Build a readable summary from an entry block: drop the read-more/title
    link markup, keep link text for the rest, strip the byline, collapse."""
    s = entry_text
    # Drop call-to-action links entirely (continue reading / read more / ...).
    s = re.sub(
        r"\[\s*(?:continue\s+reading|read\s+more|learn\s+more|view|watch)[^\]]*\]\([^)]*\)",
        " ",
        s,
        flags=re.I,
    )
    # Convert remaining [text](url) -> text.
    s = re.sub(r"\[\s*([^\]]+?)\s*\]\([^)]*\)", r"\1", s)
    # Strip the "Postedby <name>" byline.
    s = re.sub(r"Posted\s*by\s+[\w.\-' ]{2,40}", " ", s, flags=re.I)
    s = _clean_ws(s)
    return s[:500] or None


def parse_announcements(markdown: str, feed_url: str) -> list[Row]:
    """Parse SWFL Inc. blog-feed markdown into announcement rows.

    The live listing renders each entry as a repeated `[Title](article-url)`
    link followed by category-tag links, an excerpt, a `[Continue Reading]`
    link, an optional `Postedby` byline, and a `Date posted MM/DD/YYYY` line.
    We anchor on the date (one per entry), take the text since the previous
    date as that entry's block, and read the title from the first non-category,
    non-CTA blog link in the block.
    """
    text = markdown.replace("\r\n", "\n")
    now = datetime.now(timezone.utc)
    scraped_date = now.date()
    now_iso = now.isoformat()

    rows: list[Row] = []
    last_end = 0

    for date_match in _DATE_POSTED.finditer(text):
        segment = text[last_end:date_match.start()]
        last_end = date_match.end()

        try:
            announced_date: date | None = date(
                int(date_match.group(3)),  # year
                int(date_match.group(1)),  # month
                int(date_match.group(2)),  # day
            )
        except ValueError:
            announced_date = None

        # Title = first blog link in the block that is neither a nav-category
        # link nor a call-to-action ("Continue Reading").
        title: str | None = None
        article_url: str | None = None
        title_pos = 0
        for link_match in _ARTICLE_LINK.finditer(segment):
            link_text = _clean_ws(link_match.group(1))
            url = link_match.group(2)
            if _slug_of(url) in _CATEGORY_SLUGS:
                continue
            if link_text.lower() in _NON_TITLE_LINK_TEXT:
                continue
            if len(link_text) < 10:
                continue
            title = link_text
            article_url = url
            title_pos = link_match.start()
            break

        if not title:
            continue

        # Inference runs on the entry body (from the title link onward), which
        # excludes the leading page chrome that precedes the first entry.
        entry_text = segment[title_pos:]
        body = _entry_summary(entry_text) or ""
        investment_usd = _parse_investment_usd(body)
        jobs = _parse_jobs(body)
        county = _infer_county(entry_text)
        category = _infer_category(body) or _infer_category(title)

        rows.append({
            "id": _make_id(title, announced_date, scraped_date),
            "title": title,
            "announced_date": announced_date.isoformat() if announced_date else None,
            "county": county,
            "category": category,
            "investment_usd": investment_usd,
            "jobs": jobs,
            "summary": body or None,
            "source_url": article_url or feed_url,
            "scraped_at": now_iso,
        })

    return rows


def dedup_rows(rows: list[Row]) -> list[Row]:
    """Cross-feed dedup by `id` (last-write-wins). An article tagged in two
    categories appears on two feeds; both resolve to the same id."""
    by_id: dict[str, Row] = {}
    for row in rows:
        by_id[row["id"]] = row
    return list(by_id.values())


# ── Fetch ─────────────────────────────────────────────────────────────────────


def fetch_feeds(api_key: str) -> list[tuple[str, str]]:
    """Scrape each feed in SWFL_INC_FEEDS via Firecrawl primary, Spider fallback.

    Returns a list of (markdown, feed_url) — one entry per feed that returned
    content. Feeds that come back empty are skipped with a warning.
    """
    os.environ.setdefault("FIRECRAWL_API_KEY", api_key)
    results: list[tuple[str, str]] = []
    for feed_url in SWFL_INC_FEEDS:
        response = scrape_with_fallback(feed_url, only_main_content=True)
        data = response["data"]
        markdown = data.get("markdown", "") if isinstance(data, dict) else ""
        for entry in response.get("_provenance", []):
            if entry.get("ok"):
                kb = entry.get("bytes", 0) / 1024.0
                print(
                    f"  {feed_url}: vendor={entry.get('vendor')} "
                    f"bytes={entry.get('bytes', 0)} ({kb:.1f} KB)"
                )
                break
        if markdown:
            results.append((markdown, feed_url))
        else:
            print(f"  WARNING: {feed_url} returned empty markdown — skipping.")
    return results


def to_ndjson(rows: list[Row]) -> bytes:
    return (
        "\n".join(json.dumps(r, ensure_ascii=False, default=str) for r in rows) + "\n"
    ).encode("utf-8")


# ── DB upsert ─────────────────────────────────────────────────────────────────


UPSERT_SQL = f"""
INSERT INTO {TABLE} (
    id, title, announced_date, county, category,
    investment_usd, jobs, summary, source_url, scraped_at, inserted_at
)
VALUES (
    %(id)s, %(title)s, %(announced_date)s, %(county)s, %(category)s,
    %(investment_usd)s, %(jobs)s, %(summary)s, %(source_url)s, %(scraped_at)s, NOW()
)
ON CONFLICT (id) DO UPDATE SET
    title          = EXCLUDED.title,
    announced_date = EXCLUDED.announced_date,
    county         = EXCLUDED.county,
    category       = EXCLUDED.category,
    investment_usd = EXCLUDED.investment_usd,
    jobs           = EXCLUDED.jobs,
    summary        = EXCLUDED.summary,
    source_url     = EXCLUDED.source_url,
    scraped_at     = EXCLUDED.scraped_at
"""


def upsert_rows(rows: list[Row], conn_str: str) -> int:
    if not rows:
        return 0
    with psycopg.connect(conn_str) as conn:
        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, rows)
        conn.commit()
    return len(rows)


# ── Orchestration ─────────────────────────────────────────────────────────────


def run(dry_run: bool, conn_str: str | None, api_key: str) -> None:
    print(f"swfl_inc: fetching {len(SWFL_INC_FEEDS)} blog feeds via Firecrawl/Spider...")
    feeds = fetch_feeds(api_key)

    if not feeds:
        raise RuntimeError(
            "swfl_inc: every feed returned empty markdown — check SWFL_INC_FEEDS."
        )

    parsed: list[Row] = []
    for markdown, feed_url in feeds:
        parsed.extend(parse_announcements(markdown, feed_url))

    rows = dedup_rows(parsed)
    print(
        f"swfl_inc: parsed {len(parsed)} rows across {len(feeds)} feeds, "
        f"{len(rows)} unique after cross-feed dedup."
    )
    for r in rows[:8]:
        print(
            f"  {r.get('announced_date', '?') or '?':<12}  {r['title'][:55]:<55}  "
            f"county={r['county']:<8}  cat={r.get('category')}  "
            f"inv={r.get('investment_usd')}  jobs={r.get('jobs')}"
        )
    if len(rows) > 8:
        print(f"  ... and {len(rows) - 8} more")

    now = datetime.now(timezone.utc)
    yyyy = f"{now.year:04d}"
    mm = f"{now.month:02d}"
    dd = f"{now.day:02d}"
    iso_ts = now.isoformat()
    tier1_path = f"econ/swfl_inc/year={yyyy}/month={mm}/day={dd}/run-{iso_ts}.ndjson"
    ndjson_body = to_ndjson(rows)

    if dry_run:
        print(f"swfl_inc: --dry-run, skipping upload to {TIER1_BUCKET}/{tier1_path}.")
        print("swfl_inc: --dry-run, skipping DB upsert.")
        return

    if not conn_str:
        raise RuntimeError(
            "DESTINATION__POSTGRES__CREDENTIALS not set — cannot write to DB."
        )

    _upload_bytes(TIER1_BUCKET, tier1_path, ndjson_body, "application/x-ndjson")
    print(f"swfl_inc: uploaded {len(ndjson_body)} bytes to {TIER1_BUCKET}/{tier1_path}.")

    upsert_inventory_row(
        bucket=TIER1_BUCKET,
        path=tier1_path,
        vintage=f"{yyyy}-{mm}-{dd}",
        byte_size=len(ndjson_body),
        pack_id="econ-dev-swfl",
        # The run pulls all three feeds; the inventory row represents the blog
        # source as a whole, not just the first feed.
        source_url="https://www.swflinc.com/blog/",
    )
    print(f"swfl_inc: tier1_inventory row written for {TIER1_BUCKET}/{tier1_path}.")

    written = upsert_rows(rows, conn_str)
    print(f"swfl_inc: upserted {written} rows into {TABLE}.")


# ── CLI ───────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="SWFL Inc. Economic Development Announcements ingest pipeline."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and print rows without writing to DB or Tier-1 storage.",
    )
    args = parser.parse_args(argv)

    api_key = os.environ.get("FIRECRAWL_API_KEY")
    if not api_key:
        print("ERROR: FIRECRAWL_API_KEY not set.", file=sys.stderr)
        return 1

    conn_str = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    run(dry_run=args.dry_run, conn_str=conn_str, api_key=api_key)
    return 0


if __name__ == "__main__":
    sys.exit(main())
