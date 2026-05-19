"""
Convert FAF5.7.1 to Parquet and upload to the Cold Lane (lake-tier1 bucket).
Writes _tier1_inventory pointer rows. Does NOT write to Postgres.

Run from project root:
    python -m ingest.scripts.faf5_to_parquet

After completion, paste the printed S3 URLs into refinery/sources/faf5-source.mts
(FAF5_VINTAGE constant), then run docs/sql/drop_faf_tombstone.sql in Supabase.
"""
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
from ingest.lib.storage_uploader import upload_parquet, write_tier1_pointer

load_dotenv(Path(__file__).parent.parent / ".env")

BUCKET = "lake-tier1"
TODAY = date.today().isoformat()

_YEAR_COLS: list[str] = (
    [f"tons_{y}" for y in FAF5_YEARS]
    + [f"value_{y}" for y in FAF5_YEARS]
    + [f"tmiles_{y}" for y in FAF5_YEARS]
)


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
            write_tier1_pointer(pipeline, table_name, BUCKET, object_path, len(rows), FAF5_DOWNLOAD_URL)
            print(f"  [{table_name}] _tier1_inventory pointer written")
        except Exception as exc:
            print(f"  [{table_name}] WARNING: _tier1_inventory write failed (non-fatal) -- {exc}")
        s3_urls.append(f"s3://{BUCKET}/{object_path}")

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
