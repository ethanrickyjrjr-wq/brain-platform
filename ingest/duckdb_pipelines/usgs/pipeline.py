"""USGS water data → DuckDB → Parquet in Tier 1 Storage.

Run with: python -m ingest.duckdb_pipelines.usgs.pipeline

Outputs:
  - s3://lake-tier1/environmental/usgs_water_swfl.parquet        (daily readings)
  - s3://lake-tier1/environmental/usgs_water_swfl_sites.parquet  (site catalog)
  - two rows in data_lake._tier1_inventory

Full backfill only (BACKFILL_START_YEAR → current year). Incremental mode
is out of scope until the consuming brain ships.
"""

import os
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd

from .constants import (
    BACKFILL_START_YEAR,
    BUCKET,
    DAILY_PARQUET_PATH,
    DAILY_PARQUET_TARGET,
    PACK_ID,
    PARAMETER_CDS,
    SITES_PARQUET_PATH,
    SITES_PARQUET_TARGET,
)
from .fetch import fetch_all_sites, fetch_daily_rows, year_chunks
from ingest.lib.tier1_inventory import upsert_inventory_row


_DAILY_DDL = """
CREATE TABLE usgs_daily (
    site_no      VARCHAR NOT NULL,
    parameter_cd VARCHAR NOT NULL,
    stat_cd      VARCHAR NOT NULL,
    obs_date     DATE    NOT NULL,
    value        DOUBLE,
    unit         VARCHAR NOT NULL,
    datum        VARCHAR NOT NULL,
    qualifiers   VARCHAR,
    source_url   VARCHAR NOT NULL,
    ingested_at  TIMESTAMPTZ NOT NULL
)
"""

_SITES_DDL = """
CREATE TABLE usgs_sites (
    site_no        VARCHAR NOT NULL,
    agency_cd      VARCHAR NOT NULL,
    station_nm     VARCHAR,
    site_tp_cd     VARCHAR,
    state_cd       VARCHAR,
    county_cd      VARCHAR,
    huc_cd         VARCHAR,
    latitude       DOUBLE,
    longitude      DOUBLE,
    coord_datum_cd VARCHAR,
    alt_va         DOUBLE,
    alt_datum_cd   VARCHAR,
    parameter_cds  VARCHAR,
    site_status    VARCHAR,
    source_url     VARCHAR NOT NULL,
    refreshed_at   TIMESTAMPTZ NOT NULL
)
"""


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
    endpoint = os.environ["SUPABASE_S3_ENDPOINT"].replace("https://", "").replace("http://", "")
    con.execute(f"""
        SET s3_endpoint='{endpoint}';
        SET s3_access_key_id='{os.environ["SUPABASE_S3_ACCESS_KEY_ID"]}';
        SET s3_secret_access_key='{os.environ["SUPABASE_S3_SECRET_ACCESS_KEY"]}';
        SET s3_region='us-east-1';
        SET s3_url_style='path';
        SET s3_use_ssl=true;
    """)


def run(
    end_year: int | None = None,
    *,
    daily_target: str = DAILY_PARQUET_TARGET,
    sites_target: str = SITES_PARQUET_TARGET,
) -> None:
    _load_env()

    target_year = end_year or datetime.now(timezone.utc).year
    ingested_at = datetime.now(timezone.utc).isoformat()

    print(f"usgs: starting full backfill {BACKFILL_START_YEAR}–{target_year}")
    print(f"  daily target: {daily_target}")
    print(f"  sites target: {sites_target}")

    con = duckdb.connect()

    if daily_target.startswith("s3://") or sites_target.startswith("s3://"):
        _configure_s3(con)

    con.execute(_DAILY_DDL)
    con.execute(_SITES_DDL)

    # ── Phase 1: fetch daily data year by year ────────────────────────────
    chunks = year_chunks(BACKFILL_START_YEAR, target_year)
    total_params = len(PARAMETER_CDS)
    for p_idx, parameter_cd in enumerate(PARAMETER_CDS, 1):
        print(f"  [{p_idx}/{total_params}] parameterCd={parameter_cd} ({len(chunks)} year-chunks)")
        for start_dt, end_dt in chunks:
            rows = fetch_daily_rows(parameter_cd, start_dt, end_dt, ingested_at)
            if not rows:
                continue
            df = pd.DataFrame(rows)
            con.register("_batch", df)
            con.execute("INSERT INTO usgs_daily SELECT * FROM _batch")
            con.unregister("_batch")

    daily_count = con.execute("SELECT COUNT(*) FROM usgs_daily").fetchone()[0]
    print(f"  daily rows loaded: {daily_count:,}")

    # ── Phase 2: write daily Parquet ──────────────────────────────────────
    con.execute(f"COPY usgs_daily TO '{daily_target}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    print(f"  daily Parquet written: {daily_target}")

    # ── Phase 3: fetch site catalog ───────────────────────────────────────
    print("  fetching site catalog...")
    site_rows = fetch_all_sites()
    print(f"  sites loaded: {len(site_rows):,}")

    sites_df = pd.DataFrame(site_rows)

    # Rollup parameter_cds from the daily table we already have in DuckDB.
    # Avoids the post-ingest psycopg2 UPDATE that the old dlt pipeline needed.
    param_rollup = con.execute("""
        SELECT site_no,
               to_json(list_sort(list_distinct(list(parameter_cd)))) AS cds
        FROM usgs_daily
        GROUP BY site_no
    """).df()
    rollup_map = dict(zip(param_rollup["site_no"], param_rollup["cds"]))
    sites_df["parameter_cds"] = sites_df["site_no"].map(rollup_map)

    con.register("_sites", sites_df)
    con.execute("INSERT INTO usgs_sites SELECT * FROM _sites")
    con.unregister("_sites")

    # ── Phase 4: write sites Parquet ──────────────────────────────────────
    con.execute(f"COPY usgs_sites TO '{sites_target}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    print(f"  sites Parquet written: {sites_target}")

    # ── Phase 5: inventory rows (only for real S3 runs) ───────────────────
    if daily_target.startswith("s3://"):
        daily_size = con.execute(
            f"SELECT total_compressed_size FROM parquet_metadata('{daily_target}') LIMIT 1"
        ).fetchone()
        upsert_inventory_row(
            bucket=BUCKET,
            path=DAILY_PARQUET_PATH,
            vintage=f"{BACKFILL_START_YEAR}-{target_year}",
            byte_size=int(daily_size[0]) if daily_size else None,
            pack_id=PACK_ID,
            source_url="https://waterservices.usgs.gov/nwis/dv/",
        )

    if sites_target.startswith("s3://"):
        sites_size = con.execute(
            f"SELECT total_compressed_size FROM parquet_metadata('{sites_target}') LIMIT 1"
        ).fetchone()
        upsert_inventory_row(
            bucket=BUCKET,
            path=SITES_PARQUET_PATH,
            vintage=f"{BACKFILL_START_YEAR}-{target_year}",
            byte_size=int(sites_size[0]) if sites_size else None,
            pack_id=PACK_ID,
            source_url="https://waterservices.usgs.gov/nwis/site/",
        )

    print("usgs: ingest complete.")


def main() -> None:
    import sys
    try:
        run()
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        sys.exit(130)


if __name__ == "__main__":
    main()
