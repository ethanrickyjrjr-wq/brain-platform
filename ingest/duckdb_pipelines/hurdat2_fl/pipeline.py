"""hurdat2-fl ingest: NOAA NHC HURDAT2 best-track -> Parquet in Tier 1 Storage.

Run with: python -m ingest.duckdb_pipelines.hurdat2_fl.pipeline

What it does
------------
1. Scrapes https://www.nhc.noaa.gov/data/hurdat/ for the latest annual
   Atlantic file (excludes Pacific `hurdat2-nepac-*`).
2. Downloads + parses it via parse_hurdat2() into TrackPoint rows.
3. Loads rows into an in-memory DuckDB table.
4. Filters to storms that EVER passed through Florida's bounding box at
   any point in their lifetime (keeps the full track, not just FL obs).
5. COPY TO s3://lake-tier1/environmental/hurdat2_fl.parquet (zstd).
6. Upserts a row in data_lake._tier1_inventory.

Outputs
-------
- s3://lake-tier1/environmental/hurdat2_fl.parquet
- one row in data_lake._tier1_inventory (id = "lake-tier1/environmental/hurdat2_fl.parquet")
"""
import os
import re
from dataclasses import astuple
from pathlib import Path

import duckdb
import requests

from ingest.duckdb_pipelines.hurdat2_fl.constants import (
    BUCKET,
    FL_LAT_MAX,
    FL_LAT_MIN,
    FL_LON_MAX,
    FL_LON_MIN,
    NHC_BASE_URL,
    NHC_FILE_PREFIX,
    NHC_FILE_SUFFIX,
    PACK_ID,
    PARQUET_PATH,
    PARQUET_TARGET,
)
from ingest.duckdb_pipelines.hurdat2_fl.parse_hurdat2 import parse_hurdat2
from ingest.lib.tier1_inventory import upsert_inventory_row


# Match `hurdat2-1851-2024-040425.txt` but NOT `hurdat2-nepac-...txt`.
# Capture (start_year, end_year, publish_yymmdd).
_HURDAT2_FILE_RE = re.compile(
    rf"{re.escape(NHC_FILE_PREFIX)}(\d{{4}})-(\d{{4}})-(\d{{6}}){re.escape(NHC_FILE_SUFFIX)}"
)


def _load_env() -> None:
    """Load .env.local for SUPABASE_S3_* + SUPABASE_PG_* credentials."""
    env_path = Path(__file__).parent.parent.parent.parent / ".env.local"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def _latest_hurdat2_url() -> tuple[str, str, str]:
    """Scrape NHC's index and return (url, vintage, basename) for the most-
    recently-published Atlantic file. Vintage = "{start_year}-{end_year}".

    NHC encodes the publish suffix as MMDDYY (NOT YYMMDD), so a naive
    integer sort puts 120319 (Dec 3 2019) ahead of 040425 (Apr 4 2025).
    Sort key: (end_year DESC, real publish date DESC). Two-digit year is
    treated as 20YY (HURDAT2 publishes are all post-2010).
    """
    resp = requests.get(NHC_BASE_URL, timeout=60)
    resp.raise_for_status()
    candidates: list[tuple[int, tuple[int, int, int], str, str]] = []
    for m in _HURDAT2_FILE_RE.finditer(resp.text):
        start_year = int(m.group(1))
        end_year = int(m.group(2))
        mmddyy = m.group(3)
        mm = int(mmddyy[0:2])
        dd = int(mmddyy[2:4])
        yy = int(mmddyy[4:6])
        publish_date = (2000 + yy, mm, dd)
        basename = m.group(0)
        vintage = f"{start_year}-{end_year}"
        candidates.append((end_year, publish_date, vintage, basename))
    if not candidates:
        raise RuntimeError(
            f"No hurdat2-NNNN-NNNN-NNNNNN.txt files found at {NHC_BASE_URL}"
        )
    candidates.sort(key=lambda c: (c[0], c[1]), reverse=True)
    _, _, vintage, basename = candidates[0]
    return f"{NHC_BASE_URL}{basename}", vintage, basename


def run() -> None:
    _load_env()

    endpoint = (
        os.environ["SUPABASE_S3_ENDPOINT"]
        .replace("https://", "")
        .replace("http://", "")
    )

    print("hurdat2-fl: starting ingest")
    print(f"  source root: {NHC_BASE_URL}")
    print(f"  target: {PARQUET_TARGET}")

    source_url, vintage, basename = _latest_hurdat2_url()
    print(f"  picked: {basename} (vintage {vintage})")

    raw_resp = requests.get(source_url, timeout=120)
    raw_resp.raise_for_status()
    text = raw_resp.text
    print(f"  downloaded: {len(text):,} chars")

    points = list(parse_hurdat2(text.splitlines()))
    if not points:
        raise RuntimeError("HURDAT2 parser yielded zero rows")
    print(f"  parsed: {len(points):,} obs across all storms")

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute(f"""
        SET s3_endpoint='{endpoint}';
        SET s3_access_key_id='{os.environ["SUPABASE_S3_ACCESS_KEY_ID"]}';
        SET s3_secret_access_key='{os.environ["SUPABASE_S3_SECRET_ACCESS_KEY"]}';
        SET s3_region='us-east-1';
        SET s3_url_style='path';
        SET s3_use_ssl=true;
    """)

    con.execute("""
        CREATE TEMP TABLE hurdat_raw (
            storm_id VARCHAR,
            storm_name VARCHAR,
            storm_year INTEGER,
            obs_date DATE,
            obs_time VARCHAR,
            record_id VARCHAR,
            status VARCHAR,
            lat DOUBLE,
            lon DOUBLE,
            max_wind_kt INTEGER,
            min_pressure_mb INTEGER,
            category_saffir INTEGER
        );
    """)
    con.executemany(
        "INSERT INTO hurdat_raw VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
        [astuple(p) for p in points],
    )

    # Filter storms that EVER touched FL bbox; keep their full tracks.
    con.execute(f"""
        COPY (
            SELECT *
            FROM hurdat_raw
            WHERE storm_id IN (
                SELECT DISTINCT storm_id
                FROM hurdat_raw
                WHERE lat BETWEEN {FL_LAT_MIN} AND {FL_LAT_MAX}
                  AND lon BETWEEN {FL_LON_MIN} AND {FL_LON_MAX}
            )
            ORDER BY storm_id, obs_date, obs_time
        ) TO '{PARQUET_TARGET}' (FORMAT PARQUET, COMPRESSION ZSTD);
    """)

    # parquet_metadata returns one row per row group; sum gets the whole file's
    # compressed payload bytes (excludes footer; close enough for inventory).
    size_rows = con.execute(
        f"SELECT SUM(total_compressed_size)::BIGINT FROM parquet_metadata('{PARQUET_TARGET}');"
    ).fetchall()
    byte_size = int(size_rows[0][0]) if size_rows and size_rows[0][0] is not None else None
    row_count_rows = con.execute(
        f"SELECT COUNT(*) FROM read_parquet('{PARQUET_TARGET}');"
    ).fetchall()
    row_count = int(row_count_rows[0][0]) if row_count_rows else None

    upsert_inventory_row(
        bucket=BUCKET,
        path=PARQUET_PATH,
        vintage=vintage,
        byte_size=byte_size,
        pack_id=PACK_ID,
        source_url=source_url,
    )

    print("hurdat2-fl: ingest complete")
    print(f"  parquet rows: {row_count:,}" if row_count is not None else "  parquet rows: ?")
    print(f"  parquet bytes (compressed): {byte_size}")
    print(f"  inventory row upserted: id={BUCKET}/{PARQUET_PATH}")


if __name__ == "__main__":
    run()
