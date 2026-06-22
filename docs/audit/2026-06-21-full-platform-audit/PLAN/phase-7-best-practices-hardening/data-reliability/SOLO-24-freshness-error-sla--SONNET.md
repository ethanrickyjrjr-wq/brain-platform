# 24 — freshness as an SLA that can ERROR (per-source warn_after / error_after)

**Model: Sonnet.** Single-file extension to `check_freshness.py` + opt-in fields in
`cadence_registry.yaml`; the logic is additive and the scope is precisely bounded. **Priority: P2.**
Source detail: REPORT P2 #7 — "Make freshness an SLA that can ERROR (per-source
`warn_after`/`error_after`), not observability-only."

## The gap (verified)

`ingest/scripts/check_freshness.py` is hardcoded observability-only. The module docstring says it
explicitly (line 26): _"Always exits 0 (probe is observability, not gating)."_ Every code path that
could fail — DB connection failure (`main` line 789), `run_probe` errors, structural-gap errors — is
swallowed and returns 0. There is no mechanism to translate a STALE/MISSING result into a non-zero
exit even for load-bearing sources whose staleness produces a broken downstream (e.g. master
HOLD, broken MCP response).

`ingest/cadence_registry.yaml` has no per-source `warn_after` / `error_after` fields. Every entry
carries `cadence_days` + `tolerance_multiplier`, which set the STALE threshold for display — but no
field opts a source into "fail the GHA step when past this threshold."

**The authoritative model (dbt source freshness):** `warn_after: {count, period}` +
`error_after: {count, period}` are per-source, opt-in fields. A source with neither declared is
observability-only. A source that declares `error_after` causes `dbt source freshness` to exit
non-zero when the threshold is breached, which gates the downstream job. The `loaded_at_field`
points to the timestamp column — our equivalent is the `freshness_column` / `freshness_table`
pattern already in every registry entry.

**The SRE discipline (REPORT headline + round2 `rootcause-sre-monitoring-workbook`):**
_"You could receive 144 alerts/day, act on none, and still meet the SLO."_ The anti-pattern is
alerting (or failing) on every STALE regardless of impact. The fix is **alert on signal, not
noise**: fail loud ONLY for a source whose staleness is itself a production defect — not as a
blanket policy.

**Consequence:** today a load-bearing source can be MISSING for days and `check_freshness.py`
exits 0, the GHA step shows green, and no downstream CI gate ever fires. The only signal is
a human reading the $GITHUB_STEP_SUMMARY table.

## Steps

1. **Probe first (RULE 0.5).** Before writing a line:
   - Read `ingest/scripts/check_freshness.py` in full — confirm the exit-0 contract (line 26
     docstring, line 789 `return 0`, `main` final `return 0`); locate `run_probe` return shape
     (each result dict has `status`, `name`, `lane`); confirm `_SILENT_STATUSES` set; confirm
     `format_summary` alerting filter.
   - Read `ingest/cadence_registry.yaml` — pick 2–3 load-bearing candidates for the pilot (e.g.
     `live_search_daily_median_price` cadence 1d, `master` rebuild, or the tier-2 entries that
     feed master directly); confirm their existing `cadence_days` + `tolerance_multiplier` values.
   - Verify build 03 is present and understand its guard contract (it must keep all ungated sources
     at exit 0 — this build MUST NOT undo that).

2. **RULE 3.5 brainstorm (short).** Before coding, decide:
   - **Field shape:** `freshness_sla: {warn_after_days: N, error_after_days: N}` as an optional
     block per registry entry, mirroring dbt's `warn_after`/`error_after` shape but in days
     (matching our existing `cadence_days` unit). Absent = observability-only (no behavior change).
   - **Exit-code semantics:** `warn_after_days` → log `WARN_SLA` but exit 0 (consistent with
     build 03's non-gating contract for soft alerts). `error_after_days` → exit 1 ONLY when at
     least one opted-in source breaches its error threshold. Ungated sources never change exit code.
   - **Pilot scope:** start with 2–3 sources maximum. Conservative thresholds: `error_after_days`
     set well past TTL (e.g. 2× `cadence_days`) so only genuinely dead sources trigger it, not
     transient overnight delays. The pilot list is the spec decision; document it in the registry
     comment.
   - **GHA wiring:** the daily freshness probe GHA step currently ignores exit code (probe is
     observability). After this build, only the SLA-opted-in sources gate the step — ungated
     sources keep their always-exit-0 contract (build 03 invariant).

3. **Extend `cadence_registry.yaml`** — add `freshness_sla:` block (opt-in, entirely absent from
   all existing entries until explicitly added) to 2–3 pilot sources. Example shape:
   ```yaml
   freshness_sla:
     warn_after_days: 2    # log WARN_SLA; exit 0
     error_after_days: 4   # exit 1; well past the 1.5× tolerance threshold
   ```
   Add a schema comment block above `pipelines:` documenting the new field (same style as the
   existing schema comment block at the top of the file).

4. **Extend `check_freshness.py`** — additive only, no existing logic removed:
   - In `run_probe` (or a new `check_sla_violations` helper), after collecting all results, scan
     for entries that declare `freshness_sla.error_after_days` AND have `age_days` exceeding that
     threshold. Accumulate into an `sla_errors: list[str]` list.
   - Similarly accumulate `sla_warns` for `warn_after_days` breaches (display only, no exit change).
   - In `format_summary`, surface SLA violations as a separate section above the freshness table
     (so they are the first thing a human reads in $GITHUB_STEP_SUMMARY). Mark with a distinct
     icon (`🔴 SLA ERROR` / `🟡 SLA WARN`).
   - In `main`, after writing the summary, check `sla_errors`: if non-empty, `return 1`. The
     existing `return 0` stays for all runs with zero opted-in errors. The DB-connection-failure
     path stays `return 0` (build 03 invariant: a broken probe must never gate CI on its own
     failure).
   - Add a `--sla-dry-run` flag (or reuse `--dry-run`) that prints SLA violations to stdout but
     does NOT change the exit code — useful for local testing without breaking CI.

5. **Unit tests** — add a small test (inline or in `ingest/tests/`) covering: (a) a result dict
   with `age_days=5`, `freshness_sla: {error_after_days: 4}` → exit 1; (b) same dict without
   `freshness_sla` → exit 0; (c) `warn_after_days` only → exit 0 + WARN in summary. Run with
   `python -m pytest ingest/tests/test_check_freshness_sla.py` (or equivalent) before pushing.

## Done when

- `python ingest/scripts/check_freshness.py --dry-run` on a registry with NO `freshness_sla`
  entries exits 0 and produces no SLA section in the summary — ungated behavior is byte-identical.
- A synthetic registry entry with `freshness_sla: {error_after_days: 1}` and a known-stale source
  causes `check_freshness.py` to exit 1 and print `🔴 SLA ERROR` in the summary.
- `warn_after_days` breach → output shows `🟡 SLA WARN`, exit is still 0.
- Unit tests pass: `python -m pytest ingest/tests/test_check_freshness_sla.py -v`.
- The 2–3 pilot registry entries are committed with conservative `error_after_days` (≥ 2×
  `cadence_days`) so the gate does not fire on transient overnight delays.
- Build 03's always-exit-0 contract for ungated sources is verified unchanged (run the existing
  probe test suite / smoke; confirm exit 0 on a clean registry).

## Risk

Low-to-medium. The change is entirely additive: new optional YAML fields, new exit-code logic that
only fires when a source opts in, and a new summary section. The risk surface is:

- **Accidental gate on ungated sources** — mitigated by the opt-in design (absent `freshness_sla`
  = no behavior change) and the unit test for the no-SLA path.
- **Overly tight pilot thresholds** → false-positive exit 1 on a temporary pipeline outage →
  downstream GHA jobs blocked unnecessarily. Mitigated by the conservative `error_after_days`
  rule (≥ 2× `cadence_days`), start with 2–3 sources only.
- **Build 03 contract regression** — the DB-connection-failure path must stay `return 0`; the
  probe's own failure must not gate CI. Verified by the unit test suite and the `--dry-run` smoke.

**Serializes AFTER build 03** (the always-exit-0 guard for ungated sources must be in place before
adding any exit-1 path) **AND build 19** (cadence_registry hygiene — the registry must be clean
before adding SLA fields to it). Shares both files with 03 and 19; coordinate on merge order.

**Architecture guardrail (RULE 3 C2):** this is a DATA-PIPELINE build. It EXTENDS the existing
`check_freshness.py` / `cadence_registry.yaml` seam with an opt-in per-source field. It does NOT
erect a new mandatory gate that every source must pass — ungated sources are untouched. The
"loud-fail where explicitly opted in, silent elsewhere" design is the direct analog of dbt's
`freshness: null` escape hatch.

## References (added 2026-06-22)

**best-practices-research (docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round2/data-dbt-source-freshness.md` —
  `warn_after`/`error_after` + `loaded_at_field` model; opt-in per-source; `freshness: null` to
  unset; this is the direct authoritative pattern for what we're building
- `docs/audit/2026-06-21-best-practices-research/round1/rootcause-sre-monitoring.md` — alert on
  signal not noise; "144 alerts/day, act on none, still meet SLO" is the anti-pattern this build
  avoids by requiring explicit opt-in + conservative thresholds
- `docs/audit/2026-06-21-best-practices-research/round2/rootcause-sre-monitoring-workbook.md` —
  error budget framing; only breach-of-SLA events warrant a loud failure
- `docs/audit/2026-06-21-best-practices-research/round3/q-data-observability-pillars.md` —
  Freshness is pillar 1 of 5; the REPORT Freshness row verdict: "⚠️ we have freshness but no
  WARN/ERROR SLA that can fail loud"

**crawl4ai-live (docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — data-reliability build)

**Ties to existing builds:** build 03 (the always-exit-0 guard for ungated sources — MUST sequence
before this build; this build adds exit-1 only on top of build 03's contract), build 19 (cadence
registry hygiene — clean registry before adding SLA fields), build 25 (Quality/Schema pillars —
the next observability pillar after Freshness)
