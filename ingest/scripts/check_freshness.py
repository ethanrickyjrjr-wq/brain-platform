"""Daily freshness probe — alerts when any registered pipeline is stale.

Reads ingest/cadence_registry.yaml; queries _tier1_inventory.updated_at for
tier-1/tier-1-duckdb entries and _dlt_loads.inserted_at for tier-2 entries;
writes a markdown table to $GITHUB_STEP_SUMMARY listing any pipeline whose
age > cadence_days * tolerance_multiplier.

Always exits 0 (probe is observability, not gating).
"""
import argparse
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import yaml

# ── connection ────────────────────────────────────────────────────────────────


def _get_connection():
    import psycopg

    conninfo = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    if conninfo:
        return psycopg.connect(conninfo, sslmode="require")
    secrets_path = Path(__file__).parent.parent.parent / ".dlt" / "secrets.toml"
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
    )


# ── registry ──────────────────────────────────────────────────────────────────


def load_registry(path: str | Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


# ── per-entry checks ──────────────────────────────────────────────────────────


def _to_date(val) -> date:
    if isinstance(val, datetime):
        return val.astimezone(timezone.utc).date()
    if isinstance(val, date):
        return val
    raise ValueError(f"Cannot convert {type(val)} to date")


def check_tier1_entry(conn, entry: dict) -> dict:
    """Query _tier1_inventory by id (exact or prefix) and return a status dict."""
    name = entry["name"]
    lane = entry["lane"]
    inv_id = entry["inventory_id"]
    key_type = entry.get("inventory_key_type", "exact")
    cadence = int(entry["cadence_days"])
    tolerance = float(entry["tolerance_multiplier"])
    threshold = int(cadence * tolerance)

    with conn.cursor() as cur:
        if key_type == "prefix":
            cur.execute(
                "SELECT updated_at FROM data_lake._tier1_inventory"
                " WHERE id LIKE %s ORDER BY updated_at DESC LIMIT 1",
                (inv_id + "%",),
            )
        else:
            cur.execute(
                "SELECT updated_at FROM data_lake._tier1_inventory WHERE id = %s",
                (inv_id,),
            )
        row = cur.fetchone()

    if row is None or row[0] is None:
        return {
            "name": name,
            "lane": lane,
            "last_run": None,
            "age_days": None,
            "cadence_days": cadence,
            "threshold_days": threshold,
            "status": "MISSING",
        }

    last_run = _to_date(row[0])
    age_days = (date.today() - last_run).days
    status = "STALE" if age_days > threshold else "FRESH"
    return {
        "name": name,
        "lane": lane,
        "last_run": last_run,
        "age_days": age_days,
        "cadence_days": cadence,
        "threshold_days": threshold,
        "status": status,
    }


def check_tier2_entry(conn, entry: dict) -> dict:
    """Query _dlt_loads by schema_name and return a status dict."""
    name = entry["name"]
    schema_name = entry["dlt_schema_name"]
    cadence = int(entry["cadence_days"])
    tolerance = float(entry["tolerance_multiplier"])
    threshold = int(cadence * tolerance)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT MAX(inserted_at) FROM data_lake._dlt_loads"
            " WHERE schema_name = %s AND status = 0",
            (schema_name,),
        )
        row = cur.fetchone()

    if row is None or row[0] is None:
        return {
            "name": name,
            "lane": "tier-2",
            "last_run": None,
            "age_days": None,
            "cadence_days": cadence,
            "threshold_days": threshold,
            "status": "MISSING",
        }

    last_run = _to_date(row[0])
    age_days = (date.today() - last_run).days
    status = "STALE" if age_days > threshold else "FRESH"
    return {
        "name": name,
        "lane": "tier-2",
        "last_run": last_run,
        "age_days": age_days,
        "cadence_days": cadence,
        "threshold_days": threshold,
        "status": status,
    }


# ── probe runner ──────────────────────────────────────────────────────────────


def run_probe(conn, registry: dict) -> list[dict]:
    results = []
    for entry in registry.get("pipelines", []):
        lane = entry.get("lane", "")
        if lane in ("tier-1", "tier-1-duckdb"):
            results.append(check_tier1_entry(conn, entry))
        elif lane == "tier-2":
            results.append(check_tier2_entry(conn, entry))
    return results


# ── output formatting ─────────────────────────────────────────────────────────

_STATUS_ICON = {"FRESH": "✅", "STALE": "⚠️", "MISSING": "❌"}


def format_summary(results: list[dict], run_date: date | None = None) -> str:
    today = run_date or date.today()
    header = f"## Pipeline Freshness Probe — {today}\n\n"

    stale_or_missing = [r for r in results if r["status"] != "FRESH"]
    if not stale_or_missing:
        return header + "✅ All pipelines fresh.\n"

    lines = [
        "| Pipeline | Lane | Last Run | Age (days) | Cadence | Threshold | Status |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in results:
        icon = _STATUS_ICON.get(r["status"], r["status"])
        last_run = str(r["last_run"]) if r["last_run"] is not None else "—"
        age = str(r["age_days"]) if r["age_days"] is not None else "—"
        lines.append(
            f"| {r['name']} | {r['lane']} | {last_run} | {age}"
            f" | {r['cadence_days']}d | {r['threshold_days']}d | {icon} {r['status']} |"
        )
    return header + "\n".join(lines) + "\n"


# ── main ──────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Pipeline freshness probe.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print to stdout instead of writing to $GITHUB_STEP_SUMMARY.",
    )
    args = parser.parse_args(argv)

    registry_path = Path(__file__).parent.parent / "cadence_registry.yaml"
    registry = load_registry(registry_path)

    conn = _get_connection()
    try:
        results = run_probe(conn, registry)
    finally:
        conn.close()

    summary = format_summary(results)

    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if args.dry_run or not step_summary:
        sys.stdout.buffer.write(summary.encode("utf-8"))
    else:
        with open(step_summary, "a", encoding="utf-8") as fh:
            fh.write(summary)

    return 0


if __name__ == "__main__":
    sys.exit(main())
