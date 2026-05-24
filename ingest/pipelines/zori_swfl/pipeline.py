"""Zillow ZORI SWFL Tier 2 loader entry point.

Run with: python -m ingest.pipelines.zori_swfl.pipeline

Reads the Tier 1 Parquet at s3://lake-tier1/market/zori_swfl.parquet via DuckDB
and merges into data_lake.zori_swfl on (zip_code, period_end). Idempotent —
re-running against an unchanged Parquet is a no-op.

Chained from npm: `npm run ingest:zori-swfl` runs the Tier 1 DuckDB pipeline
first (writes the Parquet) and then this script (merges to Postgres).
"""
from __future__ import annotations

import argparse
import sys
from typing import Optional

import dlt

from .resources import zori_swfl_resource


def run_pipeline(parquet_path: Optional[str] = None) -> None:
    """Run the dlt merge into Tier 2.

    Args:
        parquet_path: Optional override for the Parquet location (tests use
            a local file; production reads from S3).
    """
    pipeline = dlt.pipeline(
        pipeline_name="zori_swfl",
        destination="postgres",
        dataset_name="data_lake",
    )
    load_info = pipeline.run(zori_swfl_resource(parquet_path=parquet_path))
    print(load_info)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--parquet-path",
        default=None,
        help="Override the Parquet source (default: s3 production path).",
    )
    args = parser.parse_args()
    try:
        run_pipeline(parquet_path=args.parquet_path)
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        sys.exit(130)


if __name__ == "__main__":
    main()
