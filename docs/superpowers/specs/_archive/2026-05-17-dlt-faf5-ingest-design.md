# dlt FAF5 Ingest Pipeline — Design Spec

**Date:** 2026-05-17
**Status:** Approved
**Author:** Ricky Cooper + Claude

---

## Problem

The brain-platform refinery needs freight flow data (FAF5) in Supabase so the logistics brain can query real volumes without embedding hardcoded lookups. The TypeScript refinery must not own the ingestion logic — ingest is a separate Python process that writes to the data lake; TS only reads.

---

## Decision: Option B — Multi-Resource dlt Pipeline

Three dlt resources from one pipeline run:

| Resource          | Table                       | Write disposition |
| ----------------- | --------------------------- | ----------------- |
| `faf_flows`       | `data_lake.faf_flows`       | `replace`         |
| `faf_zone_lookup` | `data_lake.faf_zone_lookup` | `replace`         |
| `faf_sctg_lookup` | `data_lake.faf_sctg_lookup` | `replace`         |

**Why replace, not merge:** FAF5 releases as a full-dataset annual replacement. There are no incremental patches. `replace` rebuilds the three tables atomically on each run — correct behavior for this source.

**Why three resources, not one:** The TS brain JOINs zone names and commodity names against lookup tables. Embedding those as hardcoded constants in TypeScript violates the thin-pipe contract and creates drift when FAF5 revises zone boundaries.

---

## Architecture

```
ingest/                         # standalone Python package — NO imports from refinery/ or src/
  pipelines/
    faf5/
      __init__.py
      pipeline.py               # dlt pipeline entry point, CLI: python -m ingest.pipelines.faf5.pipeline
      resources.py              # three @dlt.resource functions
      constants.py              # FL zone list, SCTG codes, FAF5 download URL
  .dlt/
    secrets.toml                # [destination.postgres.credentials] — gitignored
    config.toml                 # pipeline_name = "faf5", dataset_name = "data_lake"
  requirements.txt              # dlt[postgres], requests
  .gitignore                    # .dlt/secrets.toml
```

**Hard boundary:** `ingest/` is a standalone Python project. It never imports from `refinery/`, `src/`, or any TypeScript-adjacent module. It reads from external sources and writes to Supabase Postgres via dlt. That is its entire job.

---

## Source

- **Name:** FAF5 (Freight Analysis Framework v5), published by ORNL for FHWA
- **URL:** `https://faf.ornl.gov/faf5/` — bulk CSV/ZIP download, no API key, no auth
- **Specific file:** FAF5 regional database CSV (latest vintage, currently 5.5.1)
- **Update cadence:** Annual. Re-run the pipeline when ORNL publishes a new vintage.

---

## Ingest Rule (from API_BLUEPRINTS.md)

> **Ingest broad, filter downstream.** The pipeline ingests all FL-zone rows (`dms_orig` OR `dms_dest` in `{121, 122, 123, 124, 129}`). SWFL-specific filtering (`dms_dest = 129`, `trade_type = 1`) is handled by the brain, not the pipeline.

---

## Resource Specs

### `faf_flows`

Yields one dict per CSV row where `dms_orig` or `dms_dest` is a FL zone.

Key columns:

- `dms_orig` (int) — origin FAF zone
- `dms_dest` (int) — destination FAF zone
- `sctg2` (int) — SCTG commodity class (2-digit)
- `trade_type` (int) — 1=domestic, 2=imports, 3=exports
- `tons_YYYY` (float) — freight volume in thousands of tons (historical + projected years)
- `value_YYYY` (float) — freight value in millions of dollars
- `tmiles_YYYY` (float) — ton-miles

Column types enforced via dlt `columns=` parameter before Postgres write — no silent string coercion.

### `faf_zone_lookup`

Static reference table, hardcoded in `constants.py`. All FAF5 zones (not just FL) so future brains can look up any origin.

Columns: `zone_id` (int, PK), `zone_name` (text), `state_abbr` (text)

### `faf_sctg_lookup`

All 43 SCTG 2-digit commodity codes, hardcoded in `constants.py`.

Columns: `sctg_code` (int, PK), `commodity_name` (text)

---

## Secrets Wiring

User drops Supabase connection string into `.dlt/secrets.toml`:

```toml
[destination.postgres.credentials]
database = "postgres"
username = "postgres"
password = "<service_role_password>"
host = "<project>.supabase.co"
port = 5432
```

dlt resolves this automatically — no `os.environ` calls, no custom loader.

---

## Run

```bash
cd ingest
python -m ingest.pipelines.faf5.pipeline
```

Prints dlt load summary on completion. On first run, creates the three tables. On subsequent runs, `replace` disposition rebuilds them.

---

## Non-Goals (v1)

- No scheduler — manual run or annual cron outside this repo
- No Census ACS block group pipeline (separate spec, needs vintage + table scoping)
- No incremental/merge logic — FAF5 doesn't need it
- No TypeScript integration layer — TS brain reads from `data_lake.*` tables directly via Supabase client
