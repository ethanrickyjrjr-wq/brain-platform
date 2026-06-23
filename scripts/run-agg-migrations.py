"""
Run the aggregate-at-source view migrations for 2026-06-23.
Reads DB creds from .dlt/secrets.toml. Requires psycopg (psycopg3).

Usage: python scripts/run-agg-migrations.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

# Read creds from .dlt/secrets.toml
def load_pg_creds():
    secrets = (ROOT / ".dlt" / "secrets.toml").read_text()
    def get(key):
        m = re.search(rf'^{key}\s*=\s*"([^"]+)"', secrets, re.MULTILINE)
        if m:
            return m.group(1)
        raise ValueError(f"Key {key!r} not found in secrets.toml")
    return {
        "host":     get("host"),
        "dbname":   get("database"),
        "user":     get("username"),
        "password": get("password"),
        "port":     5432,
    }

MIGRATIONS = [
    "20260623_census_cbp_fl_agg_by_naics_view.sql",
    "20260623_fdot_aadt_county_year_view.sql",
    "20260623_usgs_caloosahatchee_stage_latest_view.sql",
    "20260623_fema_nfip_county_year_view.sql",
    "20260623_fema_nfip_zip_window_agg_view.sql",
]

def main():
    try:
        import psycopg
    except ImportError:
        print("psycopg not found — install with: pip install psycopg[binary]")
        sys.exit(1)

    creds = load_pg_creds()
    conn_str = (
        f"host={creds['host']} port={creds['port']} "
        f"dbname={creds['dbname']} user={creds['user']} "
        f"password={creds['password']} sslmode=require"
    )

    with psycopg.connect(conn_str) as conn:
        for fname in MIGRATIONS:
            sql_path = ROOT / "docs" / "sql" / fname
            if not sql_path.exists():
                print(f"  SKIP (not found): {fname}")
                continue
            sql = sql_path.read_text()
            print(f"  Running: {fname} ...", end=" ", flush=True)
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.commit()
            print("OK")

    print("\nAll migrations complete.")

if __name__ == "__main__":
    main()
