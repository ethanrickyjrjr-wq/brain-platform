# BLS QCEW Pipeline Design

**Date:** 2026-05-18  
**Status:** Approved  
**Feeds:** `macro-swfl`, `sector-credit` (future)

---

## Goal

Ingest BLS Quarterly Census of Employment and Wages (QCEW) for Florida, Lee County, and Collier County into `data_lake.bls_qcew`. Produce a `labor-swfl-summary` TS source connector that surfaces private-sector wages and employment — the "are salaries going up?" receipt for SWFL brains.

---

## Architecture

```
BLS QCEW JSON API
  (3 area FIPS × 2 quarters)
        ↓
ingest/pipelines/bls_qcew/pipeline.py   (dlt, merge disposition)
        ↓
data_lake.bls_qcew                       (30 rows at steady state)
        ↓
refinery/sources/bls-qcew-source.mts    (Supabase → labor-swfl-summary fragment)
        ↓
macro-swfl / sector-credit packs
```

---

## Ingest Layer

### API

`https://data.bls.gov/cew/data/api/{year}/{qtr}/area/{area_fips}.json`  
No API key required for area-level files.

### Area FIPS

| Scope                    | FIPS    |
| ------------------------ | ------- |
| Florida state (baseline) | `12000` |
| Lee County               | `12071` |
| Collier County           | `12021` |

### Quarter strategy

The pipeline auto-detects the latest available quarter (QCEW lags ~5–6 months) by attempting fetches from current quarter backward until it gets a non-empty response. It then also fetches **that same quarter one year prior** (e.g., Q4-2025 → also Q4-2024). This gives the TS connector exactly the two data points needed for YoY math without storing unbounded history.

### Filter on ingest

Only rows where `industry_code = "10"` (total all industries / all NAICS). Sector-level breakdown is a future ingest if needed (YAGNI).

**All 5 ownership codes are stored** (`own_code` values: 0=Total, 1=Federal, 2=State gov, 3=Local gov, 5=Private). Government wages distort local purchasing power models; the TS connector highlights private-sector (`own_code=5`) separately from total (`own_code=0`).

### Steady-state table size

3 areas × 5 ownership codes × 2 quarters = **30 rows**

### Write disposition

`write_disposition="merge"` with surrogate key `area_fips|own_code|industry_code|size_code|year|qtr`. Re-runs are idempotent.

---

## Table Schema (`data_lake.bls_qcew`)

| Column              | Type      | Notes                                                                 |
| ------------------- | --------- | --------------------------------------------------------------------- |
| `id`                | text PK   | Surrogate: `area_fips\|own_code\|industry_code\|size_code\|year\|qtr` |
| `area_fips`         | text      | e.g. `"12071"`                                                        |
| `own_code`          | text      | `"0"` total, `"5"` private                                            |
| `industry_code`     | text      | Always `"10"`                                                         |
| `agglvl_code`       | text      | BLS aggregation level                                                 |
| `size_code`         | text      | Always `"0"` for area totals                                          |
| `year`              | bigint    | e.g. `2025`                                                           |
| `qtr`               | text      | `"1"`–`"4"`                                                           |
| `area_title`        | text      | Human-readable                                                        |
| `own_title`         | text      | Human-readable                                                        |
| `industry_title`    | text      | `"Total, All Industries"`                                             |
| `qtrly_estabs`      | bigint    | Establishment count                                                   |
| `month1_emplvl`     | bigint    | Month 1 employment                                                    |
| `month2_emplvl`     | bigint    | Month 2 employment                                                    |
| `month3_emplvl`     | bigint    | Month 3 employment (most recent)                                      |
| `total_qtrly_wages` | bigint    | Total wages paid                                                      |
| `avg_wkly_wage`     | bigint    | Average weekly wage (integer, BLS-published)                          |
| `_source_url`       | text      | API URL verbatim                                                      |
| `_ingested_at`      | timestamp | UTC ingest timestamp                                                  |

---

## SQL Grant

```sql
GRANT USAGE ON SCHEMA data_lake TO service_role;  -- idempotent
GRANT SELECT ON data_lake.bls_qcew TO service_role;
```

---

## TS Source Connector

### Live queries

Three **parallel** Supabase queries against `data_lake.bls_qcew`, one per area FIPS, ordered by `year`, `qtr`. Returns all rows (both quarters, all ownership codes) — connector computes the summary.

### Fragment types

**`bls-qcew-record`** — one per raw DB row (preserves individual quarters for consuming packs that want raw).

**`labor-swfl-summary`** — the thin-pipe rollup:

```typescript
{
  kind: "labor-swfl-summary",
  latest_quarter: "2025-Q4",
  prior_quarter: "2024-Q4",
  fl_state: {
    private: {
      avg_wkly_wage: number,
      avg_wkly_wage_yoy_pct: number | null,
      month3_emplvl: number,
      employment_yoy_pct: number | null,
      qtrly_estabs: number,
      total_qtrly_wages: number,
    },
    total: {
      avg_wkly_wage: number,
      month3_emplvl: number,
      qtrly_estabs: number,
    },
  },
  lee_county: { /* same shape */ },
  collier_county: { /* same shape */ },
}
```

YoY deltas: `(latest - prior) / prior × 100`, rounded to 2 decimal places. `null` if prior quarter is not in table.

---

## Files to create

| File                                         | Role                                          |
| -------------------------------------------- | --------------------------------------------- |
| `ingest/pipelines/bls_qcew/__init__.py`      | Package marker                                |
| `ingest/pipelines/bls_qcew/constants.py`     | FIPS codes + base URL                         |
| `ingest/pipelines/bls_qcew/resources.py`     | dlt resource, column hints, merge key         |
| `ingest/pipelines/bls_qcew/pipeline.py`      | Pipeline entry point + quarter auto-detection |
| `docs/sql/bls_qcew_grant.sql`                | GRANT statements                              |
| `refinery/sources/bls-qcew-source.mts`       | TS source connector                           |
| `refinery/__fixtures__/bls-qcew.sample.json` | Fixture for non-live runs                     |

---

## Success test

1. `python -m ingest.pipelines.bls_qcew.pipeline` → 30 rows in `data_lake.bls_qcew`
2. Re-run pipeline → row count stays 30 (merge idempotency confirms surrogate key)
3. `REFINERY_SOURCE=fixture npx tsx refinery/sources/bls-qcew-source.mts` (manual smoke test) → `labor-swfl-summary` fragment printed with non-null YoY fields for FL/Lee/Collier
4. `REFINERY_SOURCE=live` run against real Supabase → same shape, real numbers

Note: no brain pack is created this sprint. The connector is the deliverable. It feeds `macro-swfl` in a subsequent sprint.