# S1 — Freshness-Probe Resilience Handoff (2026-06-05)

**Dependency:** None — run in parallel with all other Sonnet tasks.
**Tier:** Sonnet (well-scoped, < 100 lines of change, test-covered).
**Open check to close:** `freeze_watchdog_parse_error_hardening` (related theme — fail-loud, don't blind).

---

## Goal

One missing or mis-named table must never crash the entire freshness probe again. Today every entry in
`ingest/cadence_registry.yaml` is checked in a bare loop in `run_probe` — one UndefinedTable exception
kills all 45 pipelines' status at once.

## Verified start point

**File:** `ingest/scripts/check_freshness.py`, function `run_probe` (~line 251).

```python
def run_probe(conn, registry: dict) -> list[dict]:
    results = []
    for entry in registry.get("pipelines", []):
        lane = entry.get("lane", "")
        if lane in ("tier-1", "tier-1-duckdb"):
            r = check_tier1_entry(conn, entry)   # ← no try/except
        elif lane == "tier-2":
            r = check_tier2_entry(conn, entry)   # ← no try/except
        else:
            continue
        vol = check_volume_entry(conn, entry)    # ← no try/except — this crashed the probe
        r["volume_status"] = vol["status"] if vol else None
        ...
```

The crash was: `psycopg.errors.UndefinedTable: relation "data_lake.noaa_ghcn_rainfall" does not exist at
check_freshness.py:153 (check_volume_entry)`. The `noaa_ghcn_rainfall` table didn't exist when the probe
ran. Table now has 6 rows (pipeline has since run) so the acute crash self-heals, but the fragility remains.

## The fix

Wrap the per-entry block in `run_probe` in `try/except`:

```python
for entry in registry.get("pipelines", []):
    try:
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
    except Exception as exc:
        results.append({
            "name": entry.get("name", "unknown"),
            "lane": entry.get("lane", ""),
            "status": "ERROR",
            "volume_status": "ERROR",
            "error": str(exc),
        })
```

Exit code stays 0; the output includes an ERROR row for that entry.

## Also investigate

`noaa_ghcn_rainfall` is in the active `pipelines:` section of `cadence_registry.yaml` with the comment
"First run: pending first GHA dispatch." The GHA has since run (6 rows exist). Confirm the GHA ran
successfully (check `noaa-ghcn-rainfall-monthly.yml` run history); if yes, update the stale comment.

LOW_VOLUME flag: `expected_rows_min: 8` (4 stations × 2 years), only 6 rows → LOW_VOLUME expected. This
is a data-completeness flag, not a code bug — note it in the ERROR output or a caveat but don't crash.

## TDD requirement

Add a test in `ingest/tests/scripts/` (or alongside the existing tests) with an entry pointing at a
nonexistent table → `run_probe` must return a list with one ERROR row, not raise.

## Verify

```sh
python -m ingest.scripts.check_freshness --dry-run   # must exit 0, noaa = FRESH or LOW_VOLUME
pytest ingest/tests/ -k freshness -v                 # new test passes
```

## Close these checks

- `freeze_watchdog_parse_error_hardening` — same fail-loud-don't-blind theme; confirm this fix addresses it
  or note residual scope (that check is about master frontmatter parse errors — adjacent but different file).
