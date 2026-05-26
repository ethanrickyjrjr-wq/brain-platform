# Cosmic Rolling Brook — v2 SHIPPED archive (2026-05-18)

> **Status: shipped.** This is the historical archive of the v2 plan + a ship-status table mapping every lane to its commit. Preserved for future handoff context. The commits + brain `.md` files are the real artifact; this doc explains the intent behind them.
>
> **Working plan lived at** `~/.claude/plans/cosmic-rolling-brook.md` during execution. That path is outside the repo; this archive is the canonical in-repo copy.
>
> **Lifecycle**: v1 → cleanup (LittleBird premise-engine scope dropped) → v2 → shipped → this archive.

---

## Ship-status table

Every lane in the v2 plan maps to a commit. Tests at 348 / 0 fail post-Path B.

| Lane                                                            | Status      | Commit             | Notes                                                                                                                                                                                    |
| --------------------------------------------------------------- | ----------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wave 0.2 — FAF5 DDL version-controlled                          | ✅ shipped  | `7a89924`          | `docs/sql/data_lake_faf_flows.sql` with grants + indexes                                                                                                                                 |
| Wave 0.3 — `brain_registry.consumer_brains[]` verified deployed | ✅ verified | (no commit needed) | Strict-mode probe confirmed; column already shipped                                                                                                                                      |
| Lane 1A — Confidence math hard-cutover                          | ✅ shipped  | `7613a5e`          | Trust-tier-weighted mean headline; joint_integrity + confidence_dispersion + chain_depth as diagnostics                                                                                  |
| Lane 1B — Metric contract completion                            | ✅ shipped  | `75c25c5`          | variable_type + units + display_format + source promoted to required across all 12 packs                                                                                                 |
| Lane 1D — Smoothing-lint + shared token constant                | ✅ shipped  | `398e724`          | `refinery/lib/smoothing-tokens.mts` is single source of truth                                                                                                                            |
| Test sync fixes                                                 | ✅ shipped  | `d006de3`          | env-swfl + properties-lee-value source counts realigned with shipped pack defs                                                                                                           |
| Lane 2C — Consumption contract v2                               | ✅ shipped  | `ce4bacf`          | Rigid 6-section template + §1.5 anti-confabulation rule + v1.2 preservation (all 4 mechanisms preserved verbatim)                                                                        |
| Lane 2E — Stale-upstream cascade (cross-cutting DAG)            | ✅ shipped  | `5ce52f8`          | CLAUDE.md non-neg #5 implemented; was aspirational comment-only before this lane                                                                                                         |
| Lane 2D — `logistics-swfl-nowcast` (13th pack)                  | ✅ shipped  | `297ad23`          | Initial v1 ship; superseded by Path B math refactor — see below                                                                                                                          |
| Wave 5 — Vocab gap fix                                          | ✅ shipped  | `ade2485`          | Caught by master rebuild; 9 nowcast concepts + slug_aliases added; full DAG rebuilds clean                                                                                               |
| Lane 2D **Path B refactor** — math correction                   | ✅ shipped  | `35b9945`          | Reframed nowcast as FDOT-vs-FDOT-history (not FDOT-vs-FAF5). Dropped × miles factor. Added cold-start gate at 90d. Metric renames + 3 new metrics. FAF5 stays as rendering context only. |

**Pack count: 12 → 13.** **Test count: ~292 baseline → 348 pass / 0 fail.**

---

## What changed during execution vs the plan

1. **Pack count is 12, not 14.** The plan estimated "14 packs" in multiple places. Actual count via `Object.keys(PACKS)` is 12 (10 in `refinery/packs/*.mts` + 2 legacy in `refinery/config/packs.mts`). Lanes 1A + 1B both flagged and resolved.
2. **Lane 2C blueprint α added §1.5 anti-confabulation rule.** User contribution during blueprint review: "NEVER fill a `(none)` section with inferred content." Locked as a first-class non-negotiable rule in the contract.
3. **Lane 2E split out from Lane 2D.** Both 2D blueprint agents independently discovered that CLAUDE.md non-negotiable #5 (stale-upstream auto-caveat) was comment-only — never implemented. Promoted to its own atomic lane (2E) with first-class tests rather than burying inside 2D. Shipped BEFORE 2D so the new downstream brain launched with engine live.
4. **Path B math refactor for Lane 2D.** v1 of 2D shipped FDOT-AADT-derived "ton-miles" being compared via z-score to FAF5 "tons" — dimensionally and population-wise mismatched. Wave 5 surface-walk caught it. Path B reframed: compute deviation against FDOT's OWN rolling history (using the shock_log table the v1 already maintained). FAF5 kept in OUTPUT as rendering context with explicit two-sentence framing.
5. **Vocab gap caught only at master rebuild.** Lane 2D's pack tests passed in isolation but Wave 5 master rebuild failed at Stage 2.5 normalize. Vocab-coverage helper added (`refinery/lib/vocab-coverage.mts`) so future packs catch this at pack-test time.

## Known gaps at archive time

These ship as known follow-ups rather than blocking issues:

1. ~~**Shock-log writer not implemented.**~~ **CLOSED — Lane 2D.1.** The shock-log writer ships in `fdot-freight-source.mts::writeShockLogRow` (co-located with the reader), called from Stage 4 immediately after `logPrediction`. Fixture mode is a silent no-op; insert errors are caught and logged so a write failure can never abort a brain render. End-to-end pipeline test (95-run loop with an in-memory accumulator) proves the cold-start transition closes correctly at the 90-day threshold. Test count: 349 → 359.
2. **Lane 2D's two new soft constants** documented in `refinery/sources/fdot-freight-source.mts`:
   - `BASELINE_COEFFICIENT_OF_VARIATION = 0.10` (no longer used post-Path B — math is now rolling sigma; consider removing)
   - `SHOCK_LOG_PULL_COUNT = 120` (operational margin over the 90-day rolling window; cited inline)
3. **Pre-existing TypeScript noise** in `smoothing-tokens.test.mts`, `properties-lee-value.mts`, `bls-qcew-source.mts`, `usgs-water-source.mts`. Not introduced by this session; flagged across multiple subagent reports.
4. **Manual smoke tests for consumption contract v2 + Handoff Protocol + `MY DATA:` paste pattern** require a human in a real Claude Project. Not automatable. Server-side validation is done.

## Decisions closed at v2 exit (unchanged from plan)

1. **No brand decision this sprint.** Defer until brain-platform has a UI surface. Consumption contract uses "the brain" / "your audited baseline" placeholder language. (At session-write time, "Plumbline" and "Keystone" were working candidates and both unavailable on primary TLDs; project later locked to **SWFL Data Gulf** on 2026-05-26.)
2. **No broker evidence schema.** User-supplied ground truth handled entirely via the in-conversation `MY DATA:` paste pattern (consumption contract §User-Supplied Data). Full broker ingestion belongs in premise-engine if/when it's needed there.
3. **No polygon work.** Custom polygons are not in brain-platform's mission. Spatial brains continue to read pre-aggregated server-side views; spatial intersection UX lives in premise-engine.

## What the plan killed (v1 → v2 cleanup)

For full context on the v1 → v2 cleanup that dropped premise-engine scope, see the original plan body that follows. Highlights:

- Wave 0.1 (geometry DDL) — KILLED; tables don't exist, only Wave 2A would have needed them
- Wave 0.4 (brand WHOIS — "Plumbline" working candidate at the time) — KILLED; no UI surface for brand
- Lane 1C (render sidecar hook) — KILLED; only consumer was Wave 2A polygons
- Wave 2A (custom polygon spatial) — KILLED; violates "Dashboard only — no maps, no 3D, no heavy viz libs"
- Wave 2B (user-evidence broker ingestion) — KILLED; premise-engine concern
- Wave 4 entirely (brand React/Sanity, UI jargon lint, Sources drawer, Handoff UX copy) — KILLED; no UI exists
- Wave 5 manual UI tests (broker reads brand aloud, polygon demo, jargon sweep, empty-state matrix) — KILLED; no UI

---

# ORIGINAL PLAN BODY (v2, frozen at execution start)

The text below is the v2 working plan as it stood when execution began. Frozen for historical reference. Where the plan says "FIXME / TBD" or anticipates uncertainty, the ship-status table above records what actually happened.

---

## Context

Three system-level gaps surfaced by pre-flight audit (still valid for v2):

1. **Confidence is multiplicative-by-default.** `refinery/lib/confidence.mts:99` did `self × avg(upstream_confidences)`. Switching to trust-tier-weighted mean moved the headline number for every existing brain. Required before/after calibration report.
2. **`data_lake.faf_flows` DDL not version-controlled.** Wave 0.2 dumped it to `docs/sql/data_lake_faf_flows.sql` — DONE.
3. **`confidence_calibration` table already exists** (per `docs/sql/20260516_base_tables_source_and_outcomes.sql`), scoped as adaptive trust-tier SGD loop.

Locked decisions:

- **Confidence:** hard cutover headline to trust-tier-weighted mean; preserve multiplicative math as the `joint_integrity` diagnostic field; delta report attached to PR
- **User-supplied ground truth:** handled entirely via the in-conversation `MY DATA:` paste pattern documented in the consumption contract (zero infra). Broker evidence ingestion is a premise-engine concern, not brain-platform.

Intended outcome: trust math is mathematically defensible AND emits diagnostic fields; consumption contract gates Claude's smoothing AND teaches it to recognize user-supplied data; FDOT freight-nowcast pack lands as the second derivation brain.

## Wave 1 — Foundation

Lanes 1A / 1D run in parallel; Lane 1B starts after 1A merges. Each lane is one atomic PR.

(For full lane-by-lane detail with tasks/files/tests, see the original `~/.claude/plans/cosmic-rolling-brook.md` working copy. Trimmed here to keep the archive focused on intent and ship status.)

## Wave 2 — Competing Blueprints (parallel Plan agents per lane)

- Lane 2C: rigid templated sections (α) vs conditional rendering (β). **Picked α.** Strict-mode rendering makes silent §Receipts skip structurally impossible.
- Lane 2D: net-new thin-pipe pack (α) vs branch inside logistics-swfl (β). **Picked α.** β's freshness-token roof was the killer — single freshness clock can't honor two cadences (annual FAF5 + daily FDOT).

## Wave 5 — Calibration + Verification (server-side only)

- ✅ Re-run all 12 packs through new confidence formula (delta report inline with Lane 1A)
- ✅ Regression test all existing brain `.md` files against new spec-validator
- ⏳ Smoke-test consumption contract v2 (REQUIRES HUMAN — fresh Claude session, paste contract, ask 3 known queries)
- ⏳ Manual Handoff demo (REQUIRES HUMAN — verify two-beat script + §Speculation routing + `MY DATA:` paste pattern)
- ✅ FDOT nowcast smoke test (Lane 2D scenario tests + Path B refactor verifies cold-start path)

## Decisions Closed at v2 Exit

See "Decisions closed at v2 exit" section above.
