"""Data-quality probe — value-level tests (Quality pillar) + column-type-change
detector (Schema pillar). SOLO-25.

Fills the two Monte Carlo observability pillars the lake had zero coverage on:

  Quality — dbt-style value tests (not_null / unique / accepted_values) on
            load-bearing columns. Each test is a failing-row count(*) query; a
            test passes iff the query returns zero rows.

  Schema  — a column-type-change detector. Reads live information_schema.columns
            and diffs against a checked-in baseline JSON per table; classifies
            each delta ADDED / REMOVED / TYPE_CHANGED. TYPE_CHANGED is the
            load-bearing signal (the news_articles_swfl.published_date date<->text
            class that crashes a dlt LOAD with no warning). Complements build 22
            (dlt schema_contract — catches drift at WRITE time; this catches it
            AT REST).

Opt-in per table via ingest/quality/quality_registry.yaml (keyed by physical
table). Non-gating: failures surface in the GHA step summary; an error-severity
value-test fail or a TYPE_CHANGED opens a public.checks row under project
"data-quality" (auto-closed when the condition clears). Always exits 0 — mirrors
check_freshness.py's "observability, not gating" contract.

CLI:
  (no flag)          full run: writes summary to $GITHUB_STEP_SUMMARY + syncs the
                     checks ledger.
  --dry-run          NO MUTATION, NOT no-DB. The value-test SELECTs and the
                     information_schema read still run (read-only); only the
                     checks-ledger writes and baseline-file writes are suppressed.
                     Output goes to stdout.
  --update-baseline  Re-write every schema_baseline table's JSON from the live
                     information_schema. MANUAL / DEV-RUN, committed in the SAME PR
                     as the intended type change. CI never runs this — auto-committing
                     a baseline would silently bless unintended drift, defeating the
                     detector. Implies no ledger sync.
"""
import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import yaml

# Reuse the freshness probe's connection + slug helpers (single source of truth).
sys.path.insert(0, str(Path(__file__).parent))
from check_freshness import _get_connection, _slug  # noqa: E402

_QUALITY_PROJECT = "data-quality"
_QUALITY_PREFIX = "quality_fail_"
_SCHEMA_PREFIX = "schema_drift_"

_REGISTRY_PATH = Path(__file__).parent.parent / "quality" / "quality_registry.yaml"
_BASELINE_DIR = Path(__file__).parent.parent / "quality" / "schema_baselines"


# ── registry ──────────────────────────────────────────────────────────────────


def load_quality_registry(path: str | Path = _REGISTRY_PATH) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


# ── Quality: failing-row SQL builders (pure — unit-testable, no DB) ─────────────
#
# Each builder returns (query, params) where `query` is a psycopg.sql.Composable.
# SQL-injection is neutralized structurally: every table/column identifier routes
# through psycopg.sql.Identifier, every accepted-value through a bound parameter.
# A test passes iff its count(*) returns 0 (dbt's failing-row model).


def _table_ident(table: str):
    """'data_lake.news_articles_swfl' -> Identifier('data_lake','news_articles_swfl')."""
    from psycopg import sql as pgsql

    parts = table.split(".")
    return pgsql.Identifier(*parts)


def build_not_null_sql(table: str, col: str):
    """count(*) of rows where col IS NULL."""
    from psycopg import sql as pgsql

    q = pgsql.SQL("SELECT count(*) FROM {} WHERE {} IS NULL").format(
        _table_ident(table), pgsql.Identifier(col)
    )
    return q, []


def build_unique_sql(table: str, col: str):
    """count(*) of duplicated non-null values of col."""
    from psycopg import sql as pgsql

    q = pgsql.SQL(
        "SELECT count(*) FROM ("
        "SELECT {col} FROM {tbl} WHERE {col} IS NOT NULL "
        "GROUP BY {col} HAVING count(*) > 1) d"
    ).format(col=pgsql.Identifier(col), tbl=_table_ident(table))
    return q, []


def build_accepted_values_sql(table: str, col: str, values: list):
    """count(*) of non-null rows whose col is OUTSIDE the accepted set.

    LOCKED composition: `{col}::text <> ALL(%s::text[])` with a single bound
    array param. psycopg3 adapts a Python list to a PG ARRAY (not a SQL tuple),
    so the psycopg2 idiom `... NOT IN %s` raises SyntaxError — this form is the
    proven, type-agnostic alternative (verified live 2026-06-22).
    """
    from psycopg import sql as pgsql

    q = pgsql.SQL(
        "SELECT count(*) FROM {tbl} WHERE {col} IS NOT NULL "
        "AND {col}::text <> ALL(%s::text[])"
    ).format(tbl=_table_ident(table), col=pgsql.Identifier(col))
    return q, [[str(v) for v in values]]


_BUILDERS = {
    "not_null": lambda t, spec: build_not_null_sql(t, spec["col"]),
    "unique": lambda t, spec: build_unique_sql(t, spec["col"]),
    "accepted_values": lambda t, spec: build_accepted_values_sql(t, spec["col"], spec["values"]),
}


def run_value_tests(conn, registry: dict) -> list[dict]:
    """Run every opted-in value test. One result dict per test:
    {table, col, test, severity, failing_rows, status: PASS|FAIL|SKIP}.

    Each query runs in its own try/rollback so a missing table or a malformed
    test can never break the run (probe must stay exit 0)."""
    results: list[dict] = []
    for table, cfg in (registry.get("tables") or {}).items():
        for spec in cfg.get("value_tests", []) or []:
            test = spec.get("test")
            severity = spec.get("severity", "warn")
            base = {
                "table": table,
                "col": spec.get("col"),
                "test": test,
                "severity": severity,
            }
            builder = _BUILDERS.get(test)
            if builder is None:
                results.append({**base, "failing_rows": None, "status": "SKIP",
                                "detail": f"unknown test '{test}'"})
                continue
            try:
                query, params = builder(table, spec)
                with conn.cursor() as cur:
                    cur.execute(query, params)
                    failing = cur.fetchone()[0]
            except Exception as exc:  # noqa: BLE001 — observability, never gate
                try:
                    conn.rollback()
                except Exception:
                    pass
                results.append({**base, "failing_rows": None, "status": "SKIP",
                                "detail": str(exc)})
                continue
            results.append({
                **base,
                "failing_rows": failing,
                "status": "PASS" if failing == 0 else "FAIL",
            })
    return results


# ── Schema: baseline diff (pure classifier + live reader) ───────────────────────


def diff_schema(baseline: dict[str, str], live: dict[str, str]) -> list[dict]:
    """Classify each column delta between a baseline and the live schema.

    Returns list[dict] sorted by col:
      {col, change: ADDED|REMOVED|TYPE_CHANGED, baseline_type, live_type}
        ADDED        -> in live, not baseline (baseline_type None)
        REMOVED      -> in baseline, not live (live_type None)
        TYPE_CHANGED -> in both, data_type differs
    Identical maps -> []. Pure (two dicts in, list out) — no DB."""
    deltas: list[dict] = []
    for col in sorted(set(baseline) | set(live)):
        b = baseline.get(col)
        l = live.get(col)
        if b is None and l is not None:
            deltas.append({"col": col, "change": "ADDED", "baseline_type": None, "live_type": l})
        elif l is None and b is not None:
            deltas.append({"col": col, "change": "REMOVED", "baseline_type": b, "live_type": None})
        elif b != l:
            deltas.append({"col": col, "change": "TYPE_CHANGED", "baseline_type": b, "live_type": l})
    return deltas


def read_live_schema(conn, table: str) -> dict[str, str]:
    """{column_name: data_type} from information_schema.columns for schema.table."""
    schema, tbl = table.split(".", 1)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position",
            (schema, tbl),
        )
        return {c: d for c, d in cur.fetchall()}


def _baseline_path(table: str) -> Path:
    return _BASELINE_DIR / f"{table}.json"


def load_baseline(table: str) -> dict[str, str] | None:
    """Checked-in {column: data_type} for a table, or None if no baseline file."""
    p = _baseline_path(table)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def write_baseline(table: str, live: dict[str, str]) -> Path:
    """Re-bless: write the live schema to the table's baseline JSON (dev-run)."""
    _BASELINE_DIR.mkdir(parents=True, exist_ok=True)
    p = _baseline_path(table)
    p.write_text(json.dumps(live, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return p


def run_schema_drift(conn, registry: dict) -> list[dict]:
    """For each schema_baseline table, diff live vs checked-in baseline.

    Result per table: {table, status, deltas}.
      status BASELINE_MISSING -> no baseline file yet (run --update-baseline)
      status CLEAN            -> no deltas
      status DRIFT            -> deltas present (deltas carries the classified list)
      status SKIP             -> live read failed (missing table, etc.)"""
    results: list[dict] = []
    for table, cfg in (registry.get("tables") or {}).items():
        if not cfg.get("schema_baseline"):
            continue
        try:
            live = read_live_schema(conn, table)
        except Exception as exc:  # noqa: BLE001
            try:
                conn.rollback()
            except Exception:
                pass
            results.append({"table": table, "status": "SKIP", "deltas": [], "detail": str(exc)})
            continue
        if not live:
            results.append({"table": table, "status": "SKIP", "deltas": [],
                            "detail": "table not found in information_schema"})
            continue
        baseline = load_baseline(table)
        if baseline is None:
            results.append({"table": table, "status": "BASELINE_MISSING", "deltas": []})
            continue
        deltas = diff_schema(baseline, live)
        results.append({
            "table": table,
            "status": "CLEAN" if not deltas else "DRIFT",
            "deltas": deltas,
        })
    return results


# ── checks-ledger sync (non-dry-run only) ───────────────────────────────────────


def _quality_check_key(table: str, col: str, test: str) -> str:
    return f"{_QUALITY_PREFIX}{_slug(table)}_{col}_{test}"


def _schema_check_key(table: str, col: str) -> str:
    return f"{_SCHEMA_PREFIX}{_slug(table)}_{col}"


def sync_quality_checks(conn, value_results: list[dict], schema_results: list[dict]) -> dict:
    """Open/auto-close public.checks rows for error-severity value-test fails and
    TYPE_CHANGED schema drifts. Scoped to project=data-quality (so a same-prefixed
    key from another project can never be silently auto-closed). Idempotent;
    respects a human 'dropped' decision. Mirrors check_freshness.sync_gap_checks."""
    want: dict[str, str] = {}  # check_key -> label

    for r in value_results:
        if r["severity"] == "error" and r["status"] == "FAIL":
            key = _quality_check_key(r["table"], r["col"], r["test"])
            want[key] = (
                f"Quality fail: {r['table']}.{r['col']} {r['test']} "
                f"({r['failing_rows']:,} failing rows)"
            )

    for s in schema_results:
        for d in s["deltas"]:
            if d["change"] == "TYPE_CHANGED":
                key = _schema_check_key(s["table"], d["col"])
                want[key] = (
                    f"Schema drift: {s['table']}.{d['col']} type changed "
                    f"{d['baseline_type']} -> {d['live_type']}"
                )

    opened: list[str] = []
    closed: list[str] = []
    with conn.cursor() as cur:
        for key, label in want.items():
            cur.execute(
                "SELECT id, state FROM public.checks WHERE check_key = %s"
                " ORDER BY created_at DESC LIMIT 1",
                (key,),
            )
            row = cur.fetchone()
            if row is None:
                cur.execute(
                    "INSERT INTO public.checks"
                    " (project, check_key, label, detail, priority, state)"
                    " VALUES (%s, %s, %s, %s, %s, 'open')",
                    (
                        _QUALITY_PROJECT,
                        key,
                        label,
                        "Auto-detected by the daily data-quality probe "
                        "(check_data_quality.py). Fix the data / re-bless the schema "
                        "baseline (--update-baseline), or close --drop if intentional.",
                        1,
                    ),
                )
                opened.append(key)
            elif row[1] == "done":
                cur.execute(
                    "UPDATE public.checks SET state='open', resolved_at=NULL,"
                    " resolved_by=NULL, updated_at=now() WHERE id = %s",
                    (row[0],),
                )
                opened.append(key)
            # state in ('open','dropped') -> leave as-is.

        # Auto-close: any open data-quality auto-check whose condition cleared.
        # Scoped to _QUALITY_PROJECT; prefix-OR parenthesized so it binds before
        # the state filter.
        cur.execute(
            "SELECT id, check_key FROM public.checks"
            " WHERE project = %s AND state='open'"
            " AND (check_key LIKE %s OR check_key LIKE %s)",
            (_QUALITY_PROJECT, _QUALITY_PREFIX + "%", _SCHEMA_PREFIX + "%"),
        )
        for cid, key in cur.fetchall():
            if key not in want:
                cur.execute(
                    "UPDATE public.checks SET state='done', resolved_at=now(),"
                    " resolved_by='data-quality-probe (auto)', updated_at=now()"
                    " WHERE id = %s",
                    (cid,),
                )
                closed.append(key)
    conn.commit()
    return {"opened": opened, "closed": closed}


# ── output formatting ───────────────────────────────────────────────────────────

_SEV_ICON = {"error": "❌", "warn": "⚠️"}


def format_value_tests(results: list[dict]) -> str:
    """Quality section: surface FAIL/SKIP rows; clean ✅ when all pass."""
    if not results:
        return ""
    alerting = [r for r in results if r["status"] != "PASS"]
    lines = ["\n### Quality — value tests\n"]
    if not alerting:
        lines.append(f"✅ All {len(results)} value tests pass.\n")
        return "\n".join(lines) + "\n"
    lines += [
        "| Table | Column | Test | Severity | Failing rows | Status |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in alerting:
        sev = f"{_SEV_ICON.get(r['severity'], '')} {r['severity']}"
        failing = f"{r['failing_rows']:,}" if r["failing_rows"] is not None else "—"
        lines.append(
            f"| `{r['table']}` | {r['col']} | {r['test']} | {sev} | {failing} | {r['status']} |"
        )
    return "\n".join(lines) + "\n"


def format_schema_drift(results: list[dict]) -> str:
    """Schema section: surface DRIFT/BASELINE_MISSING/SKIP; clean ✅ when all match."""
    if not results:
        return ""
    alerting = [s for s in results if s["status"] != "CLEAN"]
    lines = ["\n### Schema drift — column-type-change detector\n"]
    if not alerting:
        lines.append(f"✅ All {len(results)} baselined tables match their schema baseline.\n")
        return "\n".join(lines) + "\n"
    lines += [
        "| Table | Column | Change | Baseline type | Live type |",
        "| --- | --- | --- | --- | --- |",
    ]
    for s in alerting:
        if s["status"] == "BASELINE_MISSING":
            lines.append(f"| `{s['table']}` | — | ⚠️ BASELINE_MISSING (run `--update-baseline`) | — | — |")
            continue
        if s["status"] == "SKIP":
            lines.append(f"| `{s['table']}` | — | — SKIP ({s.get('detail', '')}) | — | — |")
            continue
        for d in s["deltas"]:
            icon = "🚨" if d["change"] == "TYPE_CHANGED" else "⚠️"
            lines.append(
                f"| `{s['table']}` | {d['col']} | {icon} {d['change']}"
                f" | {d['baseline_type'] or '—'} | {d['live_type'] or '—'} |"
            )
    return "\n".join(lines) + "\n"


# ── main ────────────────────────────────────────────────────────────────────────


def _emit(msg: str, dry_run: bool) -> None:
    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if dry_run or not step_summary:
        sys.stdout.buffer.write(msg.encode("utf-8"))
    else:
        with open(step_summary, "a", encoding="utf-8") as fh:
            fh.write(msg)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Data-quality probe (value tests + schema drift).")
    parser.add_argument("--dry-run", action="store_true",
                        help="No mutation (not no-DB): run read-only checks, skip ledger + baseline writes; print to stdout.")
    parser.add_argument("--update-baseline", action="store_true",
                        help="Re-write every schema_baseline table's JSON from the live schema (dev-run, commit it).")
    args = parser.parse_args(argv)

    registry = load_quality_registry()

    try:
        conn = _get_connection()
    except Exception as exc:  # noqa: BLE001 — never fail CI on connection issues
        _emit(
            "## Data-Quality Probe\n\n"
            "⚠️ **DB connection failed — probe skipped this run.**\n\n"
            f"```\n{exc}\n```\n\nProbe is observability-only (non-gating).\n",
            args.dry_run,
        )
        return 0

    try:
        if args.update_baseline:
            # Dev-run: re-bless every baselined table from the live schema.
            written = []
            for table, cfg in (registry.get("tables") or {}).items():
                if not cfg.get("schema_baseline"):
                    continue
                try:
                    live = read_live_schema(conn, table)
                except Exception:
                    conn.rollback()
                    continue
                if live:
                    p = write_baseline(table, live)
                    written.append(str(p))
            _emit(
                "## Data-Quality Probe — baselines updated\n\n"
                + "".join(f"- wrote `{p}`\n" for p in written),
                dry_run=True,  # always stdout; --update-baseline never writes the summary
            )
            return 0

        value_results = run_value_tests(conn, registry)
        schema_results = run_schema_drift(conn, registry)

        sync = None
        if not args.dry_run:
            try:
                sync = sync_quality_checks(conn, value_results, schema_results)
            except Exception as exc:  # noqa: BLE001 — never gate on a ledger error
                try:
                    conn.rollback()
                except Exception:
                    pass
                sync = {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001 — preserve "Always exits 0"
        _emit(
            "## Data-Quality Probe\n\n"
            "⚠️ **Probe run errored — partial/empty result this run.**\n\n"
            f"```\n{exc}\n```\n\nObservability-only; did not fail CI.\n",
            args.dry_run,
        )
        conn.close()
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass

    summary = "## Data-Quality Probe\n"
    summary += format_value_tests(value_results)
    summary += format_schema_drift(schema_results)
    if sync and "error" in sync:
        summary += f"\n_checks-ledger sync skipped: `{sync['error']}`_\n"
    elif sync:
        if sync.get("opened"):
            summary += f"\nopened: {', '.join(sync['opened'])}\n"
        if sync.get("closed"):
            summary += f"auto-closed (cleared): {', '.join(sync['closed'])}\n"
    _emit(summary, args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
