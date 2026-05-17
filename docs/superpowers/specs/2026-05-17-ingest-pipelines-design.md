# Ingest Pipelines Design — FEMA, LeePA, FDOT, Census CBP + macro-florida CBP Source

**Date:** 2026-05-17 (revised after Data Tier Policy locked)
**Status:** Approved — proceed to implementation
**Commit baseline:** `8808869` (logistics-swfl shipped, macro-florida exists as FRED placeholder)

---

## What Changed from First Draft

The original spec routed all 5 pipelines to Postgres `data_lake.*`. The Data Tier Policy (locked same day, see CLAUDE.md + `docs/API_BLUEPRINTS.md`) changes this:

- Only data with a **consuming brain shipping in the same PR** goes to Tier 2 Postgres.
- Everything else goes to **Tier 1 Supabase Storage** as compressed CSV.gz/GeoJSON.gz + a pointer row in `data_lake._tier1_inventory`.
- FDOT AADT is **transportation/logistics data** → `logistics-swfl v2` (future sprint), not `macro-florida`. Assigning it here was an inference error; corrected.

---

## Architecture: Data Tier Policy

```
Is there a brain shipping THIS sprint that reads this data?
  YES → Tier 2: Postgres data_lake.*     (census_cbp only)
  NO  → Tier 1: Supabase Storage bucket  (fdot, fema, leepa)
```

**Cost rationale:** Postgres costs ~6× Storage. A 50 GB dump is $1.05/mo in Tier 1 vs $6.25/mo in Tier 2.

**"Ingest Broad, Filter Local":** Pipelines ingest statewide (all FL counties, not just Lee/Collier). SWFL-specific filtering lives in the brain, not the pipeline.

---

## Tier Assignment

| Pipeline           | Tier             | Storage target                       | Consuming brain             | When        |
| ------------------ | ---------------- | ------------------------------------ | --------------------------- | ----------- |
| `census_cbp`       | **2 — Postgres** | `data_lake.census_cbp`               | `macro-florida`             | This sprint |
| `fdot_aadt`        | **1 — Storage**  | `raw-tabular-cold/fdot_aadt/`        | `logistics-swfl v2`         | Future      |
| `fema_flood_zones` | **1 — Storage**  | `raw-geometry/fema/flood_zones/`     | `env-swfl v2`               | Future      |
| `fema_lomr`        | **1 — Storage**  | `raw-geometry/fema/lomr/`            | `env-swfl v2`               | Future      |
| `fema_loma`        | **1 — Storage**  | `raw-geometry/fema/loma/`            | `env-swfl v2`               | Future      |
| `fema_bfe`         | **1 — Storage**  | `raw-geometry/fema/bfe/`             | `env-swfl v2`               | Future      |
| `fema_nfip_claims` | **1 — Storage**  | `raw-tabular-cold/fema/nfip_claims/` | Future                      | Future      |
| `leepa_parcels`    | **1 — Storage**  | `raw-tabular-cold/leepa/parcels/`    | `cre-swfl v2`               | Future      |
| `leepa_sales`      | **1 — Storage**  | `raw-tabular-cold/leepa/sales/`      | `cre-swfl v2`               | Future      |
| `faf_flows`        | Already Tier 2   | `data_lake.faf_flows`                | `logistics-swfl` ✅ shipped | Done        |

---

## Directory Structure

The existing `ingest/pipelines/faf5/` tree is **untouched**.

```
ingest/
  lib/                            ← NEW
    __init__.py
    arcgis_paginator.py           ← sync ArcGIS REST paginator, yields GeoJSON Feature dicts
    geo_utils.py                  ← FL bbox/FIPS constants + geometry_hash()
    storage_uploader.py           ← NEW: Supabase Storage REST upload + _tier1_inventory pointer
  pipelines/
    faf5/                         ← UNCHANGED
    fema/                         ← NEW (Tier 1)
      __init__.py
      pipeline.py
      resources.py                ← writes CSV.gz/GeoJSON.gz to Storage + inventory pointer
      constants.py
    leepa/                        ← NEW (Tier 1)
      __init__.py
      pipeline.py
      resources.py
      constants.py
    fdot/                         ← NEW (Tier 1)
      __init__.py
      pipeline.py
      resources.py
      constants.py
    census_cbp/                   ← NEW (Tier 2 Postgres)
      __init__.py
      pipeline.py
      resources.py                ← dlt postgres, merge disposition
      constants.py
  tests/
    pipelines/
      faf5/                       ← UNCHANGED
      fema/                       ← NEW
      leepa/                      ← NEW
      fdot/                       ← NEW
      census_cbp/                 ← NEW
  .env.example                    ← NEW
```

---

## Shared Library

### `lib/arcgis_paginator.py`

```python
def paginate_arcgis(base_url, where="1=1", out_fields="*", bbox=None, page_size=2000):
    """Sync generator. Yields GeoJSON Feature dicts. Retries 3x on 5xx."""
```

- Adds `geometry`, `geometryType=esriGeometryEnvelope`, `inSR=4326`, `outSR=4326`, `f=geojson`
- Increments `resultOffset` until `features` list is empty or returns fewer than `page_size`
- Raises on non-recoverable HTTP errors after 3 retries

### `lib/geo_utils.py`

```python
FL_BBOX = (-87.6, 24.4, -79.9, 31.0)           # all of Florida
LEE_COUNTY_BBOX = (-82.4, 26.3, -81.5, 26.8)   # Lee County only (downstream filter example)
FL_FIPS_STATE = "12"

def geometry_hash(geojson_geometry: dict) -> str:
    """md5 of stable JSON serialization — stable natural key component."""
```

### `lib/storage_uploader.py`

Handles Tier 1 writes. Two responsibilities:

1. **Upload to Supabase Storage** — POST to `/storage/v1/object/{bucket}/{path}` using `requests` + `BRAINS_SUPABASE_URL` + `BRAINS_SUPABASE_SERVICE_KEY` from env.
2. **Write inventory pointer** — inserts/upserts one row into `data_lake._tier1_inventory` via dlt postgres.

```python
def upload_csv_gz(bucket: str, object_path: str, rows: list[dict], fieldnames: list[str]) -> str:
    """Writes rows as CSV.gz, uploads to Supabase Storage, returns public path."""

def write_tier1_pointer(pipeline, table_name: str, bucket: str, object_path: str,
                        row_count: int, source_url: str) -> None:
    """Upserts inventory row into data_lake._tier1_inventory via dlt postgres."""
```

Inventory row schema:

```
table_name TEXT, bucket TEXT, object_path TEXT, row_count INT,
source_url TEXT, ingested_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ
```

---

## Tier 2 Pipeline: `census_cbp`

### Endpoint

```
https://api.census.gov/data/{year}/cbp
?get=NAICS2022,NAICS2022_LABEL,ESTAB,EMP,PAYANN,NAME
&for=county:*
&in=state:12
&key={CENSUS_API_KEY}
```

- **All FL counties** (`for=county:*&in=state:12`) — Ingest Broad, Filter Local
- Loop years 2017–2022 (6 runs per pipeline execution)
- Response is array-of-arrays; first row = headers; add `year` + `fips_state` + `fips_county` to each row

### dlt config

```python
pipeline = dlt.pipeline(pipeline_name="census_cbp", destination="postgres", dataset_name="data_lake")
```

- `write_disposition="merge"`
- Natural key: `naics_code` + `year` + `fips_state` + `fips_county`
- All data fields stored; no geometry

### Key fields

`naics_code`, `naics_label`, `county_name`, `establishment_count`, `employment`, `annual_payroll`, `year`, `fips_state`, `fips_county`, `ingested_at`

---

## Tier 1 Pipeline: `fema`

### Endpoints

| Resource              | Layer | URL                                                                            |
| --------------------- | ----- | ------------------------------------------------------------------------------ |
| Flood Hazard Zones    | 28    | `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query` |
| LOMRs                 | 1     | `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/1/query`  |
| LOMAs                 | 34    | `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/34/query` |
| Base Flood Elevations | 16    | `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/16/query` |

**OpenFEMA Claims** (`https://www.fema.gov/api/open/v1/FimaNfipClaims`, OData pagination)

### Tier 1 write pattern

- For NFHL layers: write GeoJSON.gz per layer to `raw-geometry/fema/{layer}/YYYY-MM-DD.geojson.gz`
- For Claims (tabular): write CSV.gz to `raw-tabular-cold/fema/nfip_claims/YYYY-MM-DD.csv.gz`
- Write inventory pointer row per file

**Bbox:** `FL_BBOX` (all of Florida) — includes the 26.2–26.7 gap that was missing in partial Lee County ingests.

---

## Tier 1 Pipeline: `leepa`

### Endpoint

`https://gissvr.leepa.org/gissvr/rest/services/ParcelInfo/MapServer/0/query` (ArcGIS REST)

### Tier 1 write pattern

- Write parcel GeoJSON as compressed `raw-tabular-cold/leepa/parcels/YYYY-MM-DD.geojson.gz`
- Write inventory pointer row

**Note:** LeePA is a county assessor — already scoped to Lee County. Ingest all parcels; no bbox filter needed.

---

## Tier 1 Pipeline: `fdot`

### Endpoint

`https://gis.fdot.gov/arcgis/rest/services/FTO/fto_PROD/MapServer/7/query` (ArcGIS REST, `where=1=1`)

### Tier 1 write pattern

- Write CSV.gz to `raw-tabular-cold/fdot_aadt/YYYY-MM-DD.csv.gz`
- Write inventory pointer row

**All FL stations** — `logistics-swfl v2` will filter SWFL corridors downstream per `[[data-tier-policy]]` Rule 4.

---

## TS Refinery: `macro-florida` CBP Extension

`macro-florida` already exists at `refinery/packs/macro-florida.mts`. The source file comment explicitly declares CBP as a "Future extension." This sprint delivers it.

### New file: `refinery/sources/macro-florida-cbp-source.mts`

```typescript
// Queries data_lake.census_cbp via Supabase client.
// Aggregates all FL counties → FL-state totals by NAICS sector.
// Returns typed fragments with kind: "fl-cbp-aggregate".
// Trust tier: 1 (Census Bureau is authoritative).
```

Supabase query:

```sql
SELECT naics_code, naics_label,
       SUM(establishment_count) AS fl_establishments,
       SUM(employment) AS fl_employment,
       SUM(annual_payroll) AS fl_annual_payroll,
       year
FROM data_lake.census_cbp
WHERE fips_state = '12' AND year = (SELECT MAX(year) FROM data_lake.census_cbp WHERE fips_state = '12')
GROUP BY naics_code, naics_label, year
ORDER BY fl_establishments DESC
```

Returns one fragment per NAICS sector. The fragment carries `fl_establishments`, `fl_employment`, `fl_annual_payroll`, `year`, `naics_code`, `naics_label`.

### New fixture: `refinery/__fixtures__/macro-florida-cbp.sample.json`

A minimal fixture with ~10 representative NAICS sectors at plausible FL-state counts.

### Updates to `refinery/packs/macro-florida.mts`

- Add `macroFloridaCbpSource` to `sources` array
- Extend `corpusSummary` to emit CBP facts (`topic: "fl_cbp_sector:*"`)
- Extend `outputProducer` to add CBP metrics to `key_metrics`
- Extend `METRIC_MAP` for top CBP sectors (e.g., `fl_estab_count_retail`, `fl_estab_count_food_service`, etc.)
- **No changes to FLUR/LBSSA12 path** — additive only

---

## Wiring Changes

### `package.json` — append to `scripts`:

```json
"ingest:faf5":  "cd ingest && python -m pipelines.faf5.pipeline",
"ingest:fema":  "cd ingest && python -m pipelines.fema.pipeline",
"ingest:leepa": "cd ingest && python -m pipelines.leepa.pipeline",
"ingest:fdot":  "cd ingest && python -m pipelines.fdot.pipeline",
"ingest:cbp":   "cd ingest && python -m pipelines.census_cbp.pipeline",
"ingest:all":   "npm run ingest:fema && npm run ingest:leepa && npm run ingest:fdot && npm run ingest:cbp"
```

### `.dlt/config.toml` — append:

```toml
[pipeline.census_cbp]
pipeline_name = "census_cbp"
dataset_name  = "data_lake"
```

`fema`, `leepa`, `fdot` pipelines use `.dlt/config.toml` only for the `_tier1_inventory` pointer write (same Postgres credentials). Their main output goes to Supabase Storage.

### `ingest/.env.example` — new file:

```
DESTINATION__POSTGRES__CREDENTIALS=postgresql://postgres:xxx@db.xxx.supabase.co:5432/postgres
BRAINS_SUPABASE_URL=https://xxx.supabase.co
BRAINS_SUPABASE_SERVICE_KEY=xxx
CENSUS_API_KEY=xxx
```

### `ingest/requirements.txt` — no additions (geopandas excluded; Storage uploads use `requests`).

---

## Testing Strategy

Same pattern as FAF5:

- Tier 2 (`census_cbp`): mock `requests.get` for the Census API; test field coercion, year loop, natural key generation
- Tier 1 (`fema`, `leepa`, `fdot`): mock the paginator + the Storage upload; test that `upload_csv_gz` is called with correct bucket/path; test inventory pointer row shape
- `geometry_hash()`: deterministic on same input, different on changed coordinates
- `macro-florida-cbp-source.mts`: fixture mode returns typed fragments; live mode queries Supabase correctly

---

## Scope Boundaries

**In scope this sprint:**

- Python: `census_cbp` (Tier 2) + `fema`/`leepa`/`fdot` (Tier 1) + shared `lib/`
- TS: `macro-florida-cbp-source.mts` + update `macro-florida.mts` + CBP fixture

**Out of scope:**

- FDOT → `logistics-swfl v2` (future sprint; `logistics-swfl.mts` already has the comment reserving this slot)
- FEMA Postgres ingestion → `env-swfl v2` (env-swfl currently reads live FEMA API)
- LeePA Postgres ingestion → `cre-swfl v2`
- TS refinery Stage 1 wiring for `census_cbp` beyond `macro-florida-cbp-source.mts`
- `macro-us` or `macro-swfl` changes (no scope expansion)

---

## Co-existence Guarantee

- `ingest/pipelines/faf5/` — zero file changes
- `.dlt/config.toml` — append-only (FAF5 section preserved)
- `ingest/requirements.txt` — no additions
- `package.json` — append-only to `scripts`
- `macro-florida.mts` — additive only (FLUR/LBSSA12 path untouched)
- `macro-us.mts`, `macro-swfl.mts`, `logistics-swfl.mts` — zero changes

---

## Post-Ingestion Validation

```sql
-- Census CBP: FL coverage check
SELECT year, COUNT(DISTINCT naics_code) AS sectors,
       COUNT(DISTINCT fips_county) AS counties
FROM data_lake.census_cbp WHERE fips_state = '12'
GROUP BY year ORDER BY year;

-- _tier1_inventory: confirm all Tier 1 pipelines wrote pointers
SELECT table_name, bucket, row_count, ingested_at
FROM data_lake._tier1_inventory
ORDER BY ingested_at DESC;

-- Unblock macro-florida live mode (run once in Supabase SQL editor after census_cbp pipeline completes)
GRANT SELECT ON data_lake.census_cbp TO service_role;
```
