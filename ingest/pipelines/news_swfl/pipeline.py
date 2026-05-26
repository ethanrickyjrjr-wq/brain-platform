"""SWFL news daily ingest -> Tier 1 cold storage (GitHub Actions cron).

Calls Firecrawl /v2/scrape per source landing page, dedupes by URL, writes the
batch as one NDJSON file under `lake-tier1/news/year=YYYY/month=MM/day=DD/`
in Supabase Storage. No Postgres table -- Tier 1 stays cold until a consuming
brain ships (per the data tier policy). Per-run audit row in
`data_lake._tier1_inventory` with pack_id = NULL.

Env: FIRECRAWL_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_KEY +
DESTINATION__POSTGRES__CREDENTIALS (for the inventory upsert).

CLI:
  python -m ingest.pipelines.news_swfl.pipeline
  python -m ingest.pipelines.news_swfl.pipeline --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from ingest.lib.firecrawl_client import scrape
from ingest.lib.storage_uploader import _upload_bytes  # type: ignore[attr-defined]
from ingest.lib.tier1_inventory import upsert_inventory_row


SOURCES = [
    "https://gulfshoresbusiness.com",
    "https://www.naplesnews.com/business/",
    "https://www.news-press.com/business/",
    "https://www.businessobserverfl.com",
    "https://www.winknews.com/category/local/business/",
]


def collect_articles(sources: list[str]) -> list[dict[str, Any]]:
    """Scrape each source, return one normalized article record per source page.

    v1 stores the LANDING PAGE markdown — we're not crawling individual articles
    here, just capturing the page state for downstream Graphiti / future analysis.
    Per-article extraction can be a v2 enhancement.
    """
    iso = datetime.now(timezone.utc).isoformat()
    seen: set[str] = set()
    articles: list[dict[str, Any]] = []
    for url in sources:
        print(f"news_swfl: scraping {url}...")
        try:
            response = scrape(url, only_main_content=True)
        except Exception as exc:
            # Single-source failure shouldn't kill the whole batch. Surface it.
            print(f"  -> ERROR scraping {url}: {exc!r}")
            continue
        data = response.get("data", response)
        markdown = data.get("markdown", "")
        metadata = data.get("metadata", {})
        source_url = metadata.get("sourceURL") or metadata.get("url") or url
        if source_url in seen:
            continue
        seen.add(source_url)
        articles.append({
            "url": source_url,
            "title": metadata.get("title"),
            "published_date": metadata.get("publishedTime") or metadata.get("article_published_time"),
            "content_md": markdown,
            "source_domain": urlparse(source_url).netloc,
            "_ingested_at": iso,
        })
        print(f"  -> {len(markdown)} chars markdown")
    return articles


def to_ndjson(articles: list[dict[str, Any]]) -> bytes:
    return ("\n".join(json.dumps(a, ensure_ascii=False) for a in articles) + "\n").encode("utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    articles = collect_articles(SOURCES)
    if not articles:
        raise RuntimeError("news_swfl: zero articles after dedupe — investigate.")

    now = datetime.now(timezone.utc)
    yyyy = f"{now.year:04d}"
    mm = f"{now.month:02d}"
    dd = f"{now.day:02d}"
    iso = now.isoformat()
    path = f"news/year={yyyy}/month={mm}/day={dd}/run-{iso}.ndjson"
    bucket = "lake-tier1"
    body = to_ndjson(articles)

    print(f"news_swfl: built {len(articles)} articles, {len(body)} bytes NDJSON.")

    if args.dry_run:
        print(f"news_swfl: --dry-run, skipping upload to {bucket}/{path}.")
        return 0

    _upload_bytes(bucket, path, body, "application/x-ndjson")
    print(f"news_swfl: uploaded to {bucket}/{path}.")

    upsert_inventory_row(
        bucket=bucket,
        path=path,
        vintage=f"{yyyy}-{mm}-{dd}",
        byte_size=len(body),
        pack_id=None,  # Tier 1 cold storage — no consuming pack yet.
        source_url=None,
    )
    print(f"news_swfl: tier1_inventory row written for {bucket}/{path}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
