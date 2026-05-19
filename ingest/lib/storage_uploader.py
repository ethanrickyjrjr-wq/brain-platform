import csv
import gzip
import io
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import dlt
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")


def upload_parquet(bucket: str, object_path: str, rows: list[dict]) -> int:
    """Convert rows to Parquet (pyarrow) and upload. Returns byte size."""
    import pyarrow as pa
    import pyarrow.parquet as pq
    table = pa.Table.from_pylist(rows)
    buf = io.BytesIO()
    pq.write_table(table, buf)
    data = buf.getvalue()
    _upload_bytes(bucket, object_path, data, "application/vnd.apache.parquet")
    return len(data)


def upload_csv_gz(bucket: str, object_path: str, rows: list[dict], fieldnames: list[str]) -> str:
    csv_buf = io.StringIO()
    writer = csv.DictWriter(csv_buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    gz_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=gz_buf, mode="wb") as gz:
        gz.write(csv_buf.getvalue().encode("utf-8"))
    _upload_bytes(bucket, object_path, gz_buf.getvalue(), "application/gzip")
    return object_path


def upload_geojson_gz(bucket: str, object_path: str, features: list[dict]) -> str:
    geojson = json.dumps({"type": "FeatureCollection", "features": features})
    gz_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=gz_buf, mode="wb") as gz:
        gz.write(geojson.encode("utf-8"))
    _upload_bytes(bucket, object_path, gz_buf.getvalue(), "application/gzip")
    return object_path


def _upload_bytes(bucket: str, object_path: str, data: bytes, content_type: str) -> None:
    url = f"{os.environ['BRAINS_SUPABASE_URL']}/storage/v1/object/{bucket}/{object_path}"
    headers = {
        "Authorization": f"Bearer {os.environ['BRAINS_SUPABASE_SERVICE_KEY']}",
        "Content-Type": content_type,
        "x-upsert": "true",
    }
    for attempt in range(3):
        try:
            resp = requests.post(url, headers=headers, data=data, timeout=180)
            if resp.ok:
                return
            if resp.status_code >= 500 and attempt < 2:
                time.sleep(30 * (attempt + 1))
                continue
            raise RuntimeError(f"Storage upload failed {resp.status_code}: {resp.text}")
        except (requests.Timeout, requests.ConnectionError):
            if attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            raise


def write_tier1_pointer(
    pipeline,
    table_name: str,
    bucket: str,
    object_path: str,
    row_count: int,
    source_url: str,
) -> None:
    import secrets

    # Create a fresh pipeline per call so stale pending packages from a previous
    # failed write don't block subsequent writes in the same script run.
    fresh = dlt.pipeline(
        pipeline_name=f"_t1ptr_{secrets.token_hex(4)}",
        destination="postgres",
        dataset_name="data_lake",
    )

    @dlt.resource(
        table_name="_tier1_inventory",
        write_disposition="merge",
        primary_key=["table_name", "object_path"],
        columns={"deleted_at": {"data_type": "timestamp"}},
    )
    def _row():
        yield {
            "table_name": table_name,
            "bucket": bucket,
            "object_path": object_path,
            "row_count": row_count,
            "source_url": source_url,
            "ingested_at": datetime.now(timezone.utc).isoformat(),
            "deleted_at": None,
        }

    fresh.run(_row())
