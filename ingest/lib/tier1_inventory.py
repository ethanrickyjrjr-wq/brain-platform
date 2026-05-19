"""Helper for writing pointer rows to data_lake._tier1_inventory.

Used by every DuckDB-ingest pipeline that lands a Parquet file in Tier 1
Supabase Storage. Required by Data Tier Policy rule §2 (every Tier 1 file
has an audit-trail row).
"""
import os
from pathlib import Path
from typing import Optional

import psycopg


def _load_dlt_secrets() -> dict[str, str]:
    """Read .dlt/secrets.toml -- same credentials the dlt pipelines already use."""
    secrets_path = Path(__file__).parent.parent.parent / ".dlt" / "secrets.toml"
    out: dict[str, str] = {}
    if not secrets_path.exists():
        return out
    section = None
    for line in secrets_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
            continue
        if "=" in line and section and "credentials" in section:
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip("'\"")
    return out


def _get_connection() -> psycopg.Connection:
    secrets = _load_dlt_secrets()
    return psycopg.connect(
        host=secrets.get("host") or os.environ["SUPABASE_PG_HOST"],
        port=int(secrets.get("port") or os.environ.get("SUPABASE_PG_PORT", "5432")),
        dbname=secrets.get("database") or os.environ.get("SUPABASE_PG_DB", "postgres"),
        user=secrets.get("username") or os.environ["SUPABASE_PG_USER"],
        password=secrets.get("password") or os.environ["SUPABASE_PG_PASSWORD"],
        sslmode="require",
    )


def upsert_inventory_row(
    *,
    bucket: str,
    path: str,
    vintage: Optional[str],
    byte_size: Optional[int],
    pack_id: Optional[str],
    source_url: Optional[str],
) -> None:
    """Insert or update one row in data_lake._tier1_inventory.

    The id is composed as f"{bucket}/{path}" -- same Parquet file overwritten
    in place => same inventory row updated.
    """
    row_id = f"{bucket}/{path}"
    sql = """
        INSERT INTO data_lake._tier1_inventory
            (id, bucket, path, vintage, byte_size, pack_id, source_url, updated_at)
        VALUES
            (%(id)s, %(bucket)s, %(path)s, %(vintage)s, %(byte_size)s, %(pack_id)s, %(source_url)s, now())
        ON CONFLICT (id) DO UPDATE SET
            vintage    = EXCLUDED.vintage,
            byte_size  = EXCLUDED.byte_size,
            pack_id    = EXCLUDED.pack_id,
            source_url = EXCLUDED.source_url,
            updated_at = now();
    """
    params = {
        "id": row_id,
        "bucket": bucket,
        "path": path,
        "vintage": vintage,
        "byte_size": byte_size,
        "pack_id": pack_id,
        "source_url": source_url,
    }
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
    finally:
        conn.close()
