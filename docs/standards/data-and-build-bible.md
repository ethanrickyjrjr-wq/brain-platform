# THE BIBLE — Data & Build Standards

> **This is the canonical, do-it-right-or-not-at-all reference for how data enters
> the lake, how it is read, and how it becomes a brain.** It exists so we stop
> relitigating format/tier decisions and stop rebuilding what already works.
>
> Precedence: `CLAUDE.md` (operator rules) > this file > other docs. Where this
> file and an older doc disagree, **this file wins** and the older doc gets a
> correcting note. Verified against the live lake on 2026-06-02; the reader
> signatures and view rules below are not from memory — they were probed.
> **§0.3 (web-scraping hardening) added 2026-06-25** from the JRW residential build —
> every rule there was re-proven live (crawl4ai HTTP strategy vs browser virtualization).

---

## 0. The one rule

**We have the data. The job is wiring it, not re-acquiring or rebuilding it.**
Before proposing a new pipeline, check the gap list (`SESSION_LOG.md`) and the
two inventories below — if the table exists with rows, the work is a _connector +
pack_, not an ingest. Before "fixing" the lake MCP again, re-read §3: the
crash-on-one-bad-file failure mode is already structurally gone.

### 0.1 — PROBE FIRST ALWAYS: fetch only what you pin; backfilling a column needs a STABLE key

> ## PROBE FIRST ALWAYS
>
> **The cardinal ingest rule.** Before any multi-minute ingest or backfill, run the
> <1-minute probe. Everything else in §0.1–§0.2 is downstream of this one habit. The
> pre-push hook can catch the _artifacts_ of a careful ingest (a guard call, a narrow
> `$select`) — it can **never** witness whether you actually probed. That is on you,
> and it is why this rule is read first, not enforced by code. We do not need to
> re-ingest all the data every time; probing first is how we stop doing that.

Corollary of §0, learned the hard way 2026-06-13.

**Probe before you commit to a long run.** A <1-minute check — is the key stable
across refreshes? one-page timing × page count = total? — comes BEFORE any
multi-minute ingest or backfill. Never launch a 50-minute job to discover at minute
51 that the approach was wrong (we did exactly that, twice, 2026-06-13). The cheap
question first, every time.

**Fetch narrow, in large pages.** The waste is pulling EVERY source column in tiny
pages — not the full refresh itself. FEMA NFIP pulled all ~70 OpenFEMA columns at
`$top=500` (~50 min; a chunked-stream drop even killed it at skip~330k). It pins only
**16**: `$select` exactly those at `$top=10000` → ~3 min and drop-resistant. **Rule:**
a pipeline `$select`s only the fields its `_normalize_*` reads, at the largest `$top`
the API honors. (Field names must match the normalizer's keys exactly — a typo
silently nulls a column, the `floodZone` class of bug; guard the load-bearing ones.)

**Backfilling a column needs a key that is STABLE across refreshes — verify it
first.** To fix/add a column on existing rows you must `UPDATE` by such a key (narrow
`$select` → `UPDATE … FROM` by key). ⚠️ **Many APIs regenerate their id every
rebuild.** OpenFEMA `FimaNfipClaims`'s `id` UUID is NOT stable — verified 2026-06-13:
a stored id returns EMPTY from the live API, and a backfill keyed on it matched **0**
of 433k rows. With no stable key a column fix CANNOT be backfilled or merged; a full
`replace` (made cheap by the narrow-fetch rule above) is the ONLY correct way. Do not
assume a key is stable because it looks like one (a UUID can still churn each refresh).

**merge vs replace.** Large append-mostly source + a **verified-stable** PK → `merge`
(upsert): non-destructive, free column backfills. No stable key (regenerated surrogate
id, e.g. FEMA NFIP) → `replace` is correct, not lazy. Justify the disposition in the
pipeline + cadence registry.

Documented standard + the FEMA worked example above — **not** a new hard gate (RULE 3
C2); enforced the way every ingest rule here is, by being read first.

### 0.2 — The seven ingest-hardening standards (what §0.1 implies for every pipeline)

The durable rules every ingest pipeline must satisfy. Each carries an **enforcement
tag** so nobody assumes the hook backs a rule it doesn't:

- **`[hook-blocks]`** — `.claude/hooks/check-prepush-gate.mjs` fails the push (fail-closed).
- **`[hook-advises]`** — the hook prints a warning; it never blocks.
- **`[policy-only]`** — read-and-honor; no mechanical check exists (the hook catches
  artifacts, not acts — it cannot, for example, witness a probe).

1. **PROBE FIRST ALWAYS** (§0.1). `[policy-only]` — the hook cannot see whether you probed.
2. **Fetch narrow, in large pages.** `$select` / projection of only the fields the
   normalizer reads, at the largest page the API honors. `[hook-advises]` — flags an
   OData `$top` with no `$select`, and an ArcGIS `paginate_arcgis(` with no `out_fields`.
3. **Verify key stability before merge or backfill.** A stored id must return its row
   from the live API; many APIs regenerate ids every refresh (OpenFEMA). `[policy-only]`.
4. **Audit field names against the LIVE vendor API.** A normalizer key that misses the
   vendor's real field name silently nulls that column forever (FEMA `floodZone`→
   `ratedFloodZone`, and `numberOfFloorsInsured`→`numberOfFloorsInTheInsuredBuilding`,
   both in one day). Verified by a live sample request, never from memory. `[policy-only]`.
5. **Non-null guard before any destructive write.** A `replace`/truncate pipeline must
   compute each load-bearing column's non-null rate via `ingest.lib.guards`
   (`assert_min_rows` / `assert_vs_canonical` + a non-null floor) and **abort below
   floor**, so a bad/empty pull or a silent vendor field-rename fails loud instead of
   wiping good data. **This is the one irreversible failure** → `[hook-blocks]`.
   Reference: `ingest/pipelines/fema/resources.py` `_promote_nfip_to_tier2`. The gate is
   now `BLOCK_REPLACE_WITHOUT_GUARD = true` (fail-closed). Guarded `replace` pipelines:
   `census_cbp`, `fdot`, and the `fl_dbpr_applicants` resource of `fl_dbpr_licenses`
   (`assert_min_rows` total floor + per-county Lee/Collier floors + city-anchor invariant).
   Note `fl_dbpr_licenses`'s **license** resource is `write_disposition="merge"`, not
   `replace`, so the guard lands on the **applicant** resource only — the license resource
   needs no replace-guard. `faf5` was **removed** as a correction (2026-06-13): its
   dlt→Postgres replace tables never landed, so it was never "known-good unguarded" — the
   live freight path is Tier-1 Parquet (`faf5_to_parquet.py`), and the dead dlt pipeline
   was retired. Operator override: `ALLOW_REPLACE_WITHOUT_GUARD=1` (reason logged).
6. **ArcGIS: project `outFields`, drop geometry.** Use `paginate_arcgis_tabular(out_fields=…)`
   (sends `f=json` + `returnGeometry=false`), never bare `paginate_arcgis()` — its default
   `out_fields="*"` drags full geometry + every attribute you then discard. `[hook-advises]`.
7. **Cron cadence = source cadence.** A pipeline's GHA cron must not fire more often than
   the source publishes (`ingest/cadence_registry.yaml` `cadence_days`) — over-frequent =
   re-ingesting unchanged data for no reason. A new pipeline dir must be registered in the
   cadence registry. `[hook-advises]` — **dir-presence only.** It must **NEVER** error on
   missing `change_signal` / `vintage_policy` / `repro_pointer`; those are warn-only/
   additive (Row Layer decision). A hook that hard-fails on them is the rejected
   mandatory-spine creeping back through the side door — kill it on sight.

The hook is a **backstop against #5 (the only irreversible one)**, not the lever that
makes you probe. The lever is this section being read first.

### 0.3 — Web-scraping hardening (crawl4ai) — the scraper failure modes, codified

§0.1–§0.2 cover **API** ingest. Scrapes fail differently, and they fail *the most* (Collier
permits, Crexi, the recurring `daily-rebuild` neighbors). These are the durable rules, learned the
hard way and re-proven on the JRW residential pipeline (2026-06-25). All `[policy-only]` unless tagged.

1. **crawl4ai is the ONLY crawl tool.** Firecrawl and Spider are removed (operator decree
   2026-06-16). Everything goes through `ingest/lib/crawl4ai_client.py`. Its surfaces:
   `Crawl4aiSession` (persistent browser + `UndetectedAdapter`, for stealth/interactive/JS pages;
   `anti_bot_gate=True` fails loud on a 403/challenge instead of letting thin HTML pass as success);
   `AsyncHTTPCrawlerStrategy` + `HTTPCrawlerConfig` (raw server HTML, no browser); `fetch_many`
   (parallel independent pages); `fetch_tables` (zero-LLM `<table>` extraction). Do **not** reach for
   `requests`/`bs4` as the fetch layer for a scrape target, and do **not** re-introduce
   `extract_client.scrape_with_fallback()` (the dormant Firecrawl path).
2. **Server-rendered list → use the HTTP strategy, NOT the browser.** A JS browser render can
   **virtualize** a long list (drop off-screen DOM rows) and inject map/widget noise. JRW proved it:
   the browser kept ~4 of 12 cards + a Google-Maps price-pin layer; `AsyncHTTPCrawlerStrategy`
   returned all 12 cards/page, full values, in ~1.5 s. Reserve the browser for pages that genuinely
   require JS or anti-bot clearance.
3. **The runner-IP WAF block is the #1 scraper failure.** A datacenter IP (GitHub Actions) gets
   blocked even when your home IP sails through. Standard: **(a)** probe live from a home IP first
   (RULE 0.5); **(b)** ship the cron **PARKED** — `probe_mode: odd_window` in the cadence registry
   **and** the `schedule:` block commented out — and **seed locally** until a green
   `workflow_dispatch` run from the runner proves the IP is clear (then uncomment the schedule);
   **(c)** escalate with a residential proxy via the `CRAWL4AI_PROXY` env var (already wired in
   `crawl4ai_client`); **(d)** open a tracking `check` for the WAF proof so the parked cron is not
   forgotten. Reference: `ingest/pipelines/jrw_listings/` + `.github/workflows/jrw-listings-daily.yml`.
4. **Total-empty = fail loud (exit 1).** Every target returning 0 rows means a block or a markup
   change — exiting 0 is silent fake-green, the enemy. Pair with volume guards
   (`assert_min_rows` + `assert_vs_baseline`) so a *degraded* (not empty) scrape also surfaces.
5. **Scrapes MERGE, never replace.** A partial scrape must never wipe good rows — upsert
   `ON CONFLICT` on a stable natural key (e.g. `(source_name, mls_id)`). This also makes the
   guards alert-only rather than data-loss-preventing, which is the safer failure mode.
6. **No silent caps.** A pagination safety cap that truncates the result set must `print` a loud
   warning (it is biased data otherwise — JRW's default sort is price-desc, so a low cap keeps only
   luxury and wrecks any median). Page to natural exhaustion (stop when a page yields no new key).
7. **robots.txt + politeness.** Honor `Disallow` paths and any `Crawl-delay`; add a small inter-page
   delay even when none is set. Check the page for a **backing JSON/XHR API** first (the Crexi
   lesson) — typed JSON beats HTML parsing, though it may be Cloudflare-gated and callable only from
   inside a cleared `Crawl4aiSession`.
8. **Cron-execution freshness (the gap the data-probe can't see).** `freshness-probe-daily` checks
   DATA age, not whether the CRON FIRED. A commented/parked cron never runs (by design); a malformed
   cron expression (`0 25 * * *`) silently never runs (GHA drops it). When you un-park a schedule,
   confirm the next run actually appears in the Actions tab — green data is not proof the cron ran.

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
   **HTML/JS scraping goes through `ingest/lib/crawl4ai_client.py`** (crawl4ai only — never
   Firecrawl/Spider/`requests`); for a scrape target, follow §0.3 (HTTP strategy for server-rendered
   lists, parked cron until the runner IP is WAF-proven, merge-not-replace, fail-loud-on-empty).
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
   the source**. **Every metric slug the pack can emit — including conditional
   ones behind an `if` — lands in `refinery/vocab/brain-vocabulary.json` in the
   **[same PR]**, both as a documented concept (`prefLabel` + `scope_note`) and a
   `slug_index` identity entry** ("ship the contract together"). A leaf-emitted
   orphan aborts the GHA rebuild the moment master re-synthesizes; a _conditional_
   slug stays invisible until its data lands, then orphans master with zero
   warning — register it the day you write it. **Smoke before pushing:**
   `bun refinery/tools/check-vocab-coverage.mts --all` (NOT the bare master-only
   default — that misses leaf orphans). The pre-push hook enforces both `--all`
   and a source scan for unregistered `metric:` literals; full rule in `CLAUDE.md`
   RULE 1 breaker #2.
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
