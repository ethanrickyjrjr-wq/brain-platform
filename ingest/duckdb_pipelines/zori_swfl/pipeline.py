"""Zillow ZORI SWFL rent-index → Parquet in Tier 1 Storage.

Run with: python -m ingest.duckdb_pipelines.zori_swfl.pipeline

What it does:
  1. Stream-downloads the ZIP-level all-homes smoothed ZORI CSV from
     files.zillowstatic.com to a local temp file (~few MB compressed).
  2. DuckDB filters to FL + four SWFL MSAs, UNPIVOTs the wide month columns
     to long form (zip × period_end × rent_index), and writes ZSTD Parquet
     to s3://lake-tier1/market/zori_swfl.parquet.
  3. Upserts one row in data_lake._tier1_inventory.

The temp-file step mirrors redfin_swfl — keeps S3-write credentials cleanly
isolated from the public source-bucket fetch.

Update schedule: Zillow Research refreshes monthly (~3rd week of the month
for the prior month). Cron target: 20th of each month.
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
    METADATA_COLUMNS,
    PACK_ID,
    PARQUET_PATH,
    PARQUET_TARGET,
    REGION_TYPE,
    STATE_CODE,
    SWFL_METRO_SUBSTRINGS,
    ZORI_CSV_URL,
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
                    print(
                        f"\r  {written / 1e6:.1f} MB / {total / 1e6:.1f} MB ({pct:.0f}%)",
                        end="",
                        flush=True,
                    )
    print()
    print(f"  download complete: {written / 1e6:.2f} MB")


def _build_metro_filter() -> str:
    clauses = " OR ".join(
        f"Metro LIKE '%{s}%'" for s in SWFL_METRO_SUBSTRINGS
    )
    return (
        f"State = '{STATE_CODE}' AND RegionType = '{REGION_TYPE}' AND ({clauses})"
    )


def _exclude_clause() -> str:
    """`EXCLUDE (col1, col2, …)` fragment for the UNPIVOT — preserves
    metadata columns while melting everything else."""
    return "(" + ", ".join(METADATA_COLUMNS) + ")"


def run(*, target: str = PARQUET_TARGET, source_csv: str | None = None) -> None:
    """Run the pipeline.

    Args:
        target: Parquet target. Defaults to the Tier 1 S3 path; tests pass
            a local file path to keep the run hermetic.
        source_csv: Optional pre-downloaded CSV path. When set, skips the
            HTTP download (useful for tests and re-runs against a local copy
            at data/external/zillow/zori_zip_rent_index.csv).
    """
    _load_env()
    ingested_at = datetime.now(timezone.utc).isoformat()
    vintage = date.today().isoformat()

    print("zori-swfl: starting ingest")
    print(f"  source: {source_csv or ZORI_CSV_URL}")
    print(f"  target: {target}")

    con = duckdb.connect()
    if target.startswith("s3://"):
        _configure_s3(con)

    with tempfile.TemporaryDirectory() as tmp_dir:
        if source_csv:
            csv_path = Path(source_csv)
            if not csv_path.exists():
                print(f"  ERROR: source CSV not found: {csv_path}", file=sys.stderr)
                sys.exit(1)
        else:
            csv_path = Path(tmp_dir) / "zori_zip_all_homes.csv"
            _download_source(ZORI_CSV_URL, csv_path)

        metro_filter = _build_metro_filter()
        exclude_clause = _exclude_clause()
        print(f"  filtering: {metro_filter}")

        # CTE chain:
        #   wide:   filter the wide CSV down to SWFL ZIPs (still wide).
        #   melted: UNPIVOT every non-metadata column into (period_end_str, rent_index).
        #   typed:  cast + clean.
        con.execute(f"""
            CREATE TABLE zori_swfl AS
            WITH wide AS (
                SELECT *
                FROM read_csv_auto('{csv_path.as_posix()}', header=true, quote='"')
                WHERE {metro_filter}
            ),
            melted AS (
                UNPIVOT wide
                ON COLUMNS(* EXCLUDE {exclude_clause})
                INTO NAME period_end_str VALUE rent_index_raw
            )
            SELECT
                CAST(RegionName AS VARCHAR)        AS zip_code,
                CAST(period_end_str AS DATE)       AS period_end,
                CAST(rent_index_raw AS DOUBLE)     AS rent_index,
                Metro                              AS metro,
                CountyName                         AS county_name,
                City                               AS city,
                '{ingested_at}'                    AS ingested_at
            FROM melted
            WHERE rent_index_raw IS NOT NULL
        """)

        row_count = con.execute("SELECT COUNT(*) FROM zori_swfl").fetchone()[0]
        zip_count = con.execute(
            "SELECT COUNT(DISTINCT zip_code) FROM zori_swfl"
        ).fetchone()[0]
        metro_count = con.execute(
            "SELECT COUNT(DISTINCT metro) FROM zori_swfl"
        ).fetchone()[0]
        date_range = con.execute(
            "SELECT MIN(period_end), MAX(period_end) FROM zori_swfl"
        ).fetchone()
        print(
            f"  rows loaded: {row_count:,} across {zip_count} ZIPs in {metro_count} MSAs"
        )
        print(f"  period range: {date_range[0]} to {date_range[1]}")

        if row_count == 0:
            print("  ERROR: zero rows matched the filter — aborting", file=sys.stderr)
            sys.exit(1)

        con.execute(
            f"COPY zori_swfl TO '{target}' (FORMAT PARQUET, COMPRESSION ZSTD)"
        )
        print(f"  Parquet written: {target}")

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
            source_url=ZORI_CSV_URL,
        )
        print("  inventory row upserted")

    print("zori-swfl: ingest complete")


def main() -> None:
    try:
        run()
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        sys.exit(130)


if __name__ == "__main__":
    main()
