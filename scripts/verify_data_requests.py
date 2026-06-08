"""Verify data_requests table: insert a test row + confirm anon denied.

Run from repo root: python scripts/verify_data_requests.py
"""
import os
import sys
import subprocess
from pathlib import Path

import psycopg


def _get_repo_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--git-common-dir"],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        git_common = Path(result.stdout.strip())
        return git_common.parent
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
    conn = _get_connection()
    try:
        # Insert a test row
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO public.data_requests
                  (report_id, fact, question, reach, answered)
                VALUES
                  ('test-p10-verify', 'test fact', 'test question?', ARRAY[]::text[], true)
                RETURNING id
            """)
            row_id = cur.fetchone()[0]
        conn.commit()
        print(f"Row inserted: id={row_id}")

        # Re-verify anon denied
        with conn.cursor() as cur:
            cur.execute("SELECT has_table_privilege('anon','data_requests','SELECT')")
            anon_select = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM public.data_requests")
            total = cur.fetchone()[0]

        print(f"anon SELECT={anon_select}  (must be False)")
        print(f"total rows={total}")

        # Clean up test row
        with conn.cursor() as cur:
            cur.execute("DELETE FROM public.data_requests WHERE id = %s", (row_id,))
        conn.commit()
        print(f"Test row deleted")

        if anon_select:
            print("ERROR: anon still has SELECT!")
            sys.exit(1)
        print("All checks PASSED — data_requests is wired correctly")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
