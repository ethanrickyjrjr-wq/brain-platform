"""Daily freshness probe — alerts when any registered pipeline is stale or low-volume.

Reads ingest/cadence_registry.yaml; queries _tier1_inventory.updated_at for
tier-1/tier-1-duckdb entries and _dlt_loads.inserted_at (or MAX(freshness_column)
on the named table for non-dlt entries) for tier-2 entries; also checks landed row
count vs expected_rows_min (when set) and flags LOW_VOLUME.

ODD window mode (probe_mode: odd_window):
  Manual-drop sources that arrive unpredictably. Instead of a tolerance threshold,
  uses a ±10-day window around the expected date (last_run + cadence_days).
  WAITING/UNINITIALIZED are silent. WINDOW_OPEN / OVERDUE surface as alerts.

Also runs a structural-gap detector (check_structural_gaps / sync_gap_checks): any
city we capture city_pulse news for with zero verified corridor_profiles rows is
opened as a `corridor_gap_*` row in the public.checks ledger (auto-closed when the
gap clears). This catches the class the cadence registry can't — a city the weekly
corridor-pulse pipeline never queries because it has no corridor (e.g. Lehigh Acres).

View liveness probe (check_view_liveness):
  For any registry entry with a `liveness_view:` field, issues a SELECT 1 LIMIT 1
  via the live PostgREST/REST surface (SUPABASE_URL + SUPABASE_SERVICE_KEY). This
  is the surface that actually 404s when a GRANT is missing — psycopg bypasses it.
  Logs VIEW_STALE on timeout / 404 / zero rows. Non-gating, same as the rest of the
  probe. Gracefully skipped when SUPABASE_URL or SUPABASE_SERVICE_KEY is unset.

Always exits 0 (probe is observability, not gating).
"""
import argparse
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
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


# ── view liveness probe ────────────────────────────────────────────────────────
#
# Checks views via the live PostgREST REST surface — the surface that actually
# 404s when a GRANT is missing (psycopg/direct-Postgres bypasses PostgREST and
# would NOT catch a missing GRANT on the view). One GET request per view with a
# 10-second timeout; non-gating — logs VIEW_STALE and moves on.
#
# PostgREST routing:
#   public schema  → GET {SUPABASE_URL}/rest/v1/{view}?select=*&limit=1
#   other schemas  → same URL, plus Accept-Profile: {schema} header
#
# Supabase service-role key bypasses RLS but still requires the PostgREST GRANT
# (GRANT SELECT ON <view> TO service_role), which is what we want to prove live.

_VIEW_PROBE_TIMEOUT = 10  # seconds; non-gating — failures surface as VIEW_STALE


def check_view_liveness(liveness_view: str) -> dict:
    """Probe a view via the live Supabase PostgREST REST surface.

    liveness_view format: "schema.view_name" (e.g. "data_lake.zhvi_zip_latest").
    Returns a result dict with keys: view, status, http_status, detail.

    Statuses:
      VIEW_FRESH   — 200 with ≥1 row returned
      VIEW_STALE   — 404 / 401 / non-200 / zero rows / timeout / missing creds
    """
    import urllib.request
    import urllib.error
    import json as json_lib

    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "")

    base = {"view": liveness_view}

    if not supabase_url or not supabase_key:
        return {
            **base,
            "status": "VIEW_STALE",
            "http_status": None,
            "detail": "SUPABASE_URL or SUPABASE_SERVICE_KEY not set — view probe skipped",
        }

    # Parse "schema.view_name"; fall back to treating the whole string as view name.
    if "." in liveness_view:
        schema, view_name = liveness_view.split(".", 1)
    else:
        schema, view_name = "public", liveness_view

    url = f"{supabase_url}/rest/v1/{view_name}?select=*&limit=1"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
    }
    # Non-public schemas require the Accept-Profile header so PostgREST routes to
    # the right schema's search_path.
    if schema != "public":
        headers["Accept-Profile"] = schema

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=_VIEW_PROBE_TIMEOUT) as resp:
            http_status = resp.status
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return {
            **base,
            "status": "VIEW_STALE",
            "http_status": exc.code,
            "detail": f"HTTP {exc.code} — likely missing GRANT or view does not exist",
        }
    except Exception as exc:  # noqa: BLE001 — timeout, network error, etc.
        return {
            **base,
            "status": "VIEW_STALE",
            "http_status": None,
            "detail": f"Request error: {exc}",
        }

    if http_status != 200:
        return {
            **base,
            "status": "VIEW_STALE",
            "http_status": http_status,
            "detail": f"Unexpected HTTP {http_status}",
        }

    # PostgREST returns a JSON array; zero rows means the view exists but is empty
    # (which is VIEW_STALE for our purposes — we need at least one row to prove the
    # view is readable and populated).
    try:
        rows = json_lib.loads(body)
        row_count = len(rows) if isinstance(rows, list) else 0
    except Exception:
        row_count = 0

    if row_count == 0:
        return {
            **base,
            "status": "VIEW_STALE",
            "http_status": http_status,
            "detail": "View returned 0 rows — view exists but is empty or not yet populated",
        }

    return {
        **base,
        "status": "VIEW_FRESH",
        "http_status": http_status,
        "detail": f"OK — {row_count} row(s) returned",
    }


def collect_views_manifest(registry: dict) -> list[str]:
    """Return the sorted set of all liveness_view values in the registry.

    Keeping this manifest explicit surfaces view renames: if a view referenced
    here disappears (renamed in §02 or later), the probe will log VIEW_STALE and
    the manifest diff in the GHA summary makes the rename visible (§08 continuity).
    """
    views: set[str] = set()
    for entry in registry.get("pipelines", []):
        v = entry.get("liveness_view")
        if v:
            views.add(v)
    return sorted(views)


# ── per-entry checks ──────────────────────────────────────────────────────────


def _to_date(val) -> date:
    if isinstance(val, datetime):
        return val.astimezone(timezone.utc).date()
    if isinstance(val, date):
        return val
    raise ValueError(f"Cannot convert {type(val)} to date")


def _fetch_max_freshness(conn, entry: dict) -> date | None:
    """Return MAX(freshness_column) for this entry, or None if no rows / table missing.

    Handles both dlt pipelines (_dlt_loads) and non-dlt tables (freshness_table).
    Rolls back and returns None on any DB error (e.g. table not yet created for
    ODD scaffolds whose DDL hasn't been applied yet).
    """
    from psycopg import sql as pgsql

    try:
        with conn.cursor() as cur:
            if "freshness_table" in entry:
                freshness_col = entry.get("freshness_column", "inserted_at")
                schema, table = entry["freshness_table"].split(".", 1)
                source_name = entry.get("source_name")
                if source_name:
                    cur.execute(
                        pgsql.SQL("SELECT MAX({}) FROM {}.{} WHERE source_name = %s").format(
                            pgsql.Identifier(freshness_col),
                            pgsql.Identifier(schema),
                            pgsql.Identifier(table),
                        ),
                        (source_name,),
                    )
                else:
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
    except Exception:
        # Table may not exist yet (ODD scaffold DDL not applied), or other transient
        # error. Rollback so the connection stays usable and return None.
        try:
            conn.rollback()
        except Exception:
            pass
        return None

    if row is None or row[0] is None:
        return None
    return _to_date(row[0])


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
    source_name = entry.get("source_name")
    try:
        with conn.cursor() as cur:
            if source_name:
                cur.execute(
                    pgsql.SQL("SELECT count(*) FROM {}.{} WHERE source_name = %s").format(
                        pgsql.Identifier(schema), pgsql.Identifier(table)
                    ),
                    (source_name,),
                )
            else:
                cur.execute(
                    pgsql.SQL("SELECT count(*) FROM {}.{}").format(
                        pgsql.Identifier(schema), pgsql.Identifier(table)
                    )
                )
            row = cur.fetchone()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return None

    landed = row[0] if row else 0
    status = "LOW_VOLUME" if landed < min_rows else "OK"
    return {"landed": landed, "min_rows": min_rows, "status": status, "table": count_table}


def check_tier2_entry(conn, entry: dict) -> dict:
    """Query tier-2 freshness via _fetch_max_freshness and compare to threshold."""
    name = entry["name"]
    cadence = int(entry["cadence_days"])
    tolerance = float(entry["tolerance_multiplier"])
    threshold = int(cadence * tolerance)

    last_run = _fetch_max_freshness(conn, entry)

    if last_run is None:
        return {
            "name": name,
            "lane": "tier-2",
            "last_run": None,
            "age_days": None,
            "cadence_days": cadence,
            "threshold_days": threshold,
            "status": "MISSING",
        }

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


def _odd_window_half(cadence_days: int) -> int:
    """Alert window (days each side), scaled to how often the source drops.

    ≥90d (quarterly/annual) → ±10 days   — PDFs arrive a week or two off schedule
    ≥30d (monthly)          → ±5 days    — reports usually land within a week
    <30d (weekly and under) → ±2 days    — near-real-time; ±2 is still generous
    """
    if cadence_days >= 90:
        return 10
    if cadence_days >= 30:
        return 5
    return 2


def check_odd_window_entry(conn, entry: dict, _today: date | None = None) -> dict:
    """Window-based probe for ODD (manual-drop) sources.

    Expected date = last_run + cadence_days, or first_expected_by if no data,
    or today + cadence_days if neither is known (clock starts at registry entry).

    Statuses:
      WAITING     today < expected - window_half  → silent
      WINDOW_OPEN in the window, no new data yet  → shown (watching)
      OVERDUE     today > expected + window_half  → loud alert
      FRESH       new data arrived this cycle     → silent
    """
    name = entry["name"]
    lane = entry.get("lane", "tier-2")
    cadence = int(entry["cadence_days"])
    today = _today or date.today()
    window_half = _odd_window_half(cadence)

    last_run = _fetch_max_freshness(conn, entry)

    # Determine expected date for the next drop
    if last_run is not None:
        expected = last_run + timedelta(days=cadence)
    elif "first_expected_by" in entry:
        raw = entry["first_expected_by"]
        expected = raw if isinstance(raw, date) else date.fromisoformat(str(raw))
    else:
        # No prior data, no explicit date — start the clock from today so the
        # window opens in one cadence cycle rather than sitting silent forever.
        expected = today + timedelta(days=cadence)

    window_start = expected - timedelta(days=window_half)
    window_end = expected + timedelta(days=window_half)

    # "Fresh this cycle" = data arrived within the last window_half days
    has_current = last_run is not None and (today - last_run).days <= window_half

    if has_current:
        status = "FRESH"
    elif today < window_start:
        status = "WAITING"
    elif today <= window_end:
        status = "WINDOW_OPEN"
    else:
        status = "OVERDUE"

    age_days = (today - last_run).days if last_run else None
    return {
        "name": name,
        "lane": lane,
        "last_run": last_run,
        "age_days": age_days,
        "cadence_days": cadence,
        "threshold_days": window_half,
        "expected_date": expected,
        "status": status,
    }


# ── structural-gap detector ─────────────────────────────────────────────────
#
# Catches the gap class the cadence registry can't see: a city we capture
# city_pulse news for that has ZERO verified corridors in corridor_profiles, so
# the weekly corridor-pulse pipeline (get_corridors() filters verification_status
# = 'verified') never queries it and its signal never reaches cre-swfl → master.
# This is exactly how Lehigh Acres went unmonitored until found by hand.
#
# Surfaced into the same public.checks ledger the SessionStart kickoff + /littlebird
# render. Written DIRECTLY over the probe's existing Postgres connection because the
# freshness-probe runner carries only DESTINATION__POSTGRES__CREDENTIALS — no Supabase
# REST creds and no .dlt/secrets.toml — so it cannot shell out to scripts/check.mjs.

_GAP_PROJECT = "cre-swfl"
_GAP_PREFIX = "corridor_gap_"


def _slug(s: str) -> str:
    """Stable check_key suffix from a city name ('Lehigh Acres' → 'lehigh-acres')."""
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")


def check_structural_gaps(conn) -> list[str]:
    """Cities with city_pulse news but zero verified corridors. Join key is `city`
    on both tables (the city_pulse_corridors fact table has no city column)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT cp.city
            FROM data_lake.city_pulse cp
            WHERE NOT EXISTS (
              SELECT 1 FROM corridor_profiles pr
              WHERE pr.city = cp.city
                AND pr.verification_status = 'verified'
                AND pr.deleted_at IS NULL
            )
            ORDER BY 1
            """
        )
        return [r[0] for r in cur.fetchall()]


def sync_gap_checks(conn, gap_cities: list[str]) -> dict:
    """Reconcile auto gap checks with the current gap set: open new gaps, auto-close
    cleared ones. Idempotent; respects a human 'dropped' decision (deliberate
    no-corridor city) by never re-flagging it."""
    want = {f"{_GAP_PREFIX}{_slug(c)}": c for c in gap_cities}
    opened: list[str] = []
    closed: list[str] = []
    with conn.cursor() as cur:
        for key, city in want.items():
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
                        _GAP_PROJECT,
                        key,
                        f"Structural gap: {city} has city_pulse news but 0 verified corridors",
                        "Add a verified corridor_profiles row for "
                        f"{city} (corridor-pulse never queries a city with no verified "
                        "corridor), or close --drop if intentional. Auto-detected by the "
                        "daily freshness probe.",
                        1,
                    ),
                )
                opened.append(key)
            elif row[1] == "done":
                # Gap returned after a prior fix (e.g. corridor soft-deleted) — re-open.
                cur.execute(
                    "UPDATE public.checks SET state='open', resolved_at=NULL,"
                    " resolved_by=NULL, updated_at=now() WHERE id = %s",
                    (row[0],),
                )
                opened.append(key)
            # state in ('open','dropped') → leave as-is (open = already tracked;
            # dropped = human said this city is intentionally corridor-less).

        # Auto-close any open auto-gap check whose city is no longer a gap.
        cur.execute(
            "SELECT id, check_key FROM public.checks"
            " WHERE state='open' AND check_key LIKE %s",
            (_GAP_PREFIX + "%",),
        )
        for cid, key in cur.fetchall():
            if key not in want:
                cur.execute(
                    "UPDATE public.checks SET state='done', resolved_at=now(),"
                    " resolved_by='freshness-probe (auto)', updated_at=now()"
                    " WHERE id = %s",
                    (cid,),
                )
                closed.append(key)
    conn.commit()
    return {"opened": opened, "closed": closed}


# ── probe runner ──────────────────────────────────────────────────────────────

# Statuses that require no action and are excluded from the alert summary.
_SILENT_STATUSES = {"FRESH", "WAITING"}


def run_probe(conn, registry: dict) -> tuple[list[dict], list[dict]]:
    """Run all per-entry checks.

    Returns (pipeline_results, view_results):
      pipeline_results — one dict per pipeline entry (unchanged shape)
      view_results     — one dict per entry that declares a liveness_view
    """
    pipeline_results = []
    view_results = []
    for entry in registry.get("pipelines", []):
        lane = entry.get("lane", "")
        probe_mode = entry.get("probe_mode", "standard")
        if probe_mode == "odd_window":
            r = check_odd_window_entry(conn, entry)
        elif lane in ("tier-1", "tier-1-duckdb"):
            r = check_tier1_entry(conn, entry)
        elif lane == "tier-2":
            r = check_tier2_entry(conn, entry)
        else:
            continue
        vol = check_volume_entry(conn, entry)
        r["volume_status"] = vol["status"] if vol else None
        r["volume_landed"] = vol["landed"] if vol else None
        r["volume_min"] = vol["min_rows"] if vol else None
        pipeline_results.append(r)

        # View liveness — runs independently so a broken view never masks the
        # pipeline freshness result and vice versa.
        liveness_view = entry.get("liveness_view")
        if liveness_view:
            vr = check_view_liveness(liveness_view)
            vr["pipeline"] = entry["name"]
            view_results.append(vr)

    return pipeline_results, view_results


# ── output formatting ─────────────────────────────────────────────────────────

_STATUS_ICON = {
    "FRESH": "✅",
    "STALE": "⚠️",
    "MISSING": "❌",
    "WAITING": "⏳",
    "UNINITIALIZED": "—",
    "WINDOW_OPEN": "👀",
    "OVERDUE": "🚨",
}
_VOL_ICON = {"OK": "✅", "LOW_VOLUME": "⚠️"}


def format_summary(results: list[dict], run_date: date | None = None) -> str:
    today = run_date or date.today()
    header = f"## Pipeline Freshness Probe — {today}\n\n"

    alerting = [
        r for r in results
        if r["status"] not in _SILENT_STATUSES or r.get("volume_status") == "LOW_VOLUME"
    ]
    if not alerting:
        return header + "✅ All pipelines fresh and volume healthy.\n"

    lines = [
        "| Pipeline | Lane | Last Run | Age (days) | Cadence | Expected / Threshold | Status | Volume |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in alerting:
        icon = _STATUS_ICON.get(r["status"], r["status"])
        last_run = str(r["last_run"]) if r["last_run"] is not None else "—"
        age = str(r["age_days"]) if r["age_days"] is not None else "—"
        # ODD window entries show expected date + ±window; standard show threshold.
        if "expected_date" in r and r["expected_date"] is not None:
            threshold_col = f"expect {r['expected_date']} ±{r.get('threshold_days', 10)}d"
        else:
            threshold_col = f"{r.get('threshold_days', '—')}d"
        vol_status = r.get("volume_status")
        if vol_status == "LOW_VOLUME":
            vol_str = f"⚠️ {r['volume_landed']:,} / {r['volume_min']:,}"
        elif vol_status == "OK":
            vol_str = "✅"
        else:
            vol_str = "—"
        lines.append(
            f"| {r['name']} | {r['lane']} | {last_run} | {age}"
            f" | {r['cadence_days']}d | {threshold_col} | {icon} {r['status']} | {vol_str} |"
        )
    return header + "\n".join(lines) + "\n"


def format_view_liveness(view_results: list[dict], manifest: list[str]) -> str:
    """Render the view liveness section appended below the freshness table.

    Manifest is the full sorted list of registered liveness_views, surfaced here
    so a view rename (§08) shows up as VIEW_STALE in the next morning's summary.
    Only surfaces alerting results (VIEW_STALE) to keep the summary clean when
    all views are live; always shows the manifest so renames are visible.
    """
    if not manifest:
        return ""

    lines = ["\n### View liveness probe\n"]

    # Manifest block — all registered liveness_views, one per line.
    lines.append("**Registered views manifest:**\n")
    for v in manifest:
        lines.append(f"- `{v}`")
    lines.append("")

    if not view_results:
        lines.append("_(no view probes ran this cycle)_\n")
        return "\n".join(lines) + "\n"

    alerting = [vr for vr in view_results if vr["status"] != "VIEW_FRESH"]
    if not alerting:
        lines.append("✅ All probed views are live and returning rows.\n")
        return "\n".join(lines) + "\n"

    lines += [
        "⚠️ **VIEW_STALE — missing GRANT, renamed view, or not yet populated:**\n",
        "| View | Pipeline | HTTP | Detail |",
        "| --- | --- | --- | --- |",
    ]
    for vr in alerting:
        http = str(vr["http_status"]) if vr["http_status"] is not None else "—"
        lines.append(
            f"| `{vr['view']}` | {vr['pipeline']} | {http} | {vr['detail']} |"
        )
    lines.append("")
    return "\n".join(lines) + "\n"


def format_gaps(gaps: list[str] | None, sync: dict | None) -> str:
    """Render the structural-gap section appended below the freshness table."""
    if sync and "error" in sync:
        return (
            "\n### Structural corridor gaps\n\n"
            f"⚠️ gap check skipped: `{sync['error']}`\n"
        )
    if gaps is None:
        return ""
    if not gaps:
        return "\n### Structural corridor gaps\n\n✅ Every city_pulse city has a verified corridor.\n"
    lines = [
        "\n### Structural corridor gaps\n",
        "⚠️ **Cities with news but no verified corridor — opened in the checks ledger:**\n",
        "| City | Ledger check_key |",
        "| --- | --- |",
    ]
    for c in gaps:
        lines.append(f"| {c} | `{_GAP_PREFIX}{_slug(c)}` |")
    if sync:
        if sync.get("opened"):
            lines.append(f"\nopened: {', '.join(sync['opened'])}")
        if sync.get("closed"):
            lines.append(f"auto-closed (gap cleared): {', '.join(sync['closed'])}")
    return "\n".join(lines) + "\n"


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

    # Collect the views manifest before connecting (registry only, no DB needed).
    views_manifest = collect_views_manifest(registry)

    try:
        results, view_results = run_probe(conn, registry)
        # Structural-gap detector: own try so a gap-query error can never break the
        # freshness summary (probe must stay exit 0). Dry-run detects + displays but
        # never mutates the checks ledger.
        try:
            gaps = check_structural_gaps(conn)
            gap_sync = None if args.dry_run else sync_gap_checks(conn, gaps)
        except Exception as exc:  # noqa: BLE001 — observability, never gate
            gaps, gap_sync = None, {"error": str(exc)}
    finally:
        conn.close()

    summary = (
        format_summary(results)
        + format_view_liveness(view_results, views_manifest)
        + format_gaps(gaps, gap_sync)
    )

    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if args.dry_run or not step_summary:
        sys.stdout.buffer.write(summary.encode("utf-8"))
    else:
        with open(step_summary, "a", encoding="utf-8") as fh:
            fh.write(summary)

    return 0


if __name__ == "__main__":
    sys.exit(main())
