# Storm-History-SWFL Replan Handoff (2026-05-19)

**Read this FIRST in the new session.** Then enter plan mode and walk the user through Option A / B / C below.

> **For the new session's agent:** the previous session burned a lot of tokens on a credentials saga and dispatched a single Opus subagent that built the storm-history-swfl pack without the user reviewing the design decisions. The user pulled the brake. Don't repeat the mistake — the work to plan is the **pack design** (Task 9), not the infrastructure. Infrastructure is solid.

---

## TL;DR

- **Infrastructure (Tasks 1–8) is good.** DuckDB-on-Parquet Tier 1 layer works end-to-end: smoke test passed, `_tier1_inventory` table exists with audit row, NOAA ingest ran (1,178 rows written to `s3://lake-tier1/environmental/storm_events_swfl.parquet`), TS `DuckDBParquetSource` connector works against fixture and live Parquet, 7+3 tests green.
- **Pack design (Task 9 — commit `2beff0a`) is questionable.** The subagent made 7 judgment calls in isolation. They might be right; they were never reviewed.
- **Task 13 (final wrap-up) is pending and trivial** — `.gitignore` add, commit the spec+plan docs. Don't do this until pack design is resolved.
- **You are entering plan mode to walk the user through Option A / B / C** for the pack.

---

## Where everything lives

### Spec + plan (now tracked — committed with this handoff)

- `docs/superpowers/specs/2026-05-18-duckdb-parquet-query-layer-design.md` — the original spec. **Subject to revision.** The pack-design section is what the user wants to re-open.
- `docs/superpowers/plans/2026-05-18-duckdb-parquet-query-layer.md` — the executable plan that ran. Tasks 1–12 are done; Task 13 is pending. Read it for the original intent vs. what shipped.

### What got built (per stage)

| Stage                                | Files                                                                                                                                                                   | Commits                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Python ingest pipeline (DuckDB→S3)   | `ingest/duckdb_pipelines/storm_history_swfl/{pipeline,constants}.py`                                                                                                    | `007ae1b`, `4ebb80f`, `db6d743`            |
| Inventory audit table + helper       | `docs/sql/tier1_inventory.sql`, `ingest/lib/tier1_inventory.py`, `ingest/tests/lib/test_tier1_inventory.py`                                                             | `8b132a0`                                  |
| Smoke test (Q1 gate)                 | `scripts/duckdb_s3_smoke_test.py`                                                                                                                                       | `fb30be4`                                  |
| Fixture build script                 | `scripts/build_storm_history_fixture.py`                                                                                                                                | `1c62235`                                  |
| Fixture Parquet (91 rows, 2022–2024) | `refinery/__fixtures__/storm-history-swfl.sample.parquet`                                                                                                               | `1c62235`                                  |
| TS SDK                               | `@duckdb/node-api` dependency in `package.json`                                                                                                                         | `d2ab8ad`                                  |
| TS source connector                  | `refinery/sources/storm-history-source.mts` + `.test.mts`                                                                                                               | `e8c5cbb`                                  |
| Pack + vocab + first live render     | `refinery/packs/storm-history-swfl.mts` + `.test.mts`, `refinery/packs/index.mts`, `refinery/vocab/brain-vocabulary.json` (+8 concepts), `brains/storm-history-swfl.md` | **`2beff0a` ← the design-decision commit** |

### Working-tree dirt (NOT mine, NOT to be touched without asking)

```
modified:   docs/orphan-triage.md          ← auto-regenerated; ignore
modified:   ingest/.dlt/config.toml         ← from a different sprint
modified:   ingest/pipelines/fema/resources.py  ← from a different sprint
Untracked:  .dlt/                           ← repo-root local dlt state
```

### Brain-platform S3 credentials live in `.env.local` (gitignored)

- `SUPABASE_S3_ENDPOINT=https://jtkdowmrjaxfvwmemxso.supabase.co/storage/v1/s3`
- `SUPABASE_S3_ACCESS_KEY_ID=89721c0aa84039b93c5bafda3e8eb78a`
- `SUPABASE_S3_SECRET_ACCESS_KEY=cde6581ec8af0af6e30946fd582b9f5fe115d78b1e1427bc91b36232dd81b0ee`
- **These ended up in the transcript of the previous session — recommend rotation when convenient.** Not blocking.

---

## Architecture: dlt vs DuckDB pipelines (what's where and why)

Two pipeline families now live under `ingest/`. They are deliberately separate:

### Family 1: `ingest/pipelines/*` — **dlt-based, writes Tier 2 Postgres**

- Library: `dlt[postgres]` (data load tool)
- Pattern: `pipeline.py` builds a `dlt.pipeline(destination="postgres", dataset_name="data_lake")` and calls `pipeline.run(resource())`
- Members today: `census_cbp`, `fdot`, `fema`, `fhfa`, `leepa`, `bls_qcew`, `faf5`, `usgs`
- Tier 2 target: `data_lake.<dataset_name>` Postgres tables
- Some also write a Tier 1 pointer (e.g., `fema/resources.py` calls `write_tier1_pointer`)
- Helpers: `ingest/lib/{arcgis_paginator,geo_utils,storage_uploader}.py`
- Tests: `ingest/tests/pipelines/*`
- Runs via npm: `ingest:cbp`, `ingest:fema`, `ingest:leepa`, `ingest:fdot` — note these use `cd ingest && python -m pipelines.<name>.pipeline`

### Family 2: `ingest/duckdb_pipelines/*` — **DuckDB-based, writes Tier 1 Parquet only** (NEW)

- Library: raw `duckdb` Python + `requests`, NO dlt
- Pattern: open a `duckdb.connect()`, INSTALL httpfs + LOAD httpfs + SET s3\_\*, then `COPY (SELECT ...) TO 's3://lake-tier1/<path>.parquet'`
- Members today: `storm_history_swfl` (the only one; this is the pilot)
- Tier 1 target: `s3://lake-tier1/<domain>/<table>.parquet` (Supabase Storage S3-compatible API)
- Inventory: every run upserts a row into `data_lake._tier1_inventory` via `ingest/lib/tier1_inventory.py` (psycopg, NOT dlt — it just needs to insert one row)
- Runs via npm: `ingest:storm-history-swfl` — note this runs FROM REPO ROOT: `python -m ingest.duckdb_pipelines.storm_history_swfl.pipeline` (the family-1 `cd ingest && ...` pattern breaks family 2's absolute imports)
- **Why a new family**: dlt is great for "land raw JSON in Postgres tables." It's the wrong shape for "transform CSV→Parquet at ingest time and store in object storage." DuckDB does CSV+Parquet+S3 natively; using dlt as a middleman would add overhead with no benefit. Data Tier Policy rule 1: Tier 1 storage = $0.021/GB/mo, Tier 2 Postgres = $0.125/GB/mo — for speculative archival data with no consuming brain, Tier 1 is correct.

### How the new family is consumed by a brain

- TS source connector pattern: `refinery/sources/storm-history-source.mts` (uses `@duckdb/node-api` v1.5.2-r.2 — already a dependency)
- The connector reads the Parquet either from local fixture (`REFINERY_SOURCE=fixture`) or from `s3://` via DuckDB httpfs (`REFINERY_SOURCE=live`)
- The source pre-aggregates raw rows into per-county totals + corpus summary BEFORE returning RawFragments — so the pack is a pure reader of distilled aggregates (no per-row work in the pack)
- This is the new template for any future Tier-1-Parquet-backed brain.

---

## The 7 design decisions in commit `2beff0a` that the user wants to re-open

> File to read first: `refinery/packs/storm-history-swfl.mts` (lines 36–37, 90–96, 200–209, 280–296, 358–373). And the live brain output at `brains/storm-history-swfl.md`.

| #      | Decision in code                 | What was hardcoded                                                                                                                                                                                     | What the user might want instead                                                                                                                                                                                                      |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | Direction rule                   | `bearish if swflExtremeWindEvents10yr >= 3, neutral otherwise` (`EXTREME_WIND_BEARISH_THRESHOLD = 3`, line 37)                                                                                         | Maybe `bearish if last_billion_dollar_event within 5yr`. Or "no direction at all — pure-info brain that never votes in synthesis." Or a threshold pinned to actual Ian/Charley dates. The number `3` has no analytical justification. |
| **D2** | Magnitude                        | `0.5 if bearish, 0.2 if neutral` (line 207)                                                                                                                                                            | Is this brain supposed to vote in master synthesis at all? Risk-history is descriptive, not predictive. Could justify magnitude 0 always + caveats.                                                                                   |
| **D3** | Metric list (8 metrics)          | property*damage_events_10yr, extreme_wind_events_10yr, major_storm_count_30yr, total_storm_count_30yr, last_billion_dollar_event*{date,type}, counties_covered, ingest_vintage                         | Which of these actually serve a downstream brain or a customer question? The spec was loosely scoped here — subagent picked. Consider trimming to 3–4.                                                                                |
| **D4** | Vocab namespace + 8 new concepts | All `env_storm_*` prefixed; added to `refinery/vocab/brain-vocabulary.json`                                                                                                                            | Should `storm` live under `env_` or get its own top-level (`hazard_`, `risk_`)? Setting a precedent.                                                                                                                                  |
| **D5** | Upstream wiring                  | `input_brains: []` — leaf brain                                                                                                                                                                        | Should this feed `env-swfl` as a typed DAG upstream **in this PR**, or follow-up? env-swfl is the consumer who actually cares about historical storm activity.                                                                        |
| **D6** | Bearish framing                  | Treats high storm activity as "bearish" on a financial direction axis                                                                                                                                  | This is a hazard brain. The financial framing may be wrong domain — risk-history doesn't inherently move prices the way demand or supply does. Maybe direction should be `neutral` always with the storm intensity in caveats.        |
| **D7** | Fixture content                  | 91 rows, 2022–2024; spec claimed it contained Hurricane Ian (2022-09-28). It does NOT. Max event in fixture is a 10M Tornado on 2022-01-16. Live mode surfaces Hurricane Charley (2004-08-13) instead. | Rebuild fixture to actually contain Ian (re-run `scripts/build_storm_history_fixture.py` with a wider window or different year range), or document the discrepancy and adjust spec narrative.                                         |

---

## Plan of attack for the new session

When the new session starts, the user wants you to enter plan mode. Walk them through:

### Option A — **Replan the pack properly (recommended)**

1. `git revert 2beff0a` — surgically removes pack + vocab + brain file; keeps source connector (`e8c5cbb`) and all infrastructure
2. Open plan mode and ask the user the 7 D-questions above, one at a time
3. Rebuild the pack file based on user's answers (TDD: one test per metric, one for direction rule)
4. Re-render fixture + live brain
5. Task 13 wrap-up: `.gitignore` + final commit
   - **Honest cost**: the source connector currently exports `StormPerCountyAggregate` + `StormCorpusSummary` types shaped to match the deleted pack's expectations. If the answers to D3 change the metric list significantly, the connector's aggregation may need to change too — re-read `refinery/sources/storm-history-source.mts` before assuming the revert is clean.

### Option B — **Lock as v0.1 draft, defer redesign**

1. Edit `refinery/packs/storm-history-swfl.mts` to mark the pack as `synthesisStrategy: "deterministic"` (already is) AND tag the conclusion + magnitude as v0.1 draft in the caveats
2. Set `magnitude: 0` so it doesn't influence master synthesis until reviewed
3. Task 13 wrap-up
4. Schedule a redesign session

### Option C — **Patch the worst, accept the rest**

1. Edit only D1 (direction rule) and D7 (rebuild fixture to include Ian) — the two clearly-wrong items
2. Accept D2–D6 as subagent's call
3. Task 13 wrap-up

The user already heard A/B/C in the previous session and leaned toward A (explicit quote: "that's what stop doing what LB does actually looks like in practice"). Confirm with them.

---

## Task 13 (final wrap-up — when whichever option is done)

From the plan, verbatim:

- [ ] Add `.brain-cache/` to `.gitignore` (the spec mentions a local cache dir — verify it actually got created, may be unneeded)
- [ ] Verify final commits are clean
- [ ] Final summary commit (no more code; just a wrap-up message)
- [ ] **Recommend the user rotate the brain-platform S3 keys** (they're in the transcript of the previous session)

---

## Memory pointers worth re-reading in the new session

These memory files are already loaded via `MEMORY.md` but worth flagging:

- `feedback_pre-build-state-check.md` — three-source verify before trusting any plan doc
- `feedback_inherited-plan-skepticism.md` — exactly the framing for this handoff
- `feedback_data-tier-policy.md` — the 5-rule policy the new Tier 1 architecture has to respect
- `project_dlt-faf5-pipeline.md` — for context on how dlt-family pipelines are structured

---

## What the previous session FAILED at (so the new session doesn't repeat it)

1. **Planning failure**: Wrote spec + plan based on simplified mental model of `SourceConnector` and `PackDefinition`. Should have read `refinery/types/pack.mts` and an existing pack (`traffic-swfl.mts`) BEFORE writing the spec. Both files have more fields and stricter shapes than the spec assumed.
2. **Delegation failure**: Dispatched a single Opus subagent with 600 words of instructions to build source + pack + wiring in one shot. Subagent did the work competently but made 7 design judgment calls that should have been the user's. The subagent itself flagged some of these as concerns; I didn't escalate them — I marked the tasks complete and moved on.
3. **Credentials failure**: Wasted ~2 hours on a chase where the `.env.local` had the wrong Supabase project's credentials (LB had given the user the wrong project's keys while filling something out). Multiple symptoms: 403 from S3, mismatched buckets, the user editing `.env` while I was reading `.env.local`. Lesson encoded for future sessions: when a credential debug spans more than 3 exchanges, stop guessing and ask the user to paste the FULL value from disk via `cat` / `Read`, not retype it.

---

## You should NOT, in the new session

- Re-run the smoke test, re-run the NOAA ingest, or re-render unless the user asks. The Parquet exists and the inventory row is valid.
- Touch the dlt config or the fema resources.py uncommitted diffs — they're from a different sprint and out of scope.
- Commit the `.dlt/` untracked dir at repo root — that's local working state.
- Dispatch a subagent for the redesign. The redesign is a conversation with the user, not a delegatable task.
- Assume any of the 7 design decisions in `2beff0a` are correct. They are open questions.
