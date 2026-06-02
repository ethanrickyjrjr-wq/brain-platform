# THE BIBLE — Data & Build Standards

> **This is the canonical, do-it-right-or-not-at-all reference for how data enters
> the lake, how it is read, and how it becomes a brain.** It exists so we stop
> relitigating format/tier decisions and stop rebuilding what already works.
>
> Precedence: `CLAUDE.md` (operator rules) > this file > other docs. Where this
> file and an older doc disagree, **this file wins** and the older doc gets a
> correcting note. Verified against the live lake on 2026-06-02; the reader
> signatures and view rules below are not from memory — they were probed.

---

## 0. The one rule

**We have the data. The job is wiring it, not re-acquiring or rebuilding it.**
Before proposing a new pipeline, check the gap list (`SESSION_LOG.md`) and the
two inventories below — if the table exists with rows, the work is a _connector +
pack_, not an ingest. Before "fixing" the lake MCP again, re-read §3: the
crash-on-one-bad-file failure mode is already structurally gone.

---

## 1. The three tiers

| Tier       | Home                                                                                                  | Purpose                                                                                 | How brains read it                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Tier 1** | Supabase Storage — buckets `lake-tier1` (parquet, ndjson) and `raw-tabular-cold` (csv.gz, geojson.gz) | Cold / speculative / archival. Every object is audited in `data_lake._tier1_inventory`. | DuckDB, **read-only**, via the lake MCP (`tools/lake-mcp-server.mts`) or `makeDuckDBSource` (`refinery/sources/duckdb-source.mts`). |
| **Tier 2** | Postgres `data_lake.*` (+ some self-ingested `public.*`)                                              | Hot, brain-facing, queryable.                                                           | A **source connector** (`refinery/sources/<x>-source.mts`) issues Supabase/PostgREST queries.                                       |
| **Tier 3** | Vault / strategic insights                                                                            | Synthesis inputs, not raw data.                                                         | Out of scope here.                                                                                                                  |

Full tier policy + tool-placement matrix: `docs/API_BLUEPRINTS.md` (Data Tier
Policy). **Brain-first gate:** no Tier-2 bulk ingest lands without its consuming
pack's `PackDefinition` in the **same PR**.

---

## 2. File formats — if it's X, it's read this way

These are the **only** sanctioned readers. They were verified against the real
files (DuckDB `@duckdb/node-api` 1.x). Do not substitute from memory.

| Format            | Extension(s)              | Reader (verbatim)                                                                               | Notes                                                                                                                                                                                                                    |
| ----------------- | ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Parquet**       | `.parquet`                | `read_parquet([urls])`                                                                          | The canonical curated Tier-1 data format. Schema embedded. One file = one year/snapshot (flat layout).                                                                                                                   |
| **CSV**           | `.csv`, `.csv.gz`         | `read_csv_auto([urls], union_by_name=true)`                                                     | gzip auto-detected by extension. Cold bulk dumps (e.g. `leepa/just_value`).                                                                                                                                              |
| **NDJSON**        | `.ndjson`, `.jsonl`       | `read_json_auto([urls], union_by_name=true, ignore_errors=true, maximum_object_size=104857600)` | Run-logs + archives. **All three params are required** — single-file `read_json_auto` fails on `Duplicate name "..."`; `union_by_name` absorbs run-to-run column drift; the raised object cap handles large run records. |
| **GeoJSON**       | `.geojson`, `.geojson.gz` | **Not registered as a view.**                                                                   | A single >16 MB FeatureCollection; needs the spatial extension (`ST_Read`). Query its distilled tabular form in Tier 2 instead (parcels → `data_lake.leepa_parcels`).                                                    |
| **anything else** | —                         | **Skipped** (logged).                                                                           | Reachable, if at all, via its Tier-2 table.                                                                                                                                                                              |

The mapping lives in code in `tier1Format()` / `tier1ListReader()`
(`tools/lake-mcp-server.mts`). `composeQuery()` (`refinery/sources/duckdb-source.mts`)
emits the parquet form for pack connectors.

---

## 3. Tier-1 layout → lake-MCP view rules

The lake MCP turns inventory rows into queryable views. **Layout decides grain:**

- **Hive-partitioned** (`<dataset>/<dim>/year=YYYY/month=MM/run-*.ndjson`) →
  **ONE view per top-level folder**; every file unioned (a time series of runs).
  This is what collapses ~90 run-log files into ~6 views.
- **Flat** (a file directly in a folder, no `*=*` segment) → **ONE view per FILE.**
  Flat folders mix distinct schemas (`environmental/` holds hurdat2 + usgs +
  storms), and flat snapshots would double-count if merged (`leepa/just_value`:
  3 dates × ~548k rows). Per-file is the only safe grain.

Hard rules, all enforced in `tools/lake-mcp-server.mts`:

1. **Resilience:** every view is registered in its **own `try/catch`**. One
   unreadable object is logged and skipped — it never aborts startup. (This is
   the bug that took the MCP down on 2026-06-02; it cannot recur.)
2. **Identifiers:** view names are sanitized, leading-digit-guarded, and
   collision-deduped (`deriveSafeViewName` / `safeIdent`). DuckDB rejects
   unquoted names starting with a digit (`2026_05`).
3. **Serialization:** DuckDB 64-bit ints come back as JS `BigInt`; serialize
   with `jsonSafe()` (BigInt → Number, or string if out of safe range). Plain
   `JSON.stringify` throws on every `count()`/`sum()`.
4. New Tier-1 files are **auto-exposed on next MCP restart** — no code change.

---

## 4. `_tier1_inventory` contract

Every Tier-1 object gets exactly one row, written by
`upsert_inventory_row()` (`ingest/lib/tier1_inventory.py`):

`{ id = "<bucket>/<path>", bucket, path, vintage, byte_size, pack_id, source_url }`

- NDJSON, csv.gz, and geojson.gz rows are **legitimate** — multiple pipelines
  deliberately archive NDJSON to Tier 1. (The function's "lands a Parquet file"
  docstring is historical; the inventory is multi-format.)
- `id` is `bucket/path`, so re-uploading the same object updates its row in place.

---

## 5. Wiring a new dataset — data → brain (the checklist)

Do these in order. Steps that must share a single commit are marked **[same PR]**.

1. **Pipeline** — `ingest/pipelines/<x>/` (dlt) or `ingest/duckdb_pipelines/<x>/`.
   Ship `--dry-run` + a GHA cron wrapper **[same PR]** (`docs/standards/pipeline-freshness.md`).
   Verify vendor cadence against the publisher's release calendar, not memory.
   HTML scraping routes through `extract_client.scrape_with_fallback()`.
2. **Land the data:**
   - _Tier 2:_ dlt → `data_lake.<table>`, then run the grant
     (`GRANT SELECT ON ALL TABLES IN SCHEMA data_lake TO service_role; NOTIFY pgrst, 'reload schema';`)
     — dlt does **not** auto-grant PostgREST or refinery gets a silent 403.
   - _Tier 1:_ upload to `lake-tier1` / `raw-tabular-cold` **and** call
     `upsert_inventory_row()`.
3. **Source connector** — `refinery/sources/<x>-source.mts`. Tier 2 = Supabase
   query; Tier 1 = `makeDuckDBSource`/`composeQuery`. **Deterministic aggregation
   in code; LLMs only do qualitative prose.** `rowShape` coerces DuckDB types.
4. **Pack** — `refinery/packs/<x>.mts`, registered in `refinery/packs/index.mts`
   (use `refinery/scaffold.mts` — it writes both atomically). The pack **imports
   the source**. Vocabulary slugs land in the **[same PR]** (the orphan linter
   aborts the GHA rebuild in any gap — "ship the contract together").
5. **Cadence** — add to `ingest/cadence_registry.yaml`. Set the pack's
   `ttl_seconds` to the **source's real cadence**, never 1 day unless the source
   is genuinely daily (monthly source on a 1d TTL = nightly re-render of
   identical numbers = wasted money). Mirror the `ttl_seconds` in
   `refinery/packs/catalog.mts` or `catalog.test.mts` drifts.
6. **Verify** — pack tests + catalog-drift test green. If `package.json` changed,
   `bun install` and stage `bun.lock` in the **[same PR]** (frozen-lockfile CI
   fails otherwise).
7. **Lake MCP** — nothing to do; new Tier-1 files appear as views on next restart.

---

## 6. Non-negotiables (full text in `CLAUDE.md`)

- **Deterministic math, narrative prose.** Counts/sums/medians/rankings in code.
- **Thin pipe.** A downstream brain reads only an upstream's `--- OUTPUT ---`.
- **Validators gate writes** (`spec-validator`, `facts-only-lint`,
  `inference-bait-lint`, `smoothing-lint`). Failure aborts the render.
- **Freshness token quoted on first use.**
- **Vendor-first.** Verify vendor surfaces (MIME types, reader signatures, model
  IDs, endpoints) in-session before coding. The readers in §2 were probed
  against live files before shipping — that is the standard, not the exception.

---

## 7. Related standards (don't duplicate — link)

| Topic                                         | File                                   |
| --------------------------------------------- | -------------------------------------- |
| Data Tier Policy + tool-placement matrix      | `docs/API_BLUEPRINTS.md`               |
| Pipeline-freshness (cron + dry-run + cadence) | `docs/standards/pipeline-freshness.md` |
| Consumption contract (downstream Claude)      | `docs/consumption-contract.md`         |
| Ontology + roadmap                            | `docs/ontology-and-roadmap.md`         |
| Current wiring gaps (orphan data)             | `SESSION_LOG.md` (newest entry)        |
