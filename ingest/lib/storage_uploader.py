import csv
import gzip
import io
import json
import os
import time
import tomllib
from pathlib import Path

import psycopg2
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

_SECRETS_PATH = Path(__file__).resolve().parents[2] / ".dlt" / "secrets.toml"


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
    url = f"{os.environ['SUPABASE_URL']}/storage/v1/object/{bucket}/{object_path}"
    headers = {
        "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}",
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
    pipeline,  # unused — kept for call-site API compat
    table_name: str,
    bucket: str,
    object_path: str,
    row_count: int,
    source_url: str,
    pack_id: str | None = None,
    vintage: str | None = None,
) -> None:
    """Insert/update a row in data_lake._tier1_inventory via psycopg2.

    dlt cannot write to this table — its hand-crafted schema (id/bucket/path/vintage/
    byte_size/pack_id) conflicts with dlt's required NOT NULL meta-columns. Direct
    psycopg2 insert keeps the schema contract clean.
    """
    from datetime import date

    if vintage is None:
        vintage = date.today().isoformat()

    with _SECRETS_PATH.open("rb") as f:
        creds = tomllib.load(f)["destination"]["postgres"]["credentials"]
    row_id = f"{bucket}/{object_path}"

    conn = psycopg2.connect(
        host=creds["host"],
        port=int(creds["port"]),
        database=creds.get("database", "postgres"),
        user=creds["username"],
        password=creds["password"],
        connect_timeout=30,
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO data_lake._tier1_inventory
            (id, bucket, path, vintage, byte_size, pack_id, source_url, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, now(), now())
        ON CONFLICT (id) DO UPDATE SET
            byte_size = EXCLUDED.byte_size,
            updated_at = now()
        """,
        (row_id, bucket, object_path, vintage, row_count, pack_id, source_url),
    )
    conn.close()
