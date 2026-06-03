"""Daily freshness probe — alerts when any registered pipeline is stale or low-volume.

Reads ingest/cadence_registry.yaml; queries _tier1_inventory.updated_at for
tier-1/tier-1-duckdb entries and _dlt_loads.inserted_at for tier-2 entries;
also checks landed row count vs expected_rows_min (when set) and flags LOW_VOLUME.

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
        return psycopg.connect(conninfo, sslmode="require", connect_timeout=15)
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
        connect_timeout=15,
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


def check_volume_entry(conn, entry: dict) -> dict | None:
    """Check landed row count vs expected_rows_min.

    Returns a volume result dict or None if the check doesn't apply.
    Skips tier-1 entries (no SQL table to count). Always exits 0 — LOW_VOLUME
    surfaces in the summary but never gates the pipeline.

    count_table resolution order:
      1. entry["count_table"]  — explicit fully-qualified name (required for dlt entries
                                 where schema_name != table name)
      2. entry["freshness_table"] — already fully-qualified; used for public.* non-dlt tables
      3. data_lake.<dlt_schema_name> — fallback for dlt entries where names do match
    """
    from psycopg import sql as pgsql

    min_rows = entry.get("expected_rows_min")
    if min_rows is None:
        return None

    lane = entry.get("lane", "")
    if lane in ("tier-1", "tier-1-duckdb"):
        return None

    count_table = (
        entry.get("count_table")
        or entry.get("freshness_table")
        or (f"data_lake.{entry['dlt_schema_name']}" if "dlt_schema_name" in entry else None)
    )
    if not count_table:
        return None

    schema, table = count_table.split(".", 1)
    with conn.cursor() as cur:
        cur.execute(
            pgsql.SQL("SELECT count(*) FROM {}.{}").format(
                pgsql.Identifier(schema), pgsql.Identifier(table)
            )
        )
        row = cur.fetchone()

    landed = row[0] if row else 0
    status = "LOW_VOLUME" if landed < min_rows else "OK"
    return {"landed": landed, "min_rows": min_rows, "status": status, "table": count_table}


def check_tier2_entry(conn, entry: dict) -> dict:
    """Query tier-2 freshness — via _dlt_loads (dlt pipelines) or directTableFreshness (non-dlt)."""
    from psycopg import sql as pgsql

    name = entry["name"]
    cadence = int(entry["cadence_days"])
    tolerance = float(entry["tolerance_multiplier"])
    threshold = int(cadence * tolerance)

    with conn.cursor() as cur:
        if "freshness_table" in entry:
            # Non-dlt pipeline: query MAX(<freshness_column>) on the named table directly.
            # freshness_column defaults to inserted_at; override in registry for tables that
            # use a different timestamp (e.g. scraped_at, last_seen_at).
            freshness_col = entry.get("freshness_column", "inserted_at")
            schema, table = entry["freshness_table"].split(".", 1)
            cur.execute(
                pgsql.SQL("SELECT MAX({}) FROM {}.{}").format(
                    pgsql.Identifier(freshness_col),
                    pgsql.Identifier(schema),
                    pgsql.Identifier(table),
                )
            )
        else:
            schema_name = entry["dlt_schema_name"]
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
            r = check_tier1_entry(conn, entry)
        elif lane == "tier-2":
            r = check_tier2_entry(conn, entry)
        else:
            continue
        vol = check_volume_entry(conn, entry)
        r["volume_status"] = vol["status"] if vol else None
        r["volume_landed"] = vol["landed"] if vol else None
        r["volume_min"] = vol["min_rows"] if vol else None
        results.append(r)
    return results


# ── output formatting ─────────────────────────────────────────────────────────

_STATUS_ICON = {"FRESH": "✅", "STALE": "⚠️", "MISSING": "❌"}
_VOL_ICON = {"OK": "✅", "LOW_VOLUME": "⚠️"}


def format_summary(results: list[dict], run_date: date | None = None) -> str:
    today = run_date or date.today()
    header = f"## Pipeline Freshness Probe — {today}\n\n"

    alerting = [
        r for r in results
        if r["status"] != "FRESH" or r.get("volume_status") == "LOW_VOLUME"
    ]
    if not alerting:
        return header + "✅ All pipelines fresh and volume healthy.\n"

    lines = [
        "| Pipeline | Lane | Last Run | Age (days) | Cadence | Threshold | Status | Volume |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in alerting:
        icon = _STATUS_ICON.get(r["status"], r["status"])
        last_run = str(r["last_run"]) if r["last_run"] is not None else "—"
        age = str(r["age_days"]) if r["age_days"] is not None else "—"
        vol_status = r.get("volume_status")
        if vol_status == "LOW_VOLUME":
            vol_str = f"⚠️ {r['volume_landed']:,} / {r['volume_min']:,}"
        elif vol_status == "OK":
            vol_str = "✅"
        else:
            vol_str = "—"
        lines.append(
            f"| {r['name']} | {r['lane']} | {last_run} | {age}"
            f" | {r['cadence_days']}d | {r['threshold_days']}d | {icon} {r['status']} | {vol_str} |"
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

    try:
        conn = _get_connection()
    except Exception as exc:
        today = date.today()
        msg = (
            f"## Pipeline Freshness Probe — {today}\n\n"
            f"⚠️ **DB connection failed — probe skipped this run.**\n\n"
            f"```\n{exc}\n```\n\n"
            f"Probe is observability-only (non-gating). Check `DESTINATION__POSTGRES__CREDENTIALS` "
            f"and Supabase status if this repeats.\n"
        )
        step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if args.dry_run or not step_summary:
            sys.stdout.buffer.write(msg.encode("utf-8"))
        else:
            with open(step_summary, "a", encoding="utf-8") as fh:
                fh.write(msg)
        return 0  # probe is observability, not gating — never fail CI on connection issues

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
