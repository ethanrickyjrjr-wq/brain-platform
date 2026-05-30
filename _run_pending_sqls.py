"""Run the two operator-gated SQL migrations that haven't been applied yet."""
import tomllib
import psycopg
import pathlib

repo = pathlib.Path(__file__).parent
secrets = tomllib.loads((repo / ".dlt" / "secrets.toml").read_text())
creds = secrets["destination"]["postgres"]["credentials"]
conn_str = (
    f"postgresql://{creds['username']}:{creds['password']}"
    f"@{creds['host']}:{creds['port']}/{creds['database']}"
)

sqls = [
    repo / "docs" / "sql" / "20260529_goals_table.sql",
    repo / "docs" / "sql" / "20260530_goal9_flywheel.sql",
]

with psycopg.connect(conn_str) as conn:
    with conn.cursor() as cur:
        for path in sqls:
            print(f"Running {path.name}...")
            cur.execute(path.read_text())
        conn.commit()
        cur.execute("SELECT goal_number, title, status FROM public.goals ORDER BY goal_number")
        rows = cur.fetchall()

print(f"\ngoals table: {len(rows)} rows")
for r in rows:
    print(f"  Goal {r[0]}: {r[1][:50]} [{r[2]}]")
