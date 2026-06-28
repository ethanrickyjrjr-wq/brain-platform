# Census ACS Ingest Pipeline — Design Spec

**Date:** 2026-05-30  
**Status:** Approved — ready for implementation plan  
**Serves:** Event-study covariate matcher (§7 unit 4 of `2026-05-30-event-study-backfill-design.md`); any future brain or analysis module that needs SWFL demographics

---

## Decision log (brainstorm answers)

| Question         | Decision                                                    | Rationale                                                                               |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Geography grain  | **Both** — Census tracts + ZCTAs in same pipeline           | Tracts for event-study distance matching; ZCTAs for ZIP-keyed brains                    |
| Variable scope   | **Lean cut-1 (8 covariates)** — designed for easy expansion | Only event-study needs are live consumers; expansion is a one-line config change        |
| Storage tier     | **Tier-2 DLT only** (Postgres `data_lake.*`)                | ~185 rows/vintage, annual cadence — DuckDB speed advantage irrelevant at this scale     |
| Brain-first gate | **Not required**                                            | Getting data into the lake is its own valid shipment; consumers declared when they ship |

---

## 1. Pipeline shape

**Location:** `ingest/pipelines/census_acs/pipeline.py`  
**Pattern:** Follows `ingest/pipelines/census_cbp/` exactly — Census API JSON → dlt → Postgres  
**GHA cron:** `census-acs-annual.yml` — December 15th, 10:00 UTC (Census publishes 5-year estimates in December)  
**Auth:** `CENSUS_API_KEY` env var (optional — Census allows unauthenticated at low volume; key bumps rate limit)  
**Dry-run flag:** `--dry-run` prints row count + sample, no write (ships in same PR per pipeline-freshness standard)

Two dlt resources in one pipeline run:

```
census_acs_pipeline
  ├── resource: census_acs_tract   → data_lake.census_acs_tract
  └── resource: census_acs_zcta    → data_lake.census_acs_zcta
```

Coverage: Lee County (FIPS 12071) + Collier County (FIPS 12021).  
Vintage: 5-year ACS (e.g. year=2023 = 2019–2023 estimates). Backfill from 2012 (earliest stable 5-year).

---

## 2. Variable set — cut-1 (8 covariates)

All from 5-year ACS. Variables are declared in a single `VARIABLES` dict — adding a new one is one line.

| Field name                | ACS table                 | Notes                                                                      |
| ------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| `total_population`        | B01003_001E               | Density baseline                                                           |
| `median_household_income` | B19013_001E               | Primary income confounder; NULL when Census suppresses (<sample threshold) |
| `median_age`              | B01002_001E               | Demographics                                                               |
| `owner_occupied_pct`      | B25003_002E / B25003_001E | Derived: owner-occupied ÷ total occupied                                   |
| `moved_in_past_year_pct`  | B07003_004E / B01003_001E | Migration / growth rate proxy                                              |
| `poverty_rate`            | B17001_002E / B17001_001E | Socioeconomic context                                                      |
| `employment_rate`         | B23025_004E / B23025_002E | Labor market baseline (employed ÷ in labor force)                          |
| `avg_household_size`      | B25010_001E               | Household composition                                                      |

Derived fields (pct/rate) are computed in Python before load — no SQL transforms needed downstream.

### Expansion backlog (come back for these)

These are not in cut-1 but are one-line additions to `VARIABLES` when a consuming brain needs them:

- **Race/ethnicity** (B02001, B03002) — equity analysis, investor-profile segmentation
- **Educational attainment** (B15003) — workforce quality signal; useful for corridor character
- **Median home value** (B25077) + **median gross rent** (B25064) — partial substitute for LeePA price gap at tract grain
- **Age distribution buckets** (B01001) — retiree-vs-workforce split; high signal for SWFL corridors
- **Household type / family composition** (B11001) — corridor character voice context

---

## 3. Schema

Both tables share this shape. PK on `(geo_id, acs_year)` — multi-vintage history accumulates without overwriting. Event-study joins on the vintage whose `acs_year` is closest to the pre-period start of each event.

```sql
CREATE TABLE data_lake.census_acs_tract (
  geo_id                    TEXT,           -- 11-digit FIPS tract (e.g. '12071000100')
  geo_name                  TEXT,           -- Human label (e.g. 'Census Tract 1, Lee County, FL')
  county_fips               TEXT,           -- '12071' or '12021'
  acs_year                  INT,            -- Vintage (e.g. 2023 = 2019-2023 5yr)
  total_population          INT,
  median_household_income   INT,            -- dollars; NULL if suppressed
  median_age                NUMERIC(4,1),
  owner_occupied_pct        NUMERIC(5,2),
  moved_in_past_year_pct    NUMERIC(5,2),
  poverty_rate              NUMERIC(5,2),
  employment_rate           NUMERIC(5,2),
  avg_household_size        NUMERIC(4,2),
  inserted_at               TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (geo_id, acs_year)
);

-- census_acs_zcta: identical columns; geo_id is 5-digit ZCTA (e.g. '34102')
```

`inserted_at` is the freshness signal for `/ops` pipeline monitoring (same pattern as `fl_dor_sales_tax`).

---

## 4. Error handling

- **Census suppression** (small-population tracts): cells with `NULL` or `-666666666` (Census sentinel) → store as `NULL`, not zero. Downstream consumers must handle nulls.
- **API rate limit**: Census free tier is ~500 req/day; key tier is higher. The pipeline makes one request per variable group per geography type — well within limits for Lee + Collier.
- **Missing vintage**: if Census hasn't published the target year yet, pipeline logs a warning and exits cleanly without writing (idempotent).

---

## 5. Testing

- `--dry-run` smoke test: confirms API reachable, returns > 0 rows for Lee tracts
- Row-count assertion: Lee County has ~100 tracts, Collier ~60; ZCTA count ~125. Pipeline fails if count is suspiciously low (< 50 tracts or < 100 ZCTAs)
- Sentinel-value check: no `-666666666` values land in the table
- Derived-field bounds: pct fields in [0, 100], avg_household_size in [0, 10]

---

## 6. Files to create

```
ingest/pipelines/census_acs/
  __init__.py
  pipeline.py          -- main dlt pipeline (two resources)
  resources.py         -- Census API fetch + field derivation
  test_pipeline.py     -- dry-run + row-count + bounds tests
.github/workflows/
  census-acs-annual.yml  -- December 15 cron + --dry-run gate
```

No new Supabase tables needed beyond the `CREATE TABLE` migrations above (idempotent `IF NOT EXISTS`).

---

## 7. Out of scope (this sprint)

- Census ACS refinery brain pack (demographics brain) — expansion variable notes above are the stub
- ZCTAs outside Lee + Collier
- 1-year ACS estimates (less stable at small geographies, not needed for covariates)
- Geometry / spatial join (tracts have geometry via TIGER/Line shapefiles — a future Tier-1 add if needed)
