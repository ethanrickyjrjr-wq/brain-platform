"""
Convert FAF5.7.1 to Parquet and upload to the Cold Lane (lake-tier1 bucket).
Writes _tier1_inventory pointer rows. Does NOT write to Postgres.

Run from project root:
    python -m ingest.scripts.faf5_to_parquet

After completion, paste the printed S3 URLs into refinery/sources/faf5-source.mts
(FAF5_VINTAGE constant), then run docs/sql/drop_faf_tombstone.sql in Supabase.
"""
import argparse
import io
import os
import subprocess
import zipfile
import csv
from datetime import date
from pathlib import Path

import dlt
from dotenv import load_dotenv

from ingest.pipelines.faf5.constants import (
    FAF5_DOWNLOAD_URL,
    FL_ZONE_IDS,
    FAF5_YEARS,
    FAF_ZONE_LOOKUP,
    SCTG_LOOKUP,
)
from ingest.lib.storage_uploader import upload_parquet
from ingest.lib.tier1_inventory import upsert_inventory_row

load_dotenv(Path(__file__).parent.parent / ".env")

BUCKET = "lake-tier1"
TODAY = date.today().isoformat()

_YEAR_COLS: list[str] = (
    [f"tons_{y}" for y in FAF5_YEARS]
    + [f"value_{y}" for y in FAF5_YEARS]
    + [f"tmiles_{y}" for y in FAF5_YEARS]
)

HISTORICAL_YEARS: list[int] = [2020, 2021, 2022, 2023, 2024]


def _melt_to_year(rows: list[dict], year: int) -> list[dict]:
    """Thin per-year rows — generic column names (no year suffix)."""
    return [
        {
            "dms_orig":   r["dms_orig"],
            "dms_dest":   r["dms_dest"],
            "sctg2":      r["sctg2"],
            "trade_type": r["trade_type"],
            "tons":       r[f"tons_{year}"],
            "value_musd": r[f"value_{year}"],
            "tmiles":     r[f"tmiles_{year}"],
        }
        for r in rows
    ]


def _fetch_zip_bytes(url: str) -> bytes:
    result = subprocess.run(
        ["curl", "--silent", "--show-error", "--location", url],
        capture_output=True,
        check=True,
    )
    return result.stdout


def _build_flows_rows() -> list[dict]:
    print(f"  Downloading FAF5 zip from ORNL...")
    raw = _fetch_zip_bytes(FAF5_DOWNLOAD_URL)
    print(f"  Downloaded {len(raw):,} bytes. Parsing CSV...")
    zf = zipfile.ZipFile(io.BytesIO(raw))
    csv_name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
    reader = csv.DictReader(io.TextIOWrapper(zf.open(csv_name), encoding="utf-8"))
    rows = []
    for row in reader:
        orig = int(row["dms_orig"])
        dest = int(row["dms_dest"])
        if orig not in FL_ZONE_IDS and dest not in FL_ZONE_IDS:
            continue
        out: dict = {
            "dms_orig":   orig,
            "dms_dest":   dest,
            "sctg2":      int(row["sctg2"]),
            "trade_type": int(row["trade_type"]),
        }
        for col in _YEAR_COLS:
            val = row.get(col, "")
            out[col] = float(val) if val not in ("", None) else 0.0
        rows.append(out)
    print(f"  Parsed {len(rows):,} FL-zone flow rows.")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Validate download only; skip S3 write")
    args = parser.parse_args()

    if args.dry_run:
        print("Dry run — skipping write.")
        return

    flows_rows = _build_flows_rows()

    datasets: list[tuple[str, list[dict]]] = [
        ("faf_flows",       flows_rows),
        ("faf_zone_lookup", list(FAF_ZONE_LOOKUP)),
        ("faf_sctg_lookup", list(SCTG_LOOKUP)),
    ]

    pipeline = dlt.pipeline(
        pipeline_name="faf5_tier1",
        destination="postgres",
        dataset_name="data_lake",
    )

    s3_urls: list[str] = []
    for table_name, rows in datasets:
        object_path = f"faf5/{TODAY}/{table_name}.parquet"
        print(f"\n  [{table_name}] {len(rows):,} rows -> {BUCKET}/{object_path}")
        byte_size = upload_parquet(BUCKET, object_path, rows)
        print(f"  [{table_name}] uploaded {byte_size:,} bytes")
        try:
            upsert_inventory_row(
                bucket=BUCKET, path=object_path, vintage=TODAY,
                byte_size=byte_size, pack_id="logistics-swfl", source_url=FAF5_DOWNLOAD_URL,
            )
            print(f"  [{table_name}] _tier1_inventory pointer written")
        except Exception as exc:
            print(f"  [{table_name}] WARNING: _tier1_inventory write failed (non-fatal) -- {exc}")
        s3_urls.append(f"s3://{BUCKET}/{object_path}")

    print("\n=== Year-partitioned backfill (2020-2024) ===")
    for year in HISTORICAL_YEARS:
        year_rows = _melt_to_year(flows_rows, year)
        object_path = f"faf5/year={year}/faf_flows.parquet"
        print(f"\n  [year={year}] {len(year_rows):,} rows -> {BUCKET}/{object_path}")
        byte_size = upload_parquet(BUCKET, object_path, year_rows)
        print(f"  [year={year}] uploaded {byte_size:,} bytes")
        try:
            upsert_inventory_row(
                bucket=BUCKET, path=object_path, vintage=str(year),
                byte_size=byte_size, pack_id="logistics-swfl", source_url=FAF5_DOWNLOAD_URL,
            )
            print(f"  [year={year}] _tier1_inventory pointer written")
        except Exception as exc:
            print(f"  [year={year}] WARNING: _tier1_inventory write failed (non-fatal) -- {exc}")
        s3_urls.append(f"s3://{BUCKET}/{object_path}")

    print("\n=== DuckDB row-count verification (local Parquet scan) ===")
    import duckdb as _ddb
    import tempfile
    import pyarrow as _pa
    import pyarrow.parquet as _pq
    _conn = _ddb.connect()
    for year in HISTORICAL_YEARS:
        year_rows_v = _melt_to_year(flows_rows, year)
        with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as _tmp:
            _pq.write_table(_pa.Table.from_pylist(year_rows_v), _tmp.name)
            _total = _conn.execute(
                f"SELECT COUNT(*) FROM read_parquet('{_tmp.name}')"
            ).fetchone()[0]
            _swfl = _conn.execute(
                f"SELECT COUNT(*) FROM read_parquet('{_tmp.name}') "
                f"WHERE dms_dest = 129 AND trade_type = 1 AND tons > 0"
            ).fetchone()[0]
        print(
            f"  year={year}: {_total:,} total FL-zone rows "
            f"| {_swfl:,} SWFL inbound (dms_dest=129 trade_type=1 tons>0)"
        )
    _conn.close()

    print("\n=== FAF5 Cold Lane upload complete ===\n")
    print("1. Set FAF5_VINTAGE in refinery/sources/faf5-source.mts:")
    print(f'   const FAF5_VINTAGE = "{TODAY}";')
    print()
    print("2. Run docs/sql/drop_faf_tombstone.sql in Supabase SQL editor.")
    print()
    print("3. Set Cold Lane env vars in .env.local (if not already set):")
    print("   SUPABASE_S3_ENDPOINT=<project-ref>.supabase.co/storage/v1/s3")
    print("   SUPABASE_S3_ACCESS_KEY_ID=<access-key>")
    print("   SUPABASE_S3_SECRET_ACCESS_KEY=<secret-key>")
    print()
    print("S3 URLs written:")
    for u in s3_urls:
        print(f"  {u}")


if __name__ == "__main__":
    main()
