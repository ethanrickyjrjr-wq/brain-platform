"""One-shot cleanup: remove rows with epoch-zero periods and re-ingest FY1999/2001/2002/2003."""
from __future__ import annotations
import os, sys, tomllib, pathlib
import psycopg

def get_conn_str() -> str:
    env = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    if env:
        return env
    p = pathlib.Path(".dlt/secrets.toml")
    if p.exists():
        data = tomllib.loads(p.read_text())
        c = data["destination"]["postgres"]["credentials"]
        return f"postgresql://{c['username']}:{c['password']}@{c['host']}:{c.get('port',5432)}/{c['database']}"
    raise RuntimeError("No DB credentials found")

conn_str = get_conn_str()
BAD_CUTOFF = "1990-01-01"

with psycopg.connect(conn_str) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM fl_dor_tdt_collections WHERE period < %s", (BAD_CUTOFF,))
        n = cur.fetchone()[0]
        print(f"Removing {n} rows with period < {BAD_CUTOFF}...")
        cur.execute("DELETE FROM fl_dor_tdt_collections WHERE period < %s", (BAD_CUTOFF,))
    conn.commit()
    print("Done.")

os.environ["DESTINATION__POSTGRES__CREDENTIALS"] = conn_str
from ingest.pipelines.fl_dor_tdt.pipeline import main
print("\nRe-ingesting FY1999, 2001, 2002, 2003 with fixed date parser...")
main(["--fy", "1999"])
main(["--fy", "2001"])
main(["--fy", "2002"])
main(["--fy", "2003"])
print("\nVerifying:")
with psycopg.connect(conn_str) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM fl_dor_tdt_collections WHERE period < %s", (BAD_CUTOFF,))
        print("  Bad rows remaining:", cur.fetchone()[0])
        cur.execute("SELECT county, COUNT(*), MIN(period), MAX(period) FROM fl_dor_tdt_collections GROUP BY county ORDER BY county")
        for r in cur.fetchall():
            print(" ", r)
