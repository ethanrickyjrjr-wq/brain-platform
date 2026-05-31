"""
SWFL Inc. Economic Development Announcements — weekly ingest pipeline.

Scrapes the SWFL Inc. news page (https://www.swflinc.com/news/) via
Firecrawl (primary) / Spider (fallback), extracts economic development
announcement records, writes raw NDJSON to Tier-1 cold storage, and
upserts structured rows into public.swfl_inc_announcements.

Source: Southwest Florida Inc. — Lee County Economic Development Organization
  URL: https://www.swflinc.com/news/
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

SWFL_INC_NEWS_URL = "https://www.swflinc.com/news/"
TABLE = "swfl_inc_announcements"
TIER1_BUCKET = "lake-tier1"

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


def parse_announcements(markdown: str, source_url: str) -> list[Row]:
    """Parse Firecrawl markdown from swflinc.com/news/ into announcement rows.

    Splits on H2/H3 headings. For each section extracts title, date,
    investment, jobs, county, category, and a brief summary.
    """
    text = markdown.replace("\r\n", "\n")
    now = datetime.now(timezone.utc)
    scraped_date = now.date()
    now_iso = now.isoformat()

    sections = re.split(r"\n(?=#{2,3}\s)", text)
    rows: list[Row] = []

    for section in sections:
        lines = [ln.strip() for ln in section.strip().split("\n") if ln.strip()]
        if not lines:
            continue

        first = lines[0]
        if not first.startswith("#"):
            continue

        # Strip heading markers and inline Markdown links from title
        title_raw = re.sub(r"^#+\s*", "", first)
        title_raw = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", title_raw).strip()
        if not title_raw or len(title_raw) < 10:
            continue

        body = " ".join(lines[1:])
        announced_date = _parse_date(section)
        investment_usd = _parse_investment_usd(body)
        jobs = _parse_jobs(body)
        county = _infer_county(section)
        category = _infer_category(body) or _infer_category(title_raw)

        # Summary: first non-nav paragraph up to 500 chars
        summary_lines = [
            ln for ln in lines[1:]
            if ln
            and not ln.startswith("#")
            and not re.match(r"^[-*_]{3,}$", ln)
            and not re.match(r"^\[.*\]\(.*\)\s*$", ln)
            and not re.match(r"^(Read\s+More|Learn\s+More|View|Watch)\b", ln, re.I)
        ]
        summary = " ".join(summary_lines)[:500].strip() or None

        rows.append({
            "id": _make_id(title_raw, announced_date, scraped_date),
            "title": title_raw,
            "announced_date": announced_date.isoformat() if announced_date else None,
            "county": county,
            "category": category,
            "investment_usd": investment_usd,
            "jobs": jobs,
            "summary": summary,
            "source_url": source_url,
            "scraped_at": now_iso,
        })

    return rows


# ── Fetch ─────────────────────────────────────────────────────────────────────


def fetch_page(api_key: str) -> tuple[str, str]:
    """Scrape swflinc.com/news/ via Firecrawl primary, Spider fallback.

    Returns (markdown, resolved_source_url).
    """
    os.environ.setdefault("FIRECRAWL_API_KEY", api_key)
    response = scrape_with_fallback(SWFL_INC_NEWS_URL, only_main_content=True)
    data = response["data"]
    markdown = data.get("markdown", "")
    metadata = data.get("metadata", {}) or {}
    resolved_url = metadata.get("sourceURL") or metadata.get("url") or SWFL_INC_NEWS_URL
    for entry in response.get("_provenance", []):
        if entry.get("ok"):
            kb = entry.get("bytes", 0) / 1024.0
            print(
                f"  vendor={entry.get('vendor')} bytes={entry.get('bytes', 0)} ({kb:.1f} KB)"
            )
            break
    return markdown, resolved_url


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
    print("swfl_inc: fetching news page via Firecrawl...")
    markdown, source_url = fetch_page(api_key)

    if not markdown:
        raise RuntimeError("swfl_inc: Firecrawl returned empty markdown — check SWFL_INC_NEWS_URL.")

    rows = parse_announcements(markdown, source_url)
    print(f"swfl_inc: parsed {len(rows)} announcement rows.")
    for r in rows[:5]:
        print(
            f"  {r.get('announced_date', '?'):<12}  {r['title'][:55]:<55}  "
            f"county={r['county']:<8}  inv={r.get('investment_usd')}  jobs={r.get('jobs')}"
        )
    if len(rows) > 5:
        print(f"  ... and {len(rows) - 5} more")

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
        source_url=source_url,
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
