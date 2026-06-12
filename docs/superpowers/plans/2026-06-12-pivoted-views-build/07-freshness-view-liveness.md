# §07 — Freshness probe: per-view liveness

**Model:** Sonnet (additive, well-scoped extension of an existing probe)
**Gate:** none for the code — **fully parallel, start anytime** (this is the cleanest "§8 alongside 1-7"). Its end-to-end *green* check waits only on §02's view existing.
**Parallel with:** everything. **Blocks:** nothing.

## Why

Views don't inherit grants, and a dropped GRANT or a renamed view 404s silently on live reads (the R2 failure class). Extend the daily freshness probe so a missing/broken view is caught the next morning, not by a user.

## Build

- **Probe:** `ingest/scripts/check_freshness.py` (run by `.github/workflows/freshness-probe-daily.yml`, `cron: "0 14 * * *"`). It already loads `ingest/cadence_registry.yaml` and checks table/Parquet freshness.
- **Add** an optional `liveness_view:` field to the relevant `cadence_registry.yaml` entries, e.g.:
  ```yaml
  - name: zhvi_swfl_tier2
    ...
    liveness_view: data_lake.zhvi_zip_latest
  ```
- **Extend** `check_freshness.py`: for each entry with a `liveness_view`, run a `SELECT 1 FROM <view> LIMIT 1` **via the live PostgREST/REST path** (not psql — that's the surface that actually 404s when a GRANT is missing). On timeout / 404 / zero rows, log `VIEW_STALE` (non-gating observability, same as the rest of the probe).
- Keep a small **views manifest** (the set of `liveness_view`s) so a view rename that breaks vintage continuity (§08) is visible.

## Verification

- `python -m ingest.scripts.check_freshness --dry-run` then live.
- Drop the GRANT on a probed view in a scratch run → the probe surfaces `VIEW_STALE` / 404. Restore.
- A registry entry with no `liveness_view` is unaffected (backward-compatible).
- The `liveness_view` schema addition is reviewed against the existing `cadence_registry.yaml` shape before merge.
