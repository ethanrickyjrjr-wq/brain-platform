"""Zillow ZORI SWFL dlt resource — Tier 1 Parquet → Tier 2 Postgres merge.

Reads the Parquet that ingest.duckdb_pipelines.zori_swfl wrote and yields
typed dicts. The `rows` parameter lets tests inject rows directly without
touching Parquet or S3.

write_disposition=merge with PK (zip_code, period_end) makes the loader
idempotent — a re-run against an unchanged Parquet is a no-op.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Optional

import dlt
import duckdb

from ingest.duckdb_pipelines.zori_swfl.constants import (
    BUCKET,
    PARQUET_PATH,
    PARQUET_TARGET,
)


def _load_env_local() -> None:
    """Load .env.local into os.environ — same shape as the Tier 1 DuckDB
    pipeline. Needed because `npm run ingest:zori-swfl` chains two python
    subprocesses; the second one starts with a fresh environment and does
    not inherit Tier 1's loaded vars."""
    env_path = Path(__file__).parent.parent.parent.parent / ".env.local"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def _configure_s3(con: duckdb.DuckDBPyConnection) -> None:
    """Wire DuckDB's httpfs against the Supabase S3 endpoint — same as the
    Tier 1 writer pipeline."""
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


def read_tier1_parquet(parquet_path: str | None = None) -> Iterable[dict]:
    """Read the Tier 1 ZORI Parquet and yield row dicts.

    Args:
        parquet_path: Optional override for tests. Defaults to PARQUET_TARGET
            (s3://lake-tier1/market/zori_swfl.parquet).
    """
    target = parquet_path or PARQUET_TARGET
    con = duckdb.connect()
    if target.startswith("s3://"):
        _load_env_local()
        _configure_s3(con)

    cursor = con.execute(
        f"""
        SELECT
            zip_code,
            period_end,
            rent_index,
            metro,
            county_name,
            city,
            ingested_at
        FROM read_parquet('{target}')
        """
    )
    cols = [d[0] for d in cursor.description]
    for row in cursor.fetchall():
        yield dict(zip(cols, row))


@dlt.resource(
    name="zori_swfl",
    primary_key=["zip_code", "period_end"],
    write_disposition="merge",
)
def zori_swfl_resource(
    rows: Optional[Iterable[dict]] = None,
    parquet_path: Optional[str] = None,
):
    """Emit ZORI rows for Tier 2 merge.

    Args:
        rows: Test override — when set, yields these directly.
        parquet_path: Test override — when set (and `rows` is None), reads
            from this Parquet path instead of the S3 default.
    """
    if rows is None:
        rows = read_tier1_parquet(parquet_path=parquet_path)

    for r in rows:
        yield {
            "zip_code":    r["zip_code"],
            "period_end":  r["period_end"],
            "rent_index":  r["rent_index"],
            "metro":       r.get("metro"),
            "county_name": r.get("county_name"),
            "city":        r.get("city"),
            "ingested_at": r.get("ingested_at"),
            "_ingest_metadata": {
                "source":   "zillow_zori_research",
                "tier1_bucket": BUCKET,
                "tier1_path":   PARQUET_PATH,
            },
        }
