# DuckDB-on-Parquet Query Layer + NOAA Storm-History Pilot Design

**Date:** 2026-05-18
**Status:** Approved (Ricky, brainstorming session)
**Pilot pack:** `storm-history-swfl` (new, leaf)
**Touches:** zero shipped brains, zero existing dlt pipelines

---

## Lineage

This spec exists because of a mid-session reframe. LB pitched a "switch to DuckDB" rip-and-replace of the dlt ingest layer. Ricky pushed for clarity. Audit found the framing was wrong: dlt and DuckDB are not competitors — dlt is extract+load, DuckDB is an analytical query engine. They are complementary and the locked Data Tier Policy (commits `d8dc4fd` / `1266072`) was already pointing at exactly this hybrid. What was missing was the **query side** of Tier 1 — Parquet files in Storage were inert because nothing in the refinery could read them. This spec wires that side and proves it end-to-end through one new pack.

LB's NOAA Storm Events dataset suggestion survived the audit. His "Python brain class" code shape did not — the refinery is TypeScript and packs are `PackDefinition` exports, not classes.

---

## Goal

Ship one new brain (`storm-history-swfl`) end-to-end through a new ingest+query path that:

1. Uses DuckDB as the ingest tool (no dlt for this lane).
2. Lands Parquet in Supabase Storage (Tier 1, not Tier 2 Postgres).
3. Renders the brain by reading that Parquet via a new TS `DuckDBParquetSource` connector.

Outcome: the team has a working template for future scale-out / speculative datasets that does not bill against Postgres bytes-per-month.

---

## Non-Goals (Explicit)

- **Not** migrating any of the 8 existing dlt pipelines (faf5, fema, leepa, fdot, fhfa, usgs, census_cbp, bls_qcew). They stay exactly as they are.
- **Not** modifying any shipped brain (`env-swfl`, `master`, `properties-lee-value`, `logistics-swfl`, `logistics-swfl-nowcast`, `traffic-swfl`, `macro-*`, `cre-swfl`, `tourism-tdt`).
- **Not** removing dlt from the toolbox. dlt remains canonical for Tier 2 hot brain-critical ingest.
- **Not** building a UI, dashboard, or API surface.
- **Not** rewriting the refinery in Python. Packs are TypeScript.
- **Not** wiring `storm-history-swfl` as an upstream of `env-swfl` in this PR. That happens in a follow-up after this pattern is proven.
- **Not** ingesting all 50 states. SWFL counties only (Lee/Collier/Charlotte).

---

## Architecture

### Three lanes — match the tool to the workload

| Lane                                  | Tool            | Destination                                       | When to use                                                                        |
| ------------------------------------- | --------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Hot, low-volume, brain-critical**   | dlt             | Tier 2 Postgres `data_lake.*`                     | Brain reads every refinery run; fits comfortably in Postgres; tight feedback loop. |
| **Cold, high-volume, brain-eventual** | DuckDB-as-ETL   | Tier 1 Parquet in Supabase Storage                | Speculative bulk data; brains read on-demand via DuckDB-over-Parquet.              |
| **Promoted baselines**                | refinery itself | Tier 3 Postgres (`intelligence.*`, `published.*`) | Brain-validated outputs published downstream.                                      |

This pilot exercises the middle lane end-to-end.

### Data flow (this pilot)

```
NOAA NCEI (https gzip CSV, ~30 years)
        ↓
ingest/duckdb_pipelines/storm_history_swfl/pipeline.py   (DuckDB COPY ... TO 's3://...')
        ↓
lake-tier1/environmental/storm_events_swfl.parquet       (Supabase Storage, ZSTD-compressed)
        ↓                       (pointer row → data_lake._tier1_inventory)
refinery/sources/duckdb-parquet-source.mts               (@duckdb/node-api + httpfs)
        ↓
refinery/packs/storm-history-swfl.mts                    (leaf pack, no input_brains)
        ↓
brains/storm-history-swfl.md                             (rendered output)
```

---

## Tier 1 Ingest Layer — DuckDB Only

### Repo location

`ingest/duckdb_pipelines/{id}/pipeline.py` — sibling to `ingest/pipelines/` (the dlt lane). The two trees are independent; nothing crosses.

### Pattern

```python
# ingest/duckdb_pipelines/storm_history_swfl/pipeline.py
import os
import duckdb

NOAA_URL_TMPL = (
    "https://www.ncei.noaa.gov/data/storm-events/csvfiles/"
    "StormEvents_details-ftp_v1.0_d{1996..2025}_*.csv.gz"
)
BUCKET = "lake-tier1"
PATH = "environmental/storm_events_swfl.parquet"
TARGET = f"s3://{BUCKET}/{PATH}"
VINTAGE = "1996-2025"
PACK_ID = "storm-history-swfl"

def run() -> None:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute(f"""
        SET s3_endpoint='{os.environ["SUPABASE_S3_ENDPOINT"]}';
        SET s3_access_key_id='{os.environ["SUPABASE_S3_ACCESS_KEY_ID"]}';
        SET s3_secret_access_key='{os.environ["SUPABASE_S3_SECRET_ACCESS_KEY"]}';
        SET s3_url_style='path';
        SET s3_use_ssl=true;
    """)
    con.execute(f"""
        COPY (
            SELECT * FROM read_csv_auto(
                '{NOAA_URL_TMPL}',
                union_by_name=true, ignore_errors=true
            )
            WHERE state = 'FLORIDA'
              AND cz_name IN ('LEE','COLLIER','CHARLOTTE')
        ) TO '{TARGET}' (FORMAT PARQUET, COMPRESSION ZSTD);
    """)
    # Pointer row → data_lake._tier1_inventory (Tier 1 audit-trail rule §2)
    _upsert_inventory(bucket=BUCKET, path=PATH, vintage=VINTAGE,
                      pack_id=PACK_ID, source_url=NOAA_URL_TMPL)

if __name__ == "__main__":
    run()
```

`_upsert_inventory()` lives in `ingest/lib/tier1_inventory.py` (created in this PR) — a thin helper that writes one row to `data_lake._tier1_inventory` via the existing Supabase Postgres connection. Same credential file (`.dlt/secrets.toml`) the dlt pipelines already use; no new auth surface.

### Why no dlt for this lane

- The transform is one SQL statement. dlt's value-add (incremental loads, schema evolution into a relational destination, normalization to nested tables) does not apply when the destination is a flat columnar Parquet file.
- DuckDB reads gzip CSVs over https with httpfs natively. No download-and-parse step.
- Output is immutable per-vintage. No merge logic to write.

### Idempotency

Pipeline is `replace` semantics — re-running writes the same Parquet file at the same path, atomically (DuckDB writes to temp then renames via S3 PUT). New vintage = new file (e.g., `storm_events_swfl_2026.parquet`) by convention, not in scope this PR.

---

## Storage Layout

### Bucket

`lake-tier1` — new private Supabase Storage bucket. Created via Supabase dashboard or SQL. Access: `service_role` only.

### Path convention

```
lake-tier1/
  environmental/storm_events_swfl.parquet     ← this PR
  demographics/                                ← future
  logistics/                                   ← future
  finance/                                     ← future
```

Top-level segments mirror `BrainDomain` values. One file per dataset-vintage. No nested partitioning yet (YAGNI — Parquet's internal columnar layout is partitioning enough at this scale).

### Pointer table

```sql
-- Created in this PR
CREATE TABLE data_lake._tier1_inventory (
    id           text PRIMARY KEY,        -- {bucket}/{path}
    bucket       text NOT NULL,
    path         text NOT NULL,
    vintage      text,                    -- free-form (e.g. "1996-2025", "2024-Q4")
    byte_size    bigint,
    pack_id      text,                    -- which pack consumes this (null if none yet)
    source_url   text,                    -- original upstream URL pattern
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON data_lake._tier1_inventory TO service_role;
```

The pipeline writes one row per Parquet file it produces. The pointer is the audit trail required by Data Tier Policy rule §2 (every Tier 1 file has a tracking row).

---

## Brain Source Connector

### New module

`refinery/sources/duckdb-parquet-source.mts`

### Dependencies

- `@duckdb/node-api` — official DuckDB Node binding. Runs in-process inside the Node refinery; no extra service, no daemon.
- httpfs extension auto-loaded on connection.

### Shape

Factory matching existing source connector interface:

```typescript
export function makeDuckDBParquetSource(opts: {
  id: string; // source connector id, e.g. "noaa-storm-events"
  bucket: string; // "lake-tier1"
  path: string; // "environmental/storm_events_swfl.parquet"
  query: string; // SQL run against the parquet file (aliased as `t`)
  trust_tier: TrustTier; // per data tier policy
  citation_url?: string; // upstream attribution
}): SourceConnector;
```

The `query` parameter is the per-pack analytical SQL — e.g.:

```sql
SELECT
  count(*)                                                  AS storm_count_30yr,
  count(*) FILTER (WHERE event_type LIKE '%Hurricane%')     AS hurricane_count,
  max(begin_date_time)                                      AS last_major_storm_date,
  ...
FROM t
WHERE begin_yearmonth >= 199601
```

The connector handles the boilerplate: load httpfs, set S3 creds, register the Parquet file as view `t`, run the query, return rows in the same shape `SupabaseSource` returns.

### Local cache

`~/.brain-cache/parquet/{bucket}/{path}` — first call downloads the Parquet file to local disk (DuckDB reads local files at full speed). Subsequent calls within the same vintage hit the cache. Invalidation key: Parquet file's `last_modified` from Storage HEAD request. (Implementation detail; not exposed in factory API.)

### Test

Fixture mode (`REFINERY_SOURCE=fixture`) reads a tiny checked-in Parquet fixture from `refinery/__fixtures__/storm-history-swfl.sample.parquet`. Live mode hits Storage.

---

## Pilot Pack — `storm-history-swfl`

### File

`refinery/packs/storm-history-swfl.mts`

### Definition

| Field             | Value                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `id`              | `storm-history-swfl`                                                                            |
| `domain`          | `environmental`                                                                                 |
| `input_brains`    | `[]`                                                                                            |
| `freshness_token` | `STORM-HIST-SWFL-v1-20260518` (or current ingest date)                                          |
| `sources`         | One `makeDuckDBParquetSource(...)` reading `lake-tier1/environmental/storm_events_swfl.parquet` |
| `outputProducer`  | Deterministic function over source rows — see metrics below                                     |

### Output metrics — risk-framed, not meteorology-trivia

These metrics are chosen so the pack can feed `env-swfl` (insurance/structural risk lens) without restating raw weather counts. Total storm count is kept as a denominator for rate math but is not the headline.

```typescript
{
  conclusion: string,                          // one-line LLM-prose summary
  confidence: number,                          // deterministic per spec
  key_metrics: {
    // Risk-framed headline metrics
    property_damage_events_10yr: number,       // count where damage_property > $0
    extreme_wind_events_10yr: number,          // count where magnitude >= 74 mph (hurricane threshold)
    major_storm_count_30yr: number,            // count where event_type IN ('Hurricane','Tornado','Flash Flood','Storm Surge/Tide') AND damage_property > $1M
    last_billion_dollar_event_date: string,    // ISO date of most recent event with damage_property >= $1B (likely Ian, 2022-09-28)
    last_billion_dollar_event_type: string,
    // Denominator + scope
    total_storm_count_30yr: number,            // raw count for rate computation
    counties_covered: string[],                // ["Lee","Collier","Charlotte"]
    ingest_vintage: string                     // "1996-2025"
  },
  caveats: string[]                            // "Pre-1996 records excluded due to schema drift", "damage_property pre-2007 stored as string ('1.5M') and parsed best-effort", etc.
}
```

**Known wrinkle:** NOAA's `damage_property` column is stored as a string (`"1.5M"`, `"10K"`, `"500"`) in pre-2007 records and as a numeric in modern records. The `outputProducer` includes a normalizer that converts `K`/`M`/`B` suffixes to floats. Records that don't parse cleanly are excluded from damage-based metrics (counted in `total_storm_count_30yr` only) and the count of skipped rows is surfaced as a caveat.

### Vocab

New SKOS concepts for each `key_metrics` field. Registered through whatever the current vocab-registration path is at implementation time (see `refinery/tools/semantic-ledger.mts` registration list and the `vocab/` directory; the recent `9c1c7bc` commit shows the pattern of registering N concepts + re-rendering the DAG). Implementation plan will pin the exact mechanism after a 1-file read.

### Future-not-now

`env-swfl` picks up `storm-history-swfl` as a thin-pipe upstream in a follow-up PR. Out of scope here.

---

## Local Dev / Install

### Python (ingest side)

Add to `ingest/requirements.txt`:

```
duckdb>=1.1
```

### Node (refinery side)

Add to root `package.json`:

```json
"@duckdb/node-api": "^1.1.0"
```

### Environment variables

Add to `.env.local` (gitignored):

```
SUPABASE_S3_ENDPOINT=https://jtkdowmrjaxfvwmemxso.supabase.co/storage/v1/s3
SUPABASE_S3_ACCESS_KEY_ID=<from Supabase dashboard → Project Settings → S3 access keys>
SUPABASE_S3_SECRET_ACCESS_KEY=<from Supabase dashboard>
```

Supabase issues S3-compatible credentials per project via dashboard. These are distinct from the service role JWT and from the direct Postgres credentials.

### Bucket creation

One-time setup, via Supabase dashboard:

1. Storage → New bucket → name `lake-tier1`, **private**.
2. Confirm only `service_role` has read; no anon access.

---

## Success Criteria

All six must be true on the same commit:

1. `python -m ingest.duckdb_pipelines.storm_history_swfl.pipeline` runs to completion and produces a Parquet file in `lake-tier1/environmental/storm_events_swfl.parquet`.
2. `data_lake._tier1_inventory` contains a row pointing at that file with non-null `byte_size`, `vintage`, `pack_id='storm-history-swfl'`, `source_url`.
3. `REFINERY_SOURCE=live npm run refinery storm-history-swfl` renders `brains/storm-history-swfl.md` with real NOAA-derived `key_metrics`.
4. Master DAG resolves with **12** input brains (was 11). `npm run refinery master --no-strict` succeeds.
5. **No existing brain re-render breaks.** Targeted re-render of `master` (DAG resolution canary) and `env-swfl` (most likely future consumer) produces byte-identical output. Verified via `npm run refinery master` + `npm run refinery env-swfl` + `git diff brains/master.md brains/env-swfl.md` (no diff). Full-DAG re-render is intentionally NOT a gate — Tier 2 source flakiness (e.g. LeePA ArcGIS maintenance windows, current FAF5 issues) would create false negatives for the pilot. Broader re-render is a separate verification step after this lands.
6. Parquet file is **<50 MB** on disk; estimated Tier 1 monthly cost is **sub-cent**.

---

## Open Questions (to resolve in implementation plan or first spike)

### Q1 — Supabase S3 endpoint + DuckDB httpfs compatibility (BLOCKING)

DuckDB's httpfs/`s3_endpoint` setting is designed for AWS S3 and S3-compatible services like MinIO. Supabase's S3-compatible interface should work but has documented quirks (path-style addressing required, no MultiPart upload for large files, etc.). **Resolution: this is the literal first task in the implementation plan, before any pipeline code is written.** A 10-line smoke-test script COPYs a 1-row DuckDB table to `s3://lake-tier1/_smoke_test.parquet` and reads it back. If it fails, the whole approach pivots to fallback (write Parquet locally then upload via Supabase Storage REST — same effect, two steps instead of one) BEFORE we commit to the one-statement pipeline shape. No NOAA fetch happens until Q1 is green.

### Q2 — Parquet caching policy

`~/.brain-cache/parquet/` with HEAD-request vintage check is the proposal. Alternative: re-fetch on every refinery run (simpler, slower for repeated builds). **Resolution:** ship with the cache, since refinery is run in tight feedback loops during brain development; cache miss handling is straightforward.

### Q3 — NOAA schema cutoff year

Storm Events Database has schema variations going back to 1950. Pre-1996 uses a fundamentally different column set. **Resolution:** pin to `1996+` (the modern schema), document this as a caveat in the brain's `outputProducer`. 30 years is more than enough signal for SWFL storm frequency baselines. Pre-1996 data can be re-ingested later as a separate vintage if needed.

---

## Risks

| Risk                                                 | Mitigation                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase S3 endpoint quirks block direct DuckDB COPY | Q1 smoke test as first plan task; fallback to local-then-upload is a known-good 2-step path.                                                                      |
| `@duckdb/node-api` binary install fails on Windows   | DuckDB ships prebuilt binaries for win32-x64. If install fails, fallback is to shell out to the DuckDB CLI binary (`duckdb` command) from Node — same end result. |
| NOAA URLs change                                     | Pin the URL template in constants. NCEI is stable; URL has been the same for years.                                                                               |
| Cache invalidation is wrong → stale brain            | Vintage-keyed cache + explicit `--no-cache` CLI flag for forced refresh.                                                                                          |
| Pattern doesn't generalize to next dataset           | This is the whole point of doing it as a pilot. Spec assumes only that the SourceConnector interface holds; if generalization fails, document why and decide.     |

---

## What This Unlocks (Forward-Looking, Not In Scope)

Once this pattern is proven:

- **`demographics-swfl`** — ACS 5-year data, ~500 MB compressed, way too much for Tier 2.
- **`hurricane-tracks-fl`** — NHC HURDAT2 historical tracks, geospatial.
- **All-67-FL-counties parcels** — the "expand beyond Lee" scenario Ricky named. LeePA-style ArcGIS scrape × 67 counties → Parquet per county → DuckDB joins them on read.
- **FAF5 historical (2002–present)** — currently `data_lake.faf_flows` is one vintage; moving the historical archive to Tier 1 Parquet drops Postgres bill.

These are not in scope for this PR. They are the receipts that justify the pattern.
