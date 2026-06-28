# Incremental ingest: dlt cursors + per-source replace/merge audit

**Date:** 2026-06-28
**Status:** DESIGN — approved in brainstorming, pre-implementation. Next: writing-plans.
**Build slug / check:** `incremental-ingest` / `incremental_ingest_live_verify`.
**Parent / sibling specs:**
- `docs/superpowers/specs/2026-06-28-focus-restructure/03-incremental-ingest.md` (the problem brief — this doc is its execution design)
- `docs/superpowers/specs/2026-06-28-repo-focus-restructure-analysis.md` (root analysis)

**One line:** Prove the dlt-incremental + pre-land-validation pattern end-to-end on ONE reference
pipeline (Lee permits), make the scaffold incremental-aware, and ship a classification map for the
rest. Per-source — snapshot sources keep `replace`, on purpose.

---

## 0. Why this, and why NOT dbt (settles the originating question)

This work was triggered by the proposal to adopt **dbt** to "make the 64 pipelines work." That was
evaluated and **rejected** — see `reference_dbt-evaluated-rejected` (memory) + the 2026-06-28
SESSION_LOG entry. The short version, verified against live dbt docs via crawl4ai 2026-06-28:

> dbt is the **T in ELT** — it "works alongside your ingestion" and transforms data **already loaded**
> into the warehouse. Our pipelines are the **E and L** (dlt extraction + DuckDB + scrapers). dbt
> structurally cannot reach the extraction layer where the stated problems live.

- "Stop re-fetching" is an **extraction** concern → dlt incremental cursors (this spec).
- "Catch bad data before `data_lake.*`" → dbt tests run **post-land**; the right layer is dlt
  `schema_contract` + value guards (this spec, Part 2).
- Lineage / freshness / retry → already covered by the refinery (`input_brains` + topo sort),
  `cadence_registry.yaml` + freshness-probe-daily, and GHA. No gap dbt fills better.

dbt's only honest fit (consolidating the SQL-expressible transform slice) is a separate, optional
maintainability initiative — explicitly **out of scope** here.

---

## 1. The problem (evidence)

Measured across `ingest/` (from Issue 03, re-confirmed): of ~25 dlt pipelines — **17 `merge`,
8 `replace`, 0 `dlt.sources.incremental`**. The "64 pipelines" the operator referenced is grounded:
60 ingest-shaped GHA workflows, 68 cadence entries — a heterogeneous mix of dlt + DuckDB +
crawl4ai/Firecrawl scrapers + Vercel crons + brain write-backs.

Two distinct defects this slice targets, on the reference pipeline:

1. **Non-self-healing window (silent gaps).** `lee-permits-weekly.yml` computes
   `START=$(date -u -d "7 days ago")`, `END=today` and merges by `permit_id`. The window is
   *"last 7 days,"* not *"since the last successful load."* The cadence registry already records
   403/WAF skips on this scraper. **Every skipped or failed week is a permanent gap** — those
   permits are never re-pulled. (Lee permits does NOT re-fetch everything; its bug is quieter and
   worse for completeness.)
2. **No pre-land value validation.** Rows are emitted straight to `data_lake.*` with no structural
   freeze and no value assertions, so a source-shape drift or a bad row lands silently and surfaces
   downstream in a brain.

The bigger "re-fetch everything" waste lives in the large `merge` pipelines that still pull the
**entire** source each run (e.g. FEMA NFIP ~448k rows) — those are on the rollout map, not in this
first slice.

## 2. Goal

A proven, copyable pattern: an append/event dlt pipeline that (a) extracts only what's new via a
state cursor that self-heals across missed runs, (b) rejects bad data **before** it lands, and (c)
proves both with tests. Plus a scaffold that makes new pipelines start this way, and a map that says
exactly which existing pipelines to convert and which to leave on `replace`.

## 3. Scope

**IN (this slice):**
- Convert `ingest/pipelines/lee_permits/` to `dlt.sources.incremental` (reference implementation).
- Add pre-land validation to it (structural `schema_contract` freeze + value assertions).
- Fixture-based dry-run delta proof (second no-new-rows run writes ~0 rows).
- Make `ingest/scaffold.py` incremental-aware by default.
- The per-source classification map (§5) for the remaining dlt pipelines.

**OUT (explicitly):**
- Converting any pipeline other than Lee permits (the map sequences those into follow-up PRs).
- `listing_lifecycle` — actively modified by a parallel session; coordinate first (Issue 03 note).
- Non-dlt scrapers (psycopg/Firecrawl writers) — their incrementality is per-scraper, separate work.
- Any dbt adoption.

## 4. Research findings (crawl4ai, 2026-06-28 — RULE 0.4)

Installed: `dlt[postgres]>=1.26.0` (`ingest/requirements.txt`); `schema_contract.py` header notes
in-session verification against dlt 1.28.1 docs / installed 1.27.2. Re-verify against the installed
version before coding.

**`dlt.sources.incremental` (https://dlthub.com/docs/general-usage/incremental/cursor):**
```python
@dlt.resource(primary_key="permit_id", write_disposition="merge")
def permits_resource(
    cursor=dlt.sources.incremental("issued_date", initial_value="1970-01-01", last_value_func=max)
):
    # cursor.start_value  -> max issued_date from previous run (or initial_value on first run)
    # cursor.last_value   -> running max, updated per yielded item
    # dlt persists state automatically and DEDUPES the inclusive-boundary overlap
    ...
```
- dlt finds max/min cursor values, removes duplicates, and manages state with the last value.
- The cursor value is meant to be fed back into the **source request** (the docs' GitHub example
  feeds it into the API `since` param). For a scraper, we feed `cursor.start_value` into the scrape
  window's `--start`.
- `row_order="desc"` lets ordered sources stop paginating early. Incremental only saves the
  **network pull** when the source accepts a server-side filter or is ordered; otherwise dlt still
  pulls all rows and filters client-side. This is the crux of the §5 classification.

**`schema_contract` (https://dlthub.com/docs/general-usage/schema-contracts):**
- Modes per entity (`tables`/`columns`/`data_type`): `evolve` (default), `freeze`, `discard_row`,
  `discard_value`. `freeze` "will raise an exception if data is encountered that does not fit the
  existing schema, so no data will be loaded to the destination."
- **Governs structure only** (new table, new column, type/nullable/precision drift). It does NOT do
  not-null/accepted-values/range on an existing column — those are **value** assertions we implement
  with an in-resource guard / `add_filter`, complementing `ingest/lib/guards.py` and
  `ingest/quality/`. (This is exactly the dbt-test surface, run pre-land instead of post-land.)
- Settable on `@dlt.resource`, `@dlt.source`, or `pipeline.run()` (run() overrides).

**ArcGIS note:** `ingest/lib/arcgis_paginator.py` already takes `where=`, so ArcGIS-backed sources
(parcels, FDOT) can filter server-side by an edit-date cursor when their turn comes. Lee permits is
NOT ArcGIS — it is an Accela Citizen Access scrape via crawl4ai (`scraper.py`), so it uses the
client-side high-water-mark variant.

## 5. Design

### Part 1 — Reference conversion (Lee permits)

Current (verified in code): `permits_resource(rows)` emits **pre-fetched** rows;
`run_pipeline(start_date, end_date)` calls `fetch_permit_pages(start, end)` FIRST, enriches, then
passes rows into `permits_resource(rows=rows)`; the cron passes a fixed 7-day window;
`test_pipeline.py` drives the resource directly via `permits_resource(rows=fixture_rows)`.

> ⚠️ **WATCH-OUT 1 — the enrichment fallback poisons the cursor (most important thing in this spec).**
> `parse_accela_result_page` stamps `issued_date = issued_date_fallback` (currently `end_date` =
> today) on EVERY row (`scraper.py:247`). `enrich_rows_with_details` only overwrites it
> `if detail.get("issued_date")` (`scraper.py:513-514`) — so any row whose CapDetail fetch is empty
> (`scraper.py:509` `continue`) or yields no parseable date KEEPS today's date. With a
> `last_value_func=max` cursor on `issued_date`, a single such row jumps `last_value` to today, and
> the next run's `start_value` becomes today — collapsing the window to zero and permanently
> stranding every older/unenriched permit. The value guard on `issued_date` is therefore **cursor
> protection, not a quality nicety**, and its ORDERING is load-bearing.
>
> **Fix:** the unenriched fallback must be `None`, never `end_date`. Change
> `parse_accela_result_page` so unenriched rows carry `issued_date=None` (or stop passing a
> `fallback`). In `permits_resource`, **before the cursor sees a row**, the value guard EXCLUDES any
> row with a null/unparseable `issued_date` from the load (a permit with no issue date is not an
> issued permit) and logs it. The cursor then advances only on rows with a REAL `issued_date`, so a
> failed-enrichment row can never advance `last_value`. Set `dlt.sources.incremental(...,
> on_cursor_value_missing="exclude")` (verify exact kwarg name/behavior against the installed dlt) so
> a stray null can never raise or poison state. Residual edge (a permit whose enrichment fails every
> run) is documented in §8 — it stays unloaded and logged for human follow-up; we never invent a date.

**Architecture decision — Option B (cursor reads state; fetch stays outside the resource).** The
cursor's `start_value` must drive the scrape window, but the fetch happens in `run_pipeline`, before
the resource runs. Two paths:
- *Option A — move the fetch inside `permits_resource`.* dlt-native, but it **destroys the existing
  test pattern**: `test_pipeline.py` injects fixture `rows=` and runs offline against DuckDB; a
  self-scraping resource can't be driven with fixtures. Rejected.
- *Option B — `run_pipeline` reads the persisted cursor value before fetching* (via the pipeline's
  dlt state / a `MAX(issued_date)` query, see first-run below), computes `start_date`, then calls
  `fetch_permit_pages(start_date, end_date)` as today. The cursor stays on the resource for **dedup +
  state advancement**; the resource keeps accepting `rows=`, so the test pattern is preserved.
  **Chosen.**

Changes:
1. Add `cursor=dlt.sources.incremental("issued_date", last_value_func=max, on_cursor_value_missing="exclude")`
   to `permits_resource`. Keep `primary_key="permit_id"` + `write_disposition="merge"` (unchanged).
2. `run_pipeline` computes the scrape `--start` from the persisted high-water mark (existing dlt state
   if present, else the first-run seed below) minus a small safety lookback (proposed 3 days, see §8)
   to absorb late-posted permits; the cursor's inclusive-boundary dedup makes the overlap
   exactly-once. `--end` stays today. The fetch still happens in `run_pipeline` (Option B).
3. `main()` makes `--start` OPTIONAL: when omitted, `run_pipeline` derives it from state (above). The
   weekly cron stops computing `START=$(date -u -d "7 days ago")` and calls the pipeline with no
   `--start`, so the window is driven by persisted state and a missed/failed week self-heals on the
   next success. (GHA YAML change — see Part 6.)
4. **First-run migration (load-bearing, operationalized — pushback #4).** `lee_building_permits` is
   already populated but has no dlt incremental state yet. A naive `initial_value="1970-01-01"` would
   tell the Accela date form to search 56 years (likely rejected or zero rows → a green-but-empty run
   that silently mis-seeds the cursor). **Chosen: `run_pipeline` queries Postgres for
   `MAX(issued_date)` from `data_lake.lee_building_permits` at startup when no dlt cursor state
   exists**, and uses `that - lookback` as the first `--start`. No hand-seeding of `_dlt_state`, no
   hardcoded date. After the first successful run, dlt's persisted state takes over.

### Part 2 — Pre-land validation (the half dbt can't do)

Both run at extraction, before any Tier-2 write:
- **Structural:** add `schema_contract={"columns": "freeze", "data_type": "freeze"}` to the
  `@dlt.resource` decorator on `permits_resource` (leave `tables: evolve`). A new/renamed column or a
  type drift raises. **Wiring is not present yet** (pushback #8): `schema_contract.py` exists but
  `pipeline.py` does not import it — the implementation must (1) add the decorator arg and (2) import
  `explain_contract_failure` and wrap the load in `try/except PipelineStepFailed` to surface the
  plain-English context. Both pieces are required; the formatter alone does nothing.
- **Value:** assert load-bearing fields in the resource — `permit_id` present and non-empty,
  `issued_date` parseable (the cursor-protection guard from Part 1), `declared_value_usd` is
  null-or-`>= 0`. **Create a distinct `class ValueGuardError(RuntimeError)` in `guards.py`** alongside
  `VolumeGuardError` (pushback #9). Rationale (corrected): the cron classifier
  (`classify-cron-failure.mjs`) routes by **message regex, not exception class** — there is no
  "volume-guard arm," so the original "would route to the wrong arm" reason does not hold. The real
  reasons to split the class: semantic clarity in logs, and so a value-failure message never
  accidentally trips the classifier's `DATA_EMPTY` "0 rows" arm. Keep the existing `guards` volume
  floor (`VolumeGuardError`) unchanged.
- **Load-failure surfacing (pushback #6, reframed):** capture `load_info = pipeline.run(...)` and call
  `load_info.raise_on_failed_jobs()`. NOTE — current dlt already raises `LoadClientJobFailed` on a
  terminally-failed job by **default** (verified live 2026-06-28: docs/running-in-production/running;
  no `raise_on_failed_jobs=false` in `.dlt/config.toml`), so this is NOT fixing a silent exit-0 bug.
  It is adopted for **consistency with house convention** — `bls_laus`, `bls_qcew`, `bls_oews`,
  `collier_parcels` all call it explicitly; `lee_permits` is the inconsistent one.

### Part 3 — Dry-run delta proof (TDD)

- **Pure/unit (TDD, no network):** drive `permits_resource` twice over the same fixture rows and
  assert run #2 writes ~0 rows (incrementality) and `cursor.last_value` advanced to the max
  `issued_date` of run #1. **Test-setup gotcha (pushback #10):** the existing tests make a FRESH
  `tempfile.TemporaryDirectory()` per test, which does NOT share dlt state across two runs. The
  dedup proof must create ONE temp dir inside the test and run BOTH `pipeline.run()` calls against the
  SAME `pipeline_name` pointing at that dir (dlt persists incremental state under the pipeline's
  working dir). Without this the second run starts stateless and re-loads everything — a false negative.
- **Contract tests:** inject a row with a new column → `schema_contract` freeze raises
  (`PipelineStepFailed`); inject a bad/empty `permit_id` or negative `declared_value_usd` →
  `ValueGuardError`; inject an unenriched (null `issued_date`) row → excluded from the load AND does
  not advance the cursor (the Watch-Out 1 regression test).
- **Live:** the existing `--dry-run` path (fetch+parse only) remains the WAF/IP probe; no live write
  in CI for this scraper. Since `--start` becomes optional (Part 6), the dry-run needs a sensible
  default window when invoked with no dates (proposed: today−1 → today) so the probe still fetches
  something.

### Part 4 — Scaffold fix

`ingest/scaffold.py` defaults a new pipeline to: `dlt.sources.incremental(<cursor>)` + `merge` +
`primary_key` + `schema_contract` freeze on columns/data_type, with a commented "snapshot source?
keep `replace` and document why" branch. This kills the replace-by-default spread at its root.

### Part 5 — Per-source classification (CORRECTED + verified, 06/28/2026)

**Bottom line (verified against the live cadence registry + `write_disposition` grep + OpenFEMA
metadata):** only the **two permit scrapers** are real incremental conversions. Everything else
stays as-is. The "stop re-fetching everything" framing is overstated against our actual data: the
big full pulls (FEMA, parcels, Census) run only **quarterly or annually**, and the frequent pulls
are **tiny** (hundreds of rows). There is no large + frequent dlt pull to optimize. The genuine bug
this work fixed was the permit scrapers' **silent gaps** (a skipped run lost a slice forever), not
volume.

`write_disposition` below is the **verified current** value (grep of each resource); cadence is from
`ingest/cadence_registry.yaml`; "stable key" decides whether incremental+merge is even possible.

| Pipeline | now | shape / source cadence | stable key | recommended | status |
|---|---|---|---|---|---|
| lee_permits | merge | Accela scrape, append/event, weekly | `permit_id` ✓ | **incremental + merge** | **DONE** — built + 48/48 tests, dlt cursor + `lag` + `on_cursor_value_missing` |
| collier_permits | merge | monthly XLSX file, append, monthly | `permit_id` ✓ | **incremental + merge** | TODO — identical fix to Lee |
| fema (NFIP) | replace | OpenFEMA API ~448k, quarterly | **NONE** — `id` regenerates each refresh (verified OpenFEMA metadata 06/28/2026; only flagged primaryKey is the volatile `id`) | **keep replace** | leave — incremental merge impossible without a stable key |
| census_acs | replace | 5-yr full snapshot, annual | n/a | keep replace | leave (snapshot) |
| census_cbp | replace | full snapshot ~256k, annual | n/a | keep replace | leave (snapshot) |
| fhfa (HPI) | replace | full quarterly series ~133k | n/a | keep replace | leave (snapshot) |
| fdot (AADT) | replace | annual full snapshot ~104k | n/a | keep replace | leave (snapshot) |
| fl_dbpr_licenses (+applicants) | merge / replace | monthly bulk CSV (full file) | n/a | keep as-is | leave (full file) |
| leepa (parcels ~549k) | merge | annual parcel roll (full), annual | parcel id | keep merge-on-key | leave (annual full roll) |
| collier_parcels (~291k) | merge | annual parcel roll (full), annual | parcel id | keep merge-on-key | leave (annual full roll) |
| redfin_lee / redfin_collier | merge | monthly full TSV (~660/782 rows) | zip+period | keep merge-on-period | leave (full file, tiny) |
| zori / zhvi / tier_divergence (Postgres) | merge | monthly full Zillow series | zip+month | keep merge-on-period | leave (full series) |
| bls_laus / bls_qcew / bls_oews | merge | time-series API, small, rolling window | series+period | keep merge | leave (re-pull is cheap) |
| noaa_ghcn_rainfall | merge | append-by-year S3, tiny | station+year | keep merge | leave (tiny; incremental optional, not worth it) |
| news_swfl | merge | daily current-state scrape | url/id | keep merge | leave (scrape, not a windowed fetch) |
| listing_lifecycle | (parallel session) | daily scrape diff | listing id | (owned elsewhere) | **coordinate / OUT** |

**Tier-1 Parquet uploaders — NOT dlt Postgres pipelines (no `write_disposition`, so out of this
table):** `fred_g17`, `fred_laus_alfred`, `fred_listing_swfl`, `bls_ppi`, `census_vip`. Each uploads
a full series/snapshot Parquet to Storage; there is no dlt cursor to add. (`fred`/`census_vip` were
listed as dlt pipelines in the first draft — that was wrong; they are Tier-1.)

**Not dlt — excluded from this table (pushback #5):**
- **USGS** — the active pipeline (`ingest/duckdb_pipelines/usgs/pipeline.py`) is DuckDB + pandas +
  Parquet → Tier-1 S3, header "Full backfill only. Incremental mode is out of scope." A dlt cursor
  cannot be applied to it. The `usgs_tier2` row in `data_lake._dlt_loads` is a LEGACY dlt artifact
  scheduled for DROP (cadence_registry exclusion note). USGS incrementality, if ever wanted, is a
  separate Tier-1/DuckDB by-year approach — not part of this dlt work.
- **Other DuckDB/Parquet Tier-1 pipelines** (zori/zhvi/tier_divergence DuckDB, redfin_swfl, hurdat2,
  storm_history) — same category; full-snapshot Parquet, not dlt cursors.
- **Non-dlt scrapers** (swfl_inc, dbpr_press_releases, dbpr_public_notices, fgcu_reri, rsw_airport,
  dbpr_sirs, fl_dor_*, fdle_crime, news_swfl, active_listings, marketbeat_pdf, CRE sources, …) —
  incrementality there is per-scraper (psycopg/Firecrawl writers), not a dlt cursor. Not classified here.

### Part 6 — `main()` signature + GHA workflow (pushbacks #3, #7)

Both must change in the same commit as the conversion:
- `main()`: make `--start` OPTIONAL (default = derive from cursor state / first-run `MAX(issued_date)`).
  `--end` stays, defaulting to today. The `--dry-run` branch gets a default window (today−1 → today)
  when no dates are passed, so the WAF/IP probe still fetches something.
- `.github/workflows/lee-permits-weekly.yml`: DROP the `START=$(date -u -d "7 days ago")` /
  `END=$(date -u +%Y-%m-%d)` computation; call `python -m ingest.pipelines.lee_permits.pipeline`
  (no `--start`; optionally `--end` today) in the load branch, and the dry-run branch with no dates.
  The continue-on-error crawl4ai preflight step is unaffected.

## 6. Verification — definition of done (this slice)

- Fixture two-run proof: run #2 over the same rows writes ~0 rows; `cursor.last_value` advanced.
  Uses ONE shared temp dir + same `pipeline_name` across both runs (Part 3 gotcha). Logged.
- **Cursor-poison regression (Watch-Out 1):** an unenriched (null `issued_date`) row is excluded from
  the load AND does not advance the cursor; a row stamped with a fallback `end_date` never occurs
  (fallback is `None`).
- `schema_contract` freeze raises (`PipelineStepFailed`) on an injected new column / type drift, and
  `explain_contract_failure` is wired (imported + try/except in `pipeline.py`).
- `ValueGuardError` (distinct class) raises on bad `permit_id` / negative declared value.
- `run_pipeline` captures `load_info` and calls `raise_on_failed_jobs()` (house-convention parity).
- First-run path: with no dlt state, `run_pipeline` derives `--start` from `MAX(issued_date)` (no full
  1970 backfill).
- `main()` `--start` optional; `.github/workflows/lee-permits-weekly.yml` updated (no fixed-window
  computation); `--dry-run` path still green (fetch+parse, no write).
- `ingest/scaffold.py` defaults to incremental-aware (a generated stub shows cursor+merge+freeze).
- §5 rollout table complete and committed (USGS correctly excluded as non-dlt).
- No new Tier-2 table → no PostgREST grant change needed; brain-first gate N/A (consumer
  `lee_building_permits` / permits-swfl already exists).

## 7. Guardrails (locked — re-read, don't reinvent)

- **Do NOT blanket-convert** replace→incremental. Snapshot sources keep `replace`; document why.
- **Never code the dlt API from memory** — §4 facts are crawl4ai-verified; re-verify against the
  installed version before coding (RULE 0.4).
- **Gate 4:** any destructive write needs a non-null guard; never bypass without `ALLOW_REPLACE_WITHOUT_GUARD=1` + logged reason.
- **PROBE FIRST (ingest):** <1-min probe before any multi-minute run; fetch only normalizer columns.
- **Aggregate at source.** No hauling raw rows to count in TS.
- **No invented numbers** — every row count in a proof comes from a real query.
- **One pipeline per PR/commit group**; ship the cron wrapper + `--dry-run` in the same change.

## 8. Open questions / coordination

- Exact safety-lookback for late-posted permits (proposed 3 days — confirm against observed Accela
  posting lag during implementation). Too short risks missing a late-enriched permit whose true date
  predates the cursor; too long re-scrapes needlessly (dedup makes it correct, just slower).
- **Persistently-unenrichable permits (residual of Watch-Out 1).** A permit whose CapDetail fetch
  fails every run never gets a real `issued_date`, so it is never loaded and never advances the
  cursor. This is correct (we never invent a date) but means a chronically-broken detail page = a
  permanently-missing permit. Decision: log each excluded row with its `permit_id` + `cap_detail_url`
  so it is human-followable; consider a "stuck-row" count in the dry-run summary. Confirm this is
  acceptable vs. loading the row with a null `issued_date` (which would need the cursor to ignore
  nulls — `on_cursor_value_missing` — and a downstream brain tolerant of null dates).
- Verify the exact installed-dlt kwarg/behavior for `on_cursor_value_missing` before coding (RULE 0.4).
- **Late-arriving back-dated permits (cursor-boundary subtlety — found in self-review, not in the
  review).** A `last_value_func=max` cursor filters at the stored high-water mark. If a permit is
  *issued* before the mark but first *appears* in a later scrape, its `issued_date` is below
  `last_value` and the resource cursor will DROP it — the scrape-window lookback alone does NOT help,
  because the cursor re-filters. Options to decide at implementation: (a) lower the cursor's effective
  boundary by the lookback too (not just the scrape window) and accept re-scanning that overlap each
  run; (b) cursor on a monotonic *scrape/seen* timestamp instead of `issued_date` (catches everything
  newly seen, at the cost of re-merging unchanged rows — dedup by `permit_id` keeps it idempotent);
  (c) accept the gap and periodically run a wider catch-up merge. Pick one before converting; this
  changes the completeness guarantee.
- `listing_lifecycle` ownership — confirm the parallel session is done before it enters any rollout PR.
- FEMA `$filter` server-side support — verify live before scheduling that conversion.

## 9. Test plan (TDD-able surfaces)

- Cursor/state logic and dedup: pure, fixture-driven — ONE shared temp dir + same `pipeline_name`
  across two runs (`test_pipeline.py`); run #2 writes ~0 rows.
- **Cursor-poison regression:** a null-`issued_date` row is excluded and does not advance
  `cursor.last_value`; assert no row ever carries a fallback `end_date`.
- Value assertions: pure (table of good/bad rows) → `ValueGuardError`.
- Schema-contract trip: fixture row with extra column / wrong type → `PipelineStepFailed`, formatted
  by `explain_contract_failure`.
- First-run seed: mock "no dlt state" + a stubbed `MAX(issued_date)` → asserts `--start` derives from
  it, not `1970-01-01`.
- Scaffold output: generate a stub, assert it contains cursor+merge+freeze defaults.
