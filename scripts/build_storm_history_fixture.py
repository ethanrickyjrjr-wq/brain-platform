"""Build a small deterministic Parquet fixture for storm-history-swfl tests.

Pulls 2022-2024 only (3 years, captures Hurricane Ian) and writes locally
to refinery/__fixtures__/. Committed to git so TS tests run offline.
"""
import sys
from pathlib import Path

# Make repo root importable so `from ingest.*` resolves when run as a script
sys.path.insert(0, str(Path(__file__).parent.parent))

import duckdb

from ingest.duckdb_pipelines.storm_history_swfl.pipeline import _list_noaa_urls

TARGET = (
    Path(__file__).parent.parent
    / "refinery"
    / "__fixtures__"
    / "storm-history-swfl.sample.parquet"
)
TARGET.parent.mkdir(parents=True, exist_ok=True)

urls = _list_noaa_urls(2022, 2024)
print(f"fixture build: {len(urls)} NOAA files (2022-2024)")
if not urls:
    raise RuntimeError("No NOAA files found in 2022-2024 range")

urls_sql_list = ", ".join(f"'{u}'" for u in urls)

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")
con.execute(f"""
    COPY (
        SELECT *
        FROM read_csv_auto(
            [{urls_sql_list}],
            union_by_name=true,
            ignore_errors=true,
            null_padding=true
        )
        WHERE state = 'FLORIDA'
          AND cz_name IN ('LEE','COLLIER','CHARLOTTE')
    ) TO '{TARGET.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD);
""")

rows = con.execute(f"SELECT COUNT(*) FROM read_parquet('{TARGET.as_posix()}')").fetchone()
size = TARGET.stat().st_size
print(f"fixture written: {TARGET} ({rows[0]} rows, {size} bytes)")
