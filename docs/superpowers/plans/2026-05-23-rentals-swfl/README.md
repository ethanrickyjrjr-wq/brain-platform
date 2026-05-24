# Plan — `rentals-swfl` (ZORI rent-index brain, v1)

**Plan ID:** `2026-05-23-rentals-swfl`
**Canonical home for the in-repo copy:** `docs/superpowers/plans/2026-05-23-rentals-swfl/README.md` (this file should be copied there as the first execution step)
**Status:** ready for execution
**Author conversation:** locked through polarity table + lane choice + LB pushback rounds

---

## 1. Context

Today the brain platform has no rental signal. The only Zillow assets in the repo are a manually-downloaded ZORI CSV in the `.gitignore`-d `data/external/zillow/` cold-storage path, a small SWFL fixture for viz, and a ZHVI viz component with no data spine. Verified live against Supabase: no `data_lake.zillow_*` / `data_lake.zori_*` / `data_lake.zhvi_*` table exists; the Tier 1 inventory holds zero `market/*` Parquet files.

A separate Redfin Tier 1 pipeline (`ingest/duckdb_pipelines/redfin_swfl/`) was authored from Claude Code mobile and merged as code but has never been executed — no S3 Parquet, no inventory row. Redfin and ZORI share zero source rows (Redfin is sales-side; ZORI is rent-side), so Redfin is parked as a separate PR per LB.

`rentals-swfl` closes the rental gap as a leaf brain feeding `master`. Output frame is investor/operator (consistent with `cre-swfl`, `permits-swfl`, `properties-lee-value`). It is intentionally not wired into `cre-swfl` in v1 — that thin pipe is a follow-on once polarity has a track record.

---

## 2. Decisions locked (read these before touching code)

| #   | Decision                                                                                                                                                                                                                     | Note                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Tier 2 loader = dlt** (`write_disposition="merge"` on PK)                                                                                                                                                                  | Corrected from earlier draft. All 9 packs under `ingest/pipelines/` use dlt; lee_permits is the most recent reference at `ingest/pipelines/lee_permits/pipeline.py:16-19`. |
| 2   | **Tier 1 lane = DuckDB pipeline** with UNPIVOT wide→long                                                                                                                                                                     | ZORI CSV is wide (9 metadata cols + ~136 month cols). DuckDB native `UNPIVOT` handles this cleanly.                                                                        |
| 3   | **Source URL = hard-coded** `files.zillowstatic.com/research/public_csvs/zori/...`                                                                                                                                           | No Firecrawl crawler. Exact filename verified at code-time against the local copy in `data/external/zillow/`.                                                              |
| 4   | **No date-sentinel skip-if-current** in v1                                                                                                                                                                                   | Cron handles cadence. Skip the half-day of edge cases.                                                                                                                     |
| 5   | **Shared SWFL metro list** at `ingest/lib/swfl_metros.py`                                                                                                                                                                    | Extract `SWFL_METRO_SUBSTRINGS` from `ingest/duckdb_pipelines/redfin_swfl/constants.py:35-40` into a shared module. Both pipelines import it. Anti-drift.                  |
| 6   | **Wired to `master` only**, not `cre-swfl`                                                                                                                                                                                   | Master edge type: `input` (not `modifier` — rents are a primary signal, not a constraint). Reference: `refinery/packs/master.mts:241-255`.                                 |
| 7   | **Polarity = investor/operator frame** with regime-shift caveat at >+10% YoY                                                                                                                                                 | Full table in §5.                                                                                                                                                          |
| 8   | **All four BrainOutputDirection enum strings come from `refinery/types/brain-output.mts:24`** verbatim: `"bullish" \| "bearish" \| "neutral" \| "mixed"`. No invented compounds. "With caveat" lives in `caveats: string[]`. |

---

## 3. State of play (verified 2026-05-23, not from memory)

- `data_lake.zillow_zhvi_zip` / `zillow_zori_zip` → both `NULL` via `to_regclass` (confirmed live).
- `data_lake._tier1_inventory` → 24 rows, zero `market/` entries.
- Vocab JSON: `refinery/vocab/brain-vocabulary.json` — 114 concepts.
- Packs registry: 15 packs, neither `rentals-swfl` nor `redfin-swfl` present.
- ZORI CSV header (verified): `RegionID, SizeRank, RegionName, RegionType, StateName, State, City, Metro, CountyName, 2015-01-31, ..., 2026-04-30`. `RegionType = 'zip'` rows are the slice we want. `RegionName` = ZIP code as text. `Metro` = full MSA name (substring-matchable against Redfin's metro list).
- Build-context `.claude/build-context.md` is stale (Lane 2D.1 era) — must be refreshed at start of execution session.

---

## 4. Build order (eight steps, all in one PR)

### Step 1 — Shared metro constants (refactor)

**Files:**

- `ingest/lib/swfl_metros.py` _(new)_ — exports `SWFL_METRO_SUBSTRINGS: list[str] = ["Cape Coral", "Naples", "Punta Gorda", "North Port"]` plus inline comment that Glades + Hendry are MSA-untracked.
- `ingest/duckdb_pipelines/redfin_swfl/constants.py` — delete local list, import from `ingest.lib.swfl_metros`.

**Why first:** Two-line diff, zero risk (Redfin pipeline has never run), eliminates the drift LB called out.

### Step 2 — Tier 1 DuckDB pipeline

**Files:**

- `ingest/duckdb_pipelines/zori_swfl/__init__.py` _(empty)_
- `ingest/duckdb_pipelines/zori_swfl/constants.py` — `ZORI_CSV_URL`, `BUCKET = "lake-tier1"`, `PARQUET_PATH = "market/zori_swfl.parquet"`, `PACK_ID = "rentals-swfl"` _(set from day one — brain ships in same PR per Data Tier Policy §2)_.
- `ingest/duckdb_pipelines/zori_swfl/pipeline.py` — mirror `ingest/duckdb_pipelines/redfin_swfl/pipeline.py` structure (load env, configure S3, download, transform, write Parquet, upsert inventory). Transform step uses DuckDB **UNPIVOT** to melt the ~136 month columns. Programmatically extract month-column names from the header so the list isn't hard-coded.

**Pseudo-SQL for the transform** (the load-bearing bit):

```sql
WITH wide AS (
  SELECT * FROM read_csv_auto('<tmp_csv>', header=true)
  WHERE RegionType = 'zip'
    AND ({metro_filter})  -- OR-clauses against SWFL_METRO_SUBSTRINGS, same shape as redfin
),
melted AS (
  UNPIVOT wide
  ON COLUMNS(* EXCLUDE (RegionID, SizeRank, RegionName, RegionType, StateName, State, City, Metro, CountyName))
  INTO NAME period_end_str VALUE rent_index
)
SELECT
  RegionName            AS zip_code,
  CAST(period_end_str AS DATE) AS period_end,
  CAST(rent_index AS DOUBLE)   AS rent_index,
  Metro                 AS metro,
  CountyName            AS county_name,
  City                  AS city,
  '<ingested_at>'       AS ingested_at
FROM melted
WHERE rent_index IS NOT NULL
```

**Output:** `s3://lake-tier1/market/zori_swfl.parquet` + one row in `data_lake._tier1_inventory` with `pack_id = "rentals-swfl"`.

**npm script:** Added in step 4 (three scripts total: `:tier1`, `:tier2`, combined). Step 2 alone is invoked via `npm run ingest:zori-swfl:tier1` for Tier-1-only runs.

### Step 3 — Tier 2 DDL

**File:** `docs/sql/20260523_zori_swfl.sql` — paste-and-run in Supabase SQL editor.

```sql
-- Tier 2 promotion for rentals-swfl (ZORI rent index, monthly, ZIP-level).
-- Consuming brain: rentals-swfl (ships same PR).

CREATE TABLE IF NOT EXISTS data_lake.zori_swfl (
  zip_code      text        NOT NULL,
  period_end    date        NOT NULL,
  rent_index    numeric     NOT NULL,
  metro         text,
  county_name   text,
  city          text,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zip_code, period_end)
);

-- PK already indexes (zip_code, period_end); covers ZIP-leading filters.
-- Add standalone period_end index for time-leading rollups
-- ("latest month across all ZIPs", vintage windows).
CREATE INDEX IF NOT EXISTS zori_swfl_period_end_idx
  ON data_lake.zori_swfl (period_end);

GRANT SELECT ON data_lake.zori_swfl TO service_role;
```

No additional composite index — the PK _is_ the `(zip_code, period_end)` btree (Postgres auto-creates a unique index for every PK).

### Step 4 — dlt resource (Tier 1 Parquet → Tier 2 Postgres)

**Files:**

- `ingest/pipelines/zori_swfl/__init__.py` _(empty)_
- `ingest/pipelines/zori_swfl/resources.py` — `@dlt.resource(name="zori_swfl", primary_key=("zip_code", "period_end"), write_disposition="merge")` yielding dicts from a DuckDB read of the Parquet we just wrote.
- `ingest/pipelines/zori_swfl/pipeline.py` — entry point: `dlt.pipeline(pipeline_name="zori_swfl", destination="postgres", dataset_name="data_lake").run(resource(...))`.
- `ingest/pipelines/zori_swfl/test_pipeline.py` + `ingest/pipelines/zori_swfl/test_resources.py` — mirror the unit-test patterns at `ingest/pipelines/lee_permits/test_pipeline.py` and `ingest/tests/pipelines/fema/test_resources.py` (assert `write_disposition`, assert PK shape).

**Source pattern reference:** `ingest/pipelines/lee_permits/pipeline.py:16-47` (resource shape) and `ingest/pipelines/usgs/resources.py:162` (merge disposition on a multi-column key).

**Caller pattern (REVISED — no cross-layer import):** Two independent npm scripts, chained by the user. Verified that no existing `ingest/duckdb_pipelines/*` imports from `ingest/pipelines/*` — this plan should not be the first to break that boundary. Instead:

- `package.json` gets three scripts:
  - `"ingest:zori-swfl:tier1": "python -m ingest.duckdb_pipelines.zori_swfl.pipeline"` — Tier 1 Parquet only.
  - `"ingest:zori-swfl:tier2": "python -m ingest.pipelines.zori_swfl.pipeline"` — dlt resource reads the Parquet from S3 via DuckDB, yields dicts, writes Tier 2.
  - `"ingest:zori-swfl": "npm run ingest:zori-swfl:tier1 && npm run ingest:zori-swfl:tier2"` — combined entry point for cron.

The dlt resource in `ingest/pipelines/zori_swfl/resources.py` reads the Tier 1 Parquet via DuckDB (`SELECT * FROM read_parquet('s3://lake-tier1/market/zori_swfl.parquet')`) — same S3 credentials wiring as the DuckDB pipeline (`_configure_s3` helper pattern from `ingest/duckdb_pipelines/redfin_swfl/pipeline.py:52-66`). Idempotent: if Tier 1 hasn't been refreshed, Tier 2 re-merges the same rows under `write_disposition="merge"` and the PK ensures no duplicates.

Matches USGS precedent (independent DuckDB + dlt pipelines under `ingest/duckdb_pipelines/` and `ingest/pipelines/usgs/` respectively, no cross-import).

### Step 5 — Source connector

**File:** `refinery/sources/zori-source.mts`

Mirror `refinery/sources/permits-source.mts` exactly. Specifically:

- `import { getSupabase } from "./supabase.mts";` (singleton — `refinery/sources/supabase.mts:24-31`).
- Export `zoriSource: SourceConnector` with `source_id: "zori_swfl"`, **`trust_tier: 3`** (LOCKED). Rationale: `refinery/types/pack.mts:30-36` defines tier 1 = federal/SEC/NOAA-class sources only, tier 2 = verified editorial / already-shipped brain output, tier 3 = secondary aggregator / industry report, tier 4 = inferred. Zillow Research is a private-sector industry aggregator publishing a methodology-driven index — fits tier 3 cleanly. Material downstream impact: `trust_tier_score` lookup at `pack.mts:97` maps tier 3 → 0.6 (vs. 1.0 at tier 1), so brain-level confidence will run roughly 0.5–0.6 × freshness rather than ~0.9 × freshness. This is the honest number; do not inflate it to push the confidence headline up.
- `fetch()` pulls **raw rows only** from `data_lake.zori_swfl`. MoM/YoY are **computed in TypeScript** inside the pack (see step 6), not pushed to SQL. This matches the permits/cre pattern per Phase-1 Explore findings.
- `citationMeta()` returns the Zillow research URL + the trust-tier — wired identically to `permits-source.mts:69-98`.
- Fixture mode: when `process.env.REFINERY_SOURCE === "fixture"`, load from `refinery/__fixtures__/zori-swfl.sample.json` instead of hitting Supabase. Fixture shape = array of `{ zip_code, period_end, rent_index, metro, county_name, city }`.

### Step 6 — Vocab additions (use the patterns hook — don't author per-ZIP)

**File:** `refinery/vocab/brain-vocabulary.json` (114 → ~120 concepts)

New SKOS concepts (six entries, not 60-per-ZIP):

| `id`                                     | `raw_slug_patterns` (added; lets per-ZIP slugs resolve through the new pattern hook) | `variable_type`                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| `rental_rent_index_zori`                 | `["rental_rent_index_zori_zip_*"]`                                                   | extensive (USD-equivalent dollar value) |
| `rental_rent_yoy_pct`                    | `["rental_rent_yoy_pct_zip_*"]`                                                      | intensive                               |
| `rental_rent_mom_pct`                    | `["rental_rent_mom_pct_zip_*"]`                                                      | intensive                               |
| `rental_rent_index_zori_regional_median` | —                                                                                    | extensive                               |
| `rental_rent_yoy_pct_regional_median`    | —                                                                                    | intensive                               |
| `rental_rent_yoy_pct_top_heating_zips`   | —                                                                                    | categorical                             |

Pattern hook: `refinery/vocab/patterns.mts` glob (`*` = one underscore-bounded segment, anchored, compiled to `^...[^_]+...$`). No capture groups — ZIP extraction in the caller. Phase-1 Explore agent B confirmed the exact mechanics.

### Step 7 — Pack file (the brain)

**Scaffold:** `npx tsx refinery/scaffold.mts --id=rentals-swfl --domain=real-estate --input-brains=`

(Empty `--input-brains` is valid — Phase-1 confirmed at `refinery/scaffold.mts:85-88`. The scaffold writes `refinery/packs/rentals-swfl.mts` + appends to `refinery/packs/index.mts` at the marker lines.)

**Hand-edit after scaffold:**

`refinery/packs/rentals-swfl.mts` — mirror `refinery/packs/permits-swfl.mts` structure (Phase-1 Explore agent A mapped this end-to-end):

```typescript
export const rentalsSwfl: PackDefinition = {
  id: "rentals-swfl",
  brain_id: "rentals-swfl",
  domain: "real-estate",
  scope: "SWFL ZIP-level residential rent index (Zillow ZORI), monthly.",
  ttl_seconds: 86400 * 30, // monthly cadence — 30-day TTL is honest
  sources: [zoriSource],
  input_brains: [],
  fitScore: () => 10,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: rentalsCorpusSummary, // builds + caches RentalsSnapshot on module singleton
  outputProducer: rentalsOutputProducer,
};
```

`corpusSummary`:

- Sort fragments by `(zip_code, period_end)`.
- For each ZIP: compute current `rent_index` (latest month), `rent_mom_pct`, `rent_yoy_pct` (12-month lag).
- Cache `RentalsSnapshot` + `lastFetchedAt` in module-level singletons (same pattern as `permits-swfl.mts:266-297`).
- Emit one `SynthesisFact` per ZIP for the audit trail.

`outputProducer`:

- Read cached snapshot (ignore the `PackOutput` arg per permits-swfl pattern).
- Compute **regional median** `rent_yoy_pct` across all SWFL ZIPs.
- Classify regional median against the polarity table (§5) → `direction`.
- `magnitude = Math.min(Math.abs(median_yoy_pct) / 10, 1)`.
- Push caveats per the table.
- Build `key_metrics` array: regional median, regional median rent_index, top-3 heating ZIPs, top-3 cooling ZIPs, count of ZIPs covered. Each metric carries its `BrainOutputMetricSource` block (mirror `permits-swfl.mts:384-441`).
- `drivers: []` (leaf brain, no upstream brains).
- `overrides: []` (no constitution overrides in v1).
- `contradicts: []`.

**Crucial:** `outputProducer` does NOT set `confidence` — Stage 4 owns it deterministically (`refinery/lib/confidence.mts::trustTierWeightedConfidence`). Phase-1 Explore confirmed via the field-ownership comment at `brain-output.mts:187-198`.

**Test file:** `refinery/packs/rentals-swfl.test.mts` — see §6.

### Step 8 — Wire to master + regenerate

**File:** `refinery/packs/master.mts:241-255` — append `{ id: "rentals-swfl", edge_type: "input" }` to `input_brains`.

**Then run, in order:**

1. `npm run ingest:zori-swfl` (combined script: runs `:tier1` then `:tier2` via `&&`)
2. `npm run refinery rentals-swfl` (generates `brains/rentals-swfl.md` with `--- OUTPUT ---` block)
3. `npm run refinery master` (regenerates master with `rentals-swfl` as an upstream)
4. `npm run ledger` (regenerates `docs/semantic-ledger.md`)
5. `npm run triage` (regenerates `docs/orphan-triage.md` — should not show any new orphans because of the vocab patterns from step 6)

---

## 5. Polarity table (locked — verbatim enum strings)

`BrainOutputDirection` enum from `refinery/types/brain-output.mts:24`: `"bullish" | "bearish" | "neutral" | "mixed"`.

**Investor/operator frame** (default for the platform, consistent with cre-swfl + properties-lee-value + permits-swfl):

| `regional_median_rent_yoy_pct` | `direction` | `caveats[]` push                                                                                            |
| ------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `< 0%`                         | `"bearish"` | —                                                                                                           |
| `[0%, +2%)`                    | `"neutral"` | `"Sub-inflation rent growth — real-terms decline."`                                                         |
| `[+2%, +6%]`                   | `"bullish"` | —                                                                                                           |
| `(+6%, +10%]`                  | `"bullish"` | `"Rent growth above wage trend — watch durability."`                                                        |
| `> +10%`                       | `"neutral"` | `"Rent growth exceeds wage growth materially; 2021–22 SWFL surge reverted within ~18 months in most ZIPs."` |

`magnitude = Math.min(Math.abs(regional_median_yoy_pct) / 10, 1)`.

**Per-metric `direction`** in each `BrainOutputMetric` is a different enum (`"rising" | "falling" | "stable"` per `brain-output.mts:112`). Positive YoY → `"rising"`. Don't conflate with the brain-level direction.

**Required metric fields** for every `key_metrics` entry: `metric`, `value`, `direction`, `label`, `variable_type`, `units` (required when not categorical), and full `source: BrainOutputMetricSource` block with `url` + `fetched_at` + `tier` + `citation`. One fully-populated example for CT to copy:

```typescript
{
  metric: "rental_rent_yoy_pct_regional_median",
  value: 4.2,
  direction: "rising",
  label: "SWFL regional median ZORI rent YoY %",
  variable_type: "intensive",
  units: "percent",
  display_format: "percent",
  source: {
    url: "https://files.zillowstatic.com/research/public_csvs/zori/<file>",
    fetched_at: lastFetchedAt,                  // ISO 8601, from corpusSummary cache
    tier: 3,                                    // private-sector industry aggregator — matches zoriSource.trust_tier
    citation: "Zillow Observed Rent Index (ZORI), ZIP-level, smoothed and seasonally adjusted (Zillow Research, files.zillowstatic.com)",
  },
}
```

Renter/affordability frame is the INVERSE and is NOT this brain's default. A future `housing-affordability-swfl` consumer inverts the sign at consumption.

---

## 6. Test plan

**Unit — source (`refinery/sources/zori-source.test.mts`):**

- Fixture-mode roundtrip: `REFINERY_SOURCE=fixture` → fetch returns the JSON fixture's rows shaped as `RawFragment[]` with `trust_tier: 1`.
- `citationMeta()` returns expected URL + tier.

**Unit — pack outputProducer (`refinery/packs/rentals-swfl.test.mts`):**

- Mirror `refinery/packs/permits-swfl.test.mts:93-131` structure.
- Set `process.env.REFINERY_SOURCE = "fixture"` in `beforeAll`.
- One `it()` per locked-enum assertion (`["bullish","bearish","neutral","mixed"].toContain(result.direction)`).
- **Five band-coverage `it()` cases** — one fixture per polarity band in §5. Each fixture is a 12-month synthetic ZIP series tuned so the regional median lands in the target band. Assert: correct `direction` + correct caveats pushed + `magnitude` in `[0, 1]`.
- One `it()` asserting `caveats.length <= 4` (spec contract).
- One `it()` asserting `key_metrics.length >= 3` and that each metric carries a populated `source` block.

**Fixtures:**

- `refinery/__fixtures__/zori-swfl.sample.json` — realistic SWFL slice (3 ZIPs × 24 months from the existing `data/external/zillow/zori_zip_rent_index.csv`).
- `refinery/__fixtures__/zori-swfl.{bearish,neutral-low,bullish,bullish-caveat,neutral-high}.sample.json` — five band-coverage fixtures.

**Integration (manual, one-shot):**

- Run `npm run ingest:zori-swfl` against live Supabase. Assert: one new `data_lake._tier1_inventory` row + non-zero rowcount in `data_lake.zori_swfl` (target: ~4 MSAs × 70-150 ZIPs × 100+ months = 30k–60k rows).
- Run `npm run refinery rentals-swfl`. Assert: `brains/rentals-swfl.md` exists, `--- OUTPUT ---` block parses as valid JSON, `direction` is one of the four enum values.
- Run `npm run refinery master`. Assert: `brains/master.md` contains `rentals-swfl` in its drivers list (if direction non-neutral) and `upstream_count` incremented by 1.

**Type / suite gates (already enforced by repo):**

- `bun test` full suite passes (current baseline 464+ — verify at session start with `.claude/build-context.md` refresh).
- `pytest` for ingest layer: new tests under `ingest/pipelines/zori_swfl/test_*.py` pass.
- `npm run typecheck` clean.
- `npm run ledger` and `npm run triage` clean (no new orphans — the patterns hook from step 6 prevents per-ZIP slug orphaning).

---

## 7. Out of scope (explicit follow-on backlog)

- **`redfin-swfl` brain** (Mode 1/2/3 polarity per the commit message at `d2f501b`). Separate PR after this lands. Will need its own first-run of the existing Tier 1 pipeline.
- **`home-values-swfl` brain** (ZHVI sibling). Separate PR. Same lane pattern as ZORI.
- **`rentals-swfl` → `cre-swfl` thin pipe** (multifamily NOI signal). Follow-on after `rentals-swfl` has a track record. Requires polarity-asymmetry test for rate-vs-dollar-flow per the cre-swfl lesson.
- **Date-sentinel skip-if-current** on the ingest pipeline. Add when cron-run pain warrants it.
- **County-level rollups** (Lee aggregate, Collier aggregate, etc.). v1 ships ZIP-level + regional median only.
- **Sign/direction consistency guard** (analog of the deferred cre-swfl item) — declined for v1; rent_index is non-negative by construction so the negative-with-rising case can't arise here.

---

## 8. Acceptance criteria (pass/fail, no judgement calls)

1. `data_lake._tier1_inventory` contains a row for `lake-tier1/market/zori_swfl.parquet` with `pack_id = "rentals-swfl"`.
2. `data_lake.zori_swfl` exists, has rows, and `SELECT COUNT(DISTINCT zip_code)` ≥ 20.
3. `brains/rentals-swfl.md` exists, frontmatter validates, `--- OUTPUT ---` JSON parses, `direction` ∈ `{bullish,bearish,neutral,mixed}`.
4. `brains/master.md` regenerates without error and lists `rentals-swfl` in its corpus.
5. `bun test` green (baseline + new tests).
6. `pytest` green (baseline + new ingest tests).
7. `npm run triage` shows zero new orphan concepts (validates the patterns hook from step 6).
8. `npm run typecheck` clean.

---

## 9. Critical file references (reuse — do not re-invent)

| Purpose                                       | File                                                          | Why                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| dlt resource shape (Tier 2 loader)            | `ingest/pipelines/lee_permits/pipeline.py:16-47`              | Most recent dlt-resource pattern with merge-on-PK                                      |
| Multi-column PK merge                         | `ingest/pipelines/usgs/resources.py:162`                      | Closest analog to `(zip_code, period_end)`                                             |
| DuckDB Tier 1 pipeline shape                  | `ingest/duckdb_pipelines/redfin_swfl/pipeline.py`             | End-to-end mirror including S3 config, tmpfile handling, inventory upsert              |
| Tier 1 inventory helper                       | `ingest/lib/tier1_inventory.py`                               | Already exists, reuse `upsert_inventory_row()`                                         |
| Source connector                              | `refinery/sources/permits-source.mts`                         | Phase-1 Explore mapped exact shape                                                     |
| Supabase singleton                            | `refinery/sources/supabase.mts:24-31`                         | Reuse `getSupabase()`                                                                  |
| Pack + outputProducer shape                   | `refinery/packs/permits-swfl.mts`                             | Phase-1 Explore mapped full structure including the `lastSnapshot` singleton pattern   |
| Pack registry insertion markers               | `refinery/packs/index.mts:19-37`                              | `// scaffold:imports` and `// scaffold:entries` markers                                |
| Output type contracts                         | `refinery/types/brain-output.mts:24, 54-70, 103-137, 269-288` | Direction enum, MetricSource shape, Metric shape, ProducerResult shape                 |
| Scaffold tool                                 | `refinery/scaffold.mts`                                       | `--id=rentals-swfl --domain=real-estate --input-brains=`                               |
| Vocab patterns hook                           | `refinery/vocab/patterns.mts`                                 | Glob with single `*`, anchored, no capture groups                                      |
| Master DAG wiring point                       | `refinery/packs/master.mts:241-255`                           | Where the new `{ id, edge_type }` entry goes                                           |
| Test pattern (outputProducer)                 | `refinery/packs/permits-swfl.test.mts:93-131`                 | Fixture-mode beforeAll + locked-enum assertion + per-metric assertion                  |
| Confidence ownership (do NOT set in producer) | `refinery/lib/confidence.mts:227-284`                         | Stage 4 computes; producer's `BrainOutputProducerResult` does not include `confidence` |

---

## 10. Pre-execution housekeeping

1. **Refresh `.claude/build-context.md`** — current content is Lane 2D.1 era (349-test baseline) and is stale per its own header banner. Replace with this session's intake (rentals-swfl v1, current test baseline from `bun test`, scope boundary = this plan).
2. **Copy this plan** to `docs/superpowers/plans/2026-05-23-rentals-swfl/README.md` so it's tracked in the repo alongside prior plans (e.g. `docs/superpowers/plans/2026-05-22-brains-mcp-server-v1/README.md`).
3. **Verify exact ZORI filename** at `files.zillowstatic.com/research/public_csvs/zori/` against the local copy in `data/external/zillow/zori_zip_rent_index.csv`. Likely candidates: `Zip_zori_uc_sfrcondomfr_sm_month.csv` or `Zip_ZORI_AllHomesPlusMultifamily_SSA.csv`. Inspect the local CSV's column structure to disambiguate before hard-coding.
4. **Verify ZORI covers all four SWFL MSAs** by greping the local CSV for `Cape Coral`, `Naples`, `Punta Gorda`, `North Port` in the `Metro` column. If Punta Gorda or North Port are absent, document the gap in the constants file with a comment — don't paper over it.

---

## 11. What was wrong with my earlier draft (recorded for the record)

I pushed back on LB's "lock to dlt" with a claim that "every other brain uses dlt is false for the Tier 2 promotion lane." That claim was wrong. Verification: `ingest/pipelines/lee_permits/pipeline.py:19` uses `write_disposition="merge"`; a repo-wide grep returns 9 of 9 `ingest/pipelines/*` packs using dlt. The dlt lane IS the established Tier 2 loader. LB was directionally right on lock-to-dlt; the only correct fragment of my pushback was that "DuckDB lane handles wide→long Parquet" — that part still stands (it's how the data gets to Tier 1, before dlt picks it up for Tier 2).

LB was also right on the index regression (PK isn't just uniqueness — Postgres auto-creates the underlying index) and on the metro-list-duplication risk. Recorded so the next session inherits the right priors.

**Round-2 corrections (after LB pushback on the locked plan):**

1. **`trust_tier` for ZORI was a deferred decision** ("double-check at code time") inside an otherwise-locked plan. LB called it out as a smell. Verified `pack.mts:30-36` and locked to **tier 3** (private-sector industry aggregator). The earlier "tier 1" placeholder was wrong — Zillow Research is not federal/SEC/NOAA class. Confidence headline will run honest (~0.5-0.6 × freshness) rather than inflated.
2. **Cross-layer Python import** from `ingest/duckdb_pipelines/zori_swfl/` into `ingest/pipelines/zori_swfl/` was unprecedented in the codebase (grep returned zero matches across `ingest/duckdb_pipelines/*`). Replaced with two independent npm scripts chained via `&&`, matching the USGS precedent. Cleaner, no coupling, easier to run either tier in isolation for debugging.
