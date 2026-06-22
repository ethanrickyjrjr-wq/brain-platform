# 03 — freshness-probe: honor "always exit 0" (guard the tier-1 crash path)

**Model: Sonnet.** Single file. **Priority: P1.**

## The defect (verified)
`ingest/scripts/check_freshness.py` docstring (line 26): *"Always exits 0 (probe is observability, not
gating)."* **That promise is false for tier-1.** `check_tier1_entry` (def ~273, query ~285-294) runs
`SELECT updated_at FROM data_lake._tier1_inventory …` with **no try/except** — a missing table raises
`psycopg.errors.UndefinedTable` (this is the `collier_parcels` crash that flapped the probe). `run_probe`
(~599, calls it ~614) is unguarded, and `main()` (~794) wraps `run_probe` in `try … finally: conn.close()`
with **no `except`**, so the exception propagates and `sys.exit(main())` (~824) never returns 0.

**Asymmetry the audit missed (don't over-fix):** the tier-2 path `_fetch_max_freshness` (~228-266) is
ALREADY try/except-guarded and returns `None` on a missing table. **Only the tier-1 path + the `main`
wrapper need guarding.**

## Steps
1. **Probe first.** Read `check_freshness.py` ~26, ~228-266 (the guarded tier-2 pattern to mirror), ~273-319
   (`check_tier1_entry`), ~599-620 (`run_probe`), ~790-824 (`main`).
2. Wrap the tier-1 query in `check_tier1_entry` in try/except (mirror `_fetch_max_freshness`): on
   `psycopg.errors.UndefinedTable` (or broad `Exception`) log a structured "table missing" line and treat
   that entry as stale/unknown — never raise.
3. Add an `except Exception` to `main()`'s try (keep the `finally: conn.close()`): log + `return 0` so the
   "always exit 0" contract holds even on an unexpected error. Also catch the historical `KeyError:
   dlt_schema_name` path (05-29 incident) the same way.

## Done when
- A local run against a connection where `_tier1_inventory` (or a referenced table) is missing **exits 0**
  with a logged "missing table" line — no traceback, no non-zero exit.

## Best-practice fold-in
Build 24 (freshness-as-ERROR SLA) will add `warn_after`/`error_after` thresholds to make load-bearing
sources loud on true staleness. This build is the prerequisite: the "always exit 0" observability contract
must hold first, or build 24's opt-in loud-fail becomes unreachable. Keep the exit-0 contract intact here;
build 24 adds the SLA layer on top.

## Risk
Low. Widens guards only; matches the existing tier-2 pattern. Don't silence a *real* stale signal — log it.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — not a crawl4ai build)
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round1/rootcause-sre-monitoring.md` (REPORT observability Freshness row) — alert on signal not noise; honor the always-exit-0 contract
- `docs/audit/2026-06-21-best-practices-research/round2/rootcause-sre-monitoring-workbook.md` — "144 alerts/day, act on none, still meet SLO"
- `docs/audit/2026-06-21-best-practices-research/round2/data-dbt-source-freshness.md` — the warn_after/error_after model build 24 will add
**Verified:** V-3 — guard ONLY tier-1 + main(); do NOT re-wrap the already-guarded tier-2 path — folded into Steps above where applicable.
