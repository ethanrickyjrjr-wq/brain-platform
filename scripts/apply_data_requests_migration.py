"""Apply docs/sql/20260608_data_requests.sql + verify anon-deny.

Reads credentials from .dlt/secrets.toml (same pattern as check_freshness.py).
Run from repo root:
    python scripts/apply_data_requests_migration.py
"""
import os
import sys
from pathlib import Path

import psycopg


def _get_repo_root() -> Path:
    """Return the main repo root (not the worktree), via git common dir."""
    import subprocess
    result = subprocess.run(
        ["git", "rev-parse", "--git-common-dir"],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        git_common = Path(result.stdout.strip())
        # --git-common-dir returns the .git directory; parent is the repo root.
        return git_common.parent
    # Fallback: walk up from script location.
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
    sql_path = Path(__file__).parent.parent / "docs" / "sql" / "20260608_data_requests.sql"
    if not sql_path.exists():
        # Worktree: script is at worktree_root/scripts/, sql at worktree_root/docs/sql/
        sql_path = Path(__file__).parent.parent / "docs" / "sql" / "20260608_data_requests.sql"
    sql = sql_path.read_text()

    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        print("Migration applied OK")

        # Verify
        with conn.cursor() as cur:
            cur.execute("SELECT has_table_privilege('anon','data_requests','SELECT')")
            anon_select = cur.fetchone()[0]
            cur.execute("SELECT has_table_privilege('service_role','data_requests','INSERT')")
            svc_insert = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM public.data_requests")
            row_count = cur.fetchone()[0]

        print(f"anon SELECT={anon_select}  (must be False)")
        print(f"service_role INSERT={svc_insert}  (must be True)")
        print(f"row count={row_count}")

        if anon_select:
            print("ERROR: anon still has SELECT — REVOKE failed!")
            sys.exit(1)
        if not svc_insert:
            print("ERROR: service_role INSERT missing!")
            sys.exit(1)
        print("All checks PASSED")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
