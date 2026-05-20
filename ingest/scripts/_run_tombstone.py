import tomllib
from pathlib import Path

import psycopg2

SECRETS_PATH = Path(__file__).resolve().parents[2] / ".dlt" / "secrets.toml"
with SECRETS_PATH.open("rb") as f:
    creds = tomllib.load(f)["destination"]["postgres"]["credentials"]

conn = psycopg2.connect(
    host=creds["host"],
    port=int(creds["port"]),
    database=creds["database"],
    user=creds["username"],
    password=creds["password"],
    connect_timeout=30,
)
conn.autocommit = True
cur = conn.cursor()

for sql in [
    "DROP TABLE IF EXISTS data_lake.faf_flows CASCADE",
    "DROP TABLE IF EXISTS data_lake.faf_zone_lookup CASCADE",
    "DROP TABLE IF EXISTS data_lake.faf_sctg_lookup CASCADE",
]:
    cur.execute(sql)
    print("OK:", sql)

# Insert FAF5 Cold Lane inventory rows using the existing hand-crafted schema
faf5_rows = [
    ("lake-tier1/faf5/2026-05-19/faf_flows.parquet",       "lake-tier1", "faf5/2026-05-19/faf_flows.parquet",       "2026-05-19", 284239, "logistics-swfl", "https://faf.ornl.gov/faf5/Data/Download_Files/FAF5.7.1.zip"),
    ("lake-tier1/faf5/2026-05-19/faf_zone_lookup.parquet", "lake-tier1", "faf5/2026-05-19/faf_zone_lookup.parquet", "2026-05-19",     26, "logistics-swfl", "https://faf.ornl.gov/faf5/Data/Download_Files/FAF5.7.1.zip"),
    ("lake-tier1/faf5/2026-05-19/faf_sctg_lookup.parquet", "lake-tier1", "faf5/2026-05-19/faf_sctg_lookup.parquet", "2026-05-19",     42, "logistics-swfl", "https://faf.ornl.gov/faf5/Data/Download_Files/FAF5.7.1.zip"),
]
cur.executemany("""
    INSERT INTO data_lake._tier1_inventory (id, bucket, path, vintage, byte_size, pack_id, source_url, created_at, updated_at)
    VALUES (%s, %s, %s, %s, %s, %s, %s, now(), now())
    ON CONFLICT (id) DO UPDATE SET byte_size=EXCLUDED.byte_size, updated_at=now()
""", faf5_rows)
print(f"OK: inserted {len(faf5_rows)} FAF5 inventory rows")

cur.execute("SELECT id, byte_size, pack_id FROM data_lake._tier1_inventory ORDER BY created_at")
rows = cur.fetchall()
print(f"\n_tier1_inventory ({len(rows)} rows):")
for r in rows:
    print(f"  {r[0]} | {r[1]} rows | pack={r[2]}")

conn.close()
print("\nDone.")
