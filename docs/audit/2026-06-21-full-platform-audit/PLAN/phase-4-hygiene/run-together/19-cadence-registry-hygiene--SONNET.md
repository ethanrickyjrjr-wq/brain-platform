# 19 — cadence-registry hygiene (retire dead CRE-broker ODD + rebaseline `expected_rows_min`)

**Model: Sonnet.** `ingest/cadence_registry.yaml` (+ dead pipeline dirs/ymls). **Priority: P3.**

## The defects (verified, from NOTES §4)
- **Dead CRE-broker ODD sources** (confirmed dead ends — no survey tables, stubs exit 1):
  `lee_associates_swfl`, `premier_commercial_swfl`, `svn_florida_swfl` (+ confirm the 4th the report counts —
  candidates: `estero_edc`, `fmb_recovery`). These sit in the ODD-window `not_yet_running:` / parked area
  but will never graduate. **Do NOT touch `crexi_listings`** (it's the active Crexi source, builds 11/12).
- **Placeholder `expected_rows_min` floors** — several are `1` (a meaningless floor that won't catch a
  near-empty pull).

## Steps
1. **Probe first.** Read `ingest/cadence_registry.yaml`; list every `expected_rows_min: 1` and every parked
   CRE-broker ODD entry. Confirm which broker stubs actually exit 1 / have no survey table (read the stub).
   Confirm the 4th dead source the report references.
2. **Retire the dead ODD sources:** remove their cadence entries; delete their pipeline dirs + GHA ymls
   (`ingest-lee-associates-swfl.yml`, etc.) IF nothing else references them (grep first). Leave a one-line
   note in the registry or SESSION_LOG that they were retired as confirmed-dead (provenance).
3. **Rebaseline floors:** set `expected_rows_min` to a real lower bound per source (a fraction of the
   typical row count), not `1`. Use the last good `_dlt_loads` count as the basis where available.

## Done when
- No `expected_rows_min: 1` placeholders remain (each has a justified floor); the dead CRE-broker entries +
   their ymls are gone with no dangling reference. `cadence_registry.yaml` still parses; no probe references
   a removed entry.

## Best-practice fold-in
Build 24 (freshness SLA) will add `warn_after`/`error_after` per-source entries to this same registry.
`expected_rows_min` is the **Volume pillar** complement to that freshness SLA: row-count vs expected is
the standard data-observability Volume check (see `round3/q-data-observability-pillars.md` REPORT row).
Rebaselining floors now (Step 3) means build 24 can pair each SLA with a real floor, not a placeholder `1`.

## Risk
Low. Removing dead-end sources + tightening floors. Verify no live consumer references the removed entries.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — not a crawl4ai build)
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round3/q-data-observability-pillars.md` (REPORT observability Volume row) — row-count vs expected is the Volume pillar
- `docs/audit/2026-06-21-best-practices-research/round2/data-dbt-source-freshness.md` — declarative per-source SLA (build 24 extends this registry with it)
**Verified:** confirmed the dead ODD entries + placeholder floors — folded into Steps above where applicable.
