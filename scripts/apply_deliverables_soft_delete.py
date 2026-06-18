"""Apply docs/sql/20260617_deliverables_soft_delete.sql + verify the two new columns.

FINAL BOSS Piece 4. Reads credentials from .dlt/secrets.toml (same pattern as
apply_data_requests_migration.py). Idempotent — safe to re-run. Run from repo root:
    python scripts/apply_deliverables_soft_delete.py
"""
import sys
import os
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
    sql_path = _get_repo_root() / "docs" / "sql" / "20260617_deliverables_soft_delete.sql"
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
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'deliverables'
                  AND column_name IN ('deleted_at', 'supersedes_id')
                ORDER BY column_name
                """
            )
            cols = cur.fetchall()
            cur.execute(
                """
                SELECT indexname FROM pg_indexes
                WHERE schemaname = 'public' AND tablename = 'deliverables'
                  AND indexname = 'deliverables_deleted_at_idx'
                """
            )
            idx = cur.fetchall()

        print(f"new columns present: {cols}")
        print(f"deleted_at index present: {bool(idx)}")

        found = {c[0] for c in cols}
        if found != {"deleted_at", "supersedes_id"}:
            print(f"ERROR: expected deleted_at + supersedes_id, got {found}")
            sys.exit(1)
        if not idx:
            print("ERROR: deliverables_deleted_at_idx missing!")
            sys.exit(1)
        print("All checks PASSED")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
