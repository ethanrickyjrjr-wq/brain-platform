"""Apply docs/sql/20260614_tier_divergence_views.sql (idempotent CREATE OR REPLACE).

Adds median_top_tier + median_bottom_tier to data_lake.tier_divergence_pivoted
(view A) for the /charts indexed two-line panel; view B unchanged (re-create = no-op).
Reads credentials from .dlt/secrets.toml (same pattern as apply_data_requests_migration.py).
Run from repo root:
    python scripts/apply_tier_divergence_views.py
"""
import os
import sys
from pathlib import Path

import psycopg


def _get_repo_root() -> Path:
    import subprocess
    result = subprocess.run(
        ["git", "rev-parse", "--git-common-dir"],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        return Path(result.stdout.strip()).parent
    return Path(__file__).parent.parent


def _get_connection():
    conninfo = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    if conninfo:
        return psycopg.connect(conninfo, sslmode="require", connect_timeout=15)
    secrets_path = _get_repo_root() / ".dlt" / "secrets.toml"
    secrets: dict[str, str] = {}
    if secrets_path.exists():
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
                secrets[k.strip()] = v.strip().strip("'\"")
    return psycopg.connect(
        host=secrets["host"],
        port=int(secrets.get("port", "5432")),
        dbname=secrets.get("database", "postgres"),
        user=secrets["username"],
        password=secrets["password"],
        sslmode="require",
        connect_timeout=15,
    )


def main():
    sql_path = _get_repo_root() / "docs" / "sql" / "20260614_tier_divergence_views.sql"
    sql = sql_path.read_text()

    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        print("Migration applied OK")

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT month, median_top_tier, median_bottom_tier, both_tier_zip_count
                FROM data_lake.tier_divergence_pivoted
                WHERE month IN ('2019-01','2026-04')
                ORDER BY month
                """
            )
            rows = cur.fetchall()
            cur.execute("SELECT count(*) FROM data_lake.tier_divergence_pivoted")
            total = cur.fetchone()[0]
            cur.execute(
                "SELECT has_column_privilege('service_role',"
                "'data_lake.tier_divergence_pivoted','median_top_tier','SELECT')"
            )
            svc_can_read = cur.fetchone()[0]

        print(f"total rows={total}")
        print(f"service_role SELECT median_top_tier={svc_can_read} (must be True)")
        ok = True
        for month, mt, mb, cnt in rows:
            null_flag = "" if (mt is not None and mb is not None) else "  <-- NULL!"
            print(f"  {month}: top={mt} bottom={mb} zips={cnt}{null_flag}")
            if mt is None or mb is None:
                ok = False
        if not svc_can_read:
            print("ERROR: service_role cannot read new column — grant missing!")
            sys.exit(1)
        if not ok or len(rows) != 2:
            print("ERROR: base/latest month columns null or missing!")
            sys.exit(1)
        print("All checks PASSED")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
