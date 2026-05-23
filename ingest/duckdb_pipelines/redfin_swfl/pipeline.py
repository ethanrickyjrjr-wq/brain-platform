"""Redfin SWFL market tracker → Parquet in Tier 1 Storage.

Run with: python -m ingest.duckdb_pipelines.redfin_swfl.pipeline

What it does:
  1. Stream-downloads zip_code_market_tracker.tsv000.gz from Redfin's public S3
     to a local temp file (~1.5 GB compressed, one-time per monthly run).
  2. DuckDB filters to FL + Cape Coral / Naples metro ZIPs and writes a small
     Parquet to s3://lake-tier1/market/redfin_swfl.parquet.
  3. Upserts one row in data_lake._tier1_inventory.

The temp file is used instead of reading the Redfin URL directly in DuckDB
to avoid any S3-credential collision between Redfin's public bucket and the
Supabase endpoint configured for writes.

Update schedule: Redfin publishes monthly, ~Friday of the third full week
of each month (data for the prior month). Observed S3 last-modified for the
April 2026 update: 2026-04-14. Cron target: 15th of each month.
"""

import os
import sys
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

import duckdb
import requests

from .constants import (
    BUCKET,
    PACK_ID,
    PARQUET_PATH,
    PARQUET_TARGET,
    REDFIN_ZIP_URL,
    STATE_CODE,
    SWFL_METRO_SUBSTRINGS,
)
from ingest.lib.tier1_inventory import upsert_inventory_row


def _load_env() -> None:
    env_path = Path(__file__).parent.parent.parent.parent / ".env.local"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def _configure_s3(con: duckdb.DuckDBPyConnection) -> None:
    con.execute("INSTALL httpfs; LOAD httpfs;")
    endpoint = (
        os.environ["SUPABASE_S3_ENDPOINT"]
        .replace("https://", "")
        .replace("http://", "")
    )
    con.execute(f"""
        SET s3_endpoint='{endpoint}';
        SET s3_access_key_id='{os.environ["SUPABASE_S3_ACCESS_KEY_ID"]}';
        SET s3_secret_access_key='{os.environ["SUPABASE_S3_SECRET_ACCESS_KEY"]}';
        SET s3_region='us-east-1';
        SET s3_url_style='path';
        SET s3_use_ssl=true;
    """)


def _download_source(url: str, dest: Path) -> None:
    """Stream-download the Redfin TSV.gz to dest, showing progress."""
    print(f"  downloading {url}")
    with requests.get(url, stream=True, timeout=300) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        written = 0
        with dest.open("wb") as f:
            for chunk in resp.iter_content(chunk_size=8 * 1024 * 1024):
                f.write(chunk)
                written += len(chunk)
                if total:
                    pct = written / total * 100
                    print(f"\r  {written / 1e6:.0f} MB / {total / 1e6:.0f} MB ({pct:.0f}%)", end="", flush=True)
    print()
    print(f"  download complete: {written / 1e6:.1f} MB")


def _build_metro_filter() -> str:
    clauses = " OR ".join(
        f"PARENT_METRO_REGION LIKE '%{s}%'" for s in SWFL_METRO_SUBSTRINGS
    )
    return f"STATE_CODE = '{STATE_CODE}' AND ({clauses})"


def run(*, target: str = PARQUET_TARGET) -> None:
    _load_env()
    ingested_at = datetime.now(timezone.utc).isoformat()
    vintage = date.today().isoformat()

    print("redfin-swfl: starting ingest")
    print(f"  source: {REDFIN_ZIP_URL}")
    print(f"  target: {target}")

    con = duckdb.connect()
    if target.startswith("s3://"):
        _configure_s3(con)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_file = Path(tmp_dir) / "zip_code_market_tracker.tsv000.gz"

        # Phase 1: download
        _download_source(REDFIN_ZIP_URL, tmp_file)

        # Phase 2: filter and load
        metro_filter = _build_metro_filter()
        print(f"  filtering: {metro_filter}")
        con.execute(f"""
            CREATE TABLE redfin_swfl AS
            SELECT
                PERIOD_BEGIN,
                PERIOD_END,
                PERIOD_DURATION,
                REGION_TYPE,
                REGION_TYPE_ID,
                IS_SEASONALLY_ADJUSTED,
                REGION                         AS zip_code,
                CITY,
                STATE,
                STATE_CODE,
                PROPERTY_TYPE,
                PROPERTY_TYPE_ID,
                MEDIAN_SALE_PRICE,
                MEDIAN_SALE_PRICE_MOM,
                MEDIAN_SALE_PRICE_YOY,
                MEDIAN_LIST_PRICE,
                MEDIAN_LIST_PRICE_MOM,
                MEDIAN_LIST_PRICE_YOY,
                MEDIAN_PPSF,
                MEDIAN_PPSF_MOM,
                MEDIAN_PPSF_YOY,
                MEDIAN_LIST_PPSF,
                MEDIAN_LIST_PPSF_MOM,
                MEDIAN_LIST_PPSF_YOY,
                HOMES_SOLD,
                HOMES_SOLD_MOM,
                HOMES_SOLD_YOY,
                PENDING_SALES,
                PENDING_SALES_MOM,
                PENDING_SALES_YOY,
                NEW_LISTINGS,
                NEW_LISTINGS_MOM,
                NEW_LISTINGS_YOY,
                INVENTORY,
                INVENTORY_MOM,
                INVENTORY_YOY,
                MONTHS_OF_SUPPLY,
                MONTHS_OF_SUPPLY_MOM,
                MONTHS_OF_SUPPLY_YOY,
                MEDIAN_DOM,
                MEDIAN_DOM_MOM,
                MEDIAN_DOM_YOY,
                AVG_SALE_TO_LIST,
                AVG_SALE_TO_LIST_MOM,
                AVG_SALE_TO_LIST_YOY,
                SOLD_ABOVE_LIST,
                SOLD_ABOVE_LIST_MOM,
                SOLD_ABOVE_LIST_YOY,
                PRICE_DROPS,
                PRICE_DROPS_MOM,
                PRICE_DROPS_YOY,
                OFF_MARKET_IN_TWO_WEEKS,
                OFF_MARKET_IN_TWO_WEEKS_MOM,
                OFF_MARKET_IN_TWO_WEEKS_YOY,
                PARENT_METRO_REGION,
                PARENT_METRO_REGION_METRO_CODE,
                LAST_UPDATED,
                '{ingested_at}' AS ingested_at
            FROM read_csv_auto(
                '{tmp_file}',
                delim='\t',
                header=true,
                compression='gzip',
                quote='"'
            )
            WHERE {metro_filter}
        """)

        row_count = con.execute("SELECT COUNT(*) FROM redfin_swfl").fetchone()[0]
        zip_count = con.execute(
            "SELECT COUNT(DISTINCT zip_code) FROM redfin_swfl"
        ).fetchone()[0]
        print(f"  rows loaded: {row_count:,} across {zip_count} ZIP codes")

        if row_count == 0:
            print("  ERROR: zero rows matched the filter — aborting", file=sys.stderr)
            sys.exit(1)

        # Phase 3: write Parquet
        con.execute(f"COPY redfin_swfl TO '{target}' (FORMAT PARQUET, COMPRESSION ZSTD)")
        print(f"  Parquet written: {target}")

    # Phase 4: inventory row (only for real S3 runs)
    if target.startswith("s3://"):
        byte_size = con.execute(
            f"SELECT total_compressed_size FROM parquet_metadata('{target}') LIMIT 1"
        ).fetchone()
        upsert_inventory_row(
            bucket=BUCKET,
            path=PARQUET_PATH,
            vintage=vintage,
            byte_size=int(byte_size[0]) if byte_size else None,
            pack_id=PACK_ID,
            source_url=REDFIN_ZIP_URL,
        )
        print("  inventory row upserted")

    print("redfin-swfl: ingest complete")


def main() -> None:
    try:
        run()
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        sys.exit(130)


if __name__ == "__main__":
    main()
