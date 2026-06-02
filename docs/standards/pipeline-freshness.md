# Pipeline Freshness Standard

> Part of **THE BIBLE** (`docs/standards/data-and-build-bible.md`) — see §5 there
> for the full data→brain wiring checklist this standard is step 1 of.

Every ingest pipeline (Tier 1 and Tier 2) must satisfy all four rules below before merging to `main`.

---

## 1. The Four Freshness Rules

Every pipeline PR must ship with:

**(a) GHA cron + `workflow_dispatch`.**
Every pipeline has a `.github/workflows/*.yml` file with both a `schedule:` cron block and a `workflow_dispatch:` block (with `dry_run` input). No pipeline is hand-run-only.

**(b) Freshness signal written per run.**

- Tier 2 dlt pipelines: dlt writes to `data_lake._dlt_loads` automatically. No extra step needed.
- Tier 1 storage pipelines: call `ingest.lib.tier1_inventory.upsert_inventory_row()` at the end of every successful run. The `vintage` field is the ISO date of the data snapshot.

**(c) Inventory row OR dlt_loads coverage.**
Every completed run must produce a traceable record. dlt covers Tier 2. Tier 1 pipelines must write a `_tier1_inventory` row — use `upsert_inventory_row`, not the deprecated `write_tier1_pointer`.

**(d) `--dry-run` support.**
Every `pipeline.py` entry point accepts `--dry-run`. Dry-run fetches data and validates row count/shape, then exits 0 without writing to Postgres or Storage. A pytest in `ingest/tests/pipelines/<name>/test_dry_run.py` asserts `dlt.pipeline` is not called.

**(e) Volume floor registered.**
Every new pipeline adds an `expected_rows_min` entry to `cadence_registry.yaml`. The daily freshness probe uses this to emit `LOW_VOLUME` (icon ⚠️, exit 0) in the GHA step summary alongside `FRESH`/`STALE`/`MISSING`. For nascent pipelines with no stable baseline yet, set `expected_rows_min: 1`.

Tier-2 dlt entries where the `dlt_schema_name` differs from the actual Postgres table name must also set `count_table: schema.table` (fully-qualified). Tier-1 entries skip the SQL count check; `expected_rows_min` is recorded for when the pipeline graduates to Tier 2. See `ingest/lib/guards.py` for the `assert_min_rows` / `assert_vs_canonical` guard functions to wire into the pipeline itself (pre-promote, not just probe).

---

## 2. Secrets Reference

All secrets are set at the repository level (`Settings → Secrets and variables → Actions`). To add a new secret:

```bash
gh secret set MY_SECRET_NAME --body "value"
# or read from a file:
gh secret set MY_SECRET_NAME < secret.txt
```

| Secret                               | Used by                                                               | Notes                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `BLS_API_KEY`                        | `bls_laus`, `bls_qcew`, `bls_ppi`                                     | BLS Public Data API v2                                                                                                   |
| `CENSUS_API_KEY`                     | `census_cbp`, `census_vip`                                            | api.census.gov                                                                                                           |
| `DESTINATION__POSTGRES__CREDENTIALS` | all dlt Tier 2 pipelines                                              | Full DSN bundle; set via `gh secret set` as a single-line JSON or connection string                                      |
| `FIRECRAWL_API_KEY`                  | `news_swfl`, `lee_permits`, `collier_permits`, `swfl_cre_intel_probe` | Firecrawl API; primary vendor for HTML scraping (see §6)                                                                 |
| `SPIDER_API_KEY`                     | `news_swfl`, `swfl_cre_intel_probe` (via `extract_client`)            | spider.cloud API; fallback vendor for plain `scrape` and `agent` (see §6). If unset, fallback is skipped with a warning. |
| `FRED_API_KEY`                       | `fred_g17`                                                            | FRED economic data                                                                                                       |
| `SUPABASE_SERVICE_KEY`               | all pipelines that write to Storage or `_tier1_inventory`             | Service-role JWT, not anon                                                                                               |
| `SUPABASE_URL`                       | all pipelines                                                         | `https://<project-ref>.supabase.co`                                                                                      |
| `SUPABASE_S3_ENDPOINT`               | DuckDB lane pipelines (`redfin_swfl`, `usgs_swfl`)                    | Supabase S3-compatible endpoint URL                                                                                      |
| `SUPABASE_S3_ACCESS_KEY_ID`          | DuckDB lane pipelines                                                 | S3 access key (project-scoped)                                                                                           |
| `SUPABASE_S3_SECRET_ACCESS_KEY`      | DuckDB lane pipelines                                                 | S3 secret                                                                                                                |

**Do not add** `BRAINS_*`, `SUPABASE_PG_*`, or `SLACK_*` secrets. Those were removed in PR #19.

---

## 3. Cron-Picking Rules

Avoid stacking multiple workflows on the same day-of-month. Current schedule (refreshed 2026-05-27 to match `.github/workflows/`):

| When (UTC)                    | Workflow                      | Cadence               | Publisher cadence basis                                                                                  |
| ----------------------------- | ----------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| Feb 1 13:00                   | `fdot-aadt-annual.yml`        | annual                | FDOT prior-year AADT publishes early Q1                                                                  |
| Mar 1 13:00                   | `leepa-parcels-annual.yml`    | annual                | LeePA certified roll publishes early Q1                                                                  |
| Mar 15 13:00                  | `faf5-annual.yml`             | annual                | ORNL FAF5 updates publish in Q1 (~2-week buffer)                                                         |
| Jun 1 13:00                   | `hurdat2-annual.yml`          | annual                | NHC publishes HURDAT2 Mar/Apr; pre-hurricane-season refresh                                              |
| Aug 15 13:00                  | `census-cbp-annual.yml`       | annual                | CBP prior-year releases summer (e.g. 2024 → summer 2026)                                                 |
| Day 5 (Jan/Apr/Jul/Oct) 13:00 | `fema-nfip-quarterly.yml`     | quarterly             | FEMA NFIP quarterly release                                                                              |
| Day 8 (Jan/Apr/Jul/Oct) 13:00 | `fhfa-hpi-quarterly.yml`      | quarterly             | FHFA HPI ~8 weeks after quarter-end                                                                      |
| Day 9 (Feb/May/Aug/Nov) 13:00 | `bls-qcew-quarterly.yml`      | quarterly             | BLS QCEW ~5mo lag; release day 6-7 of those months (2-day buffer)                                        |
| Day 5 12:00                   | `collier-permits-monthly.yml` | monthly               | Collier publishes prior-month XLSX                                                                       |
| Day 10 13:00                  | `usgs-monthly.yml`            | monthly               | USGS daily-values monthly snapshot                                                                       |
| Day 10 14:00                  | `storm-history-monthly.yml`   | monthly               | NOAA storm-events update (1hr after usgs to stagger)                                                     |
| Day 12 13:00                  | `ingest-census-vip.yml`       | monthly               | VIP releases "first week"; 5-day buffer                                                                  |
| Day 15 13:00                  | `redfin-monthly.yml`          | monthly               | Redfin ~3rd Friday; S3 last-mod observed ~14th                                                           |
| Day 16 14:00                  | `ingest-bls-ppi.yml`          | monthly               | PPI ~day 15 (1-day buffer)                                                                               |
| Day 17 13:00                  | `ingest-fred-g17.yml`         | monthly               | FRED G.17 ~day 16 (1-day buffer)                                                                         |
| Day 20 13:00                  | `zori-tier1-monthly.yml`      | monthly (T1 fetch)    | Zillow Research refreshes monthly ~3rd week                                                              |
| Day 21 13:00                  | `zori-tier2-monthly.yml`      | monthly (T2 merge)    | Reads T1 Parquet from day 20 (1-day buffer)                                                              |
| Day 25 13:00                  | `bls-laus-monthly.yml`        | monthly               | **Fixed 2026-05-27.** BLS LAUS state series releases ~3rd-4th week of M+1 (e.g. May 2026 → June 23 2026) |
| Mondays 11:00                 | `lee-permits-weekly.yml`      | weekly                | Rolling Mon→Mon Accela scrape window                                                                     |
| Daily 11:00                   | `news-daily.yml`              | daily                 | News sources publish daily                                                                               |
| Daily 06:00                   | `daily-rebuild.yml`           | daily (tooling)       | Refinery rebuild; off-cluster slot                                                                       |
| Daily 14:00                   | `freshness-probe-daily.yml`   | daily (observability) | After 13:00 UTC ingest cluster                                                                           |

**Rules for picking a new slot:**

1. Check the table above — no two non-daily workflows on the same `day-of-month + hour`.
2. **Verify publisher cadence against the source's release calendar** (not just author memory) before picking the day. BLS publishes calendars at `bls.gov/schedule/`, Census at `census.gov/programs-surveys/<survey>/news-updates`, FRED at `fred.stlouisfed.org/release-calendar`. The cron must fire AFTER the publisher's release window — never before.
3. Buffer ≥1 day after the source's official release date (data isn't available at midnight).
4. Stagger hours: existing workflows use 11:00–14:00 UTC; pick within that band unless you have a reason to deviate.
5. Document the slot in a comment in the workflow YAML (see `bls-laus-monthly.yml` for the format — include the publisher cadence basis, not just the timezone conversion).

---

## 4. Tier 1 vs Tier 2 Assignment

See `docs/API_BLUEPRINTS.md` — Data Tier Policy — for the full decision tree and locked rules. Short version:

- **Tier 1 (Supabase Storage):** data without an active consuming brain in this sprint. Compress to Parquet or CSV.gz. Write a `_tier1_inventory` row.
- **Tier 2 (Postgres `data_lake.*`):** data with a consuming brain shipping in the same PR. Use dlt. Brain-first gate is non-negotiable.

Do not write to `data_lake.*` without a `PackDefinition` in the same PR.

---

## 5. GHA vs n8n/Railway

**GitHub Actions is the default** for all cron-driven ingest. Use n8n/Railway only when:

- The run requires a browser session (Playwright, Puppeteer, Accela login flows).
- The cron job exceeds GHA's 6-hour timeout.
- The pipeline needs interactive auth that can't be scripted via secrets.

Every active ingest workflow is listed in §3 above. The deleted `marketbeat-quarterly`, `corridor-narratives-quarterly`, `county-planning-monthly` workflows shipped briefly and were removed in PR #41 (broker URLs returned landing pages, not data). See `docs/n8n/SETUP.md` for the n8n deployment runbook.

---

## 6. HTML Scraping — Firecrawl primary, Spider fallback

When a pipeline scrapes HTML via Firecrawl, follow this rule for vendor fallback. Locked 2026-05-27.

| Firecrawl mode                               | What it does                                                       | Fallback rule                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `firecrawl_client.scrape()` (plain)          | Vanilla page-to-markdown scrape. No actions, no extraction schema. | **Must use `extract_client.scrape_with_fallback()`** — falls back to spider `/scrape` on firecrawl failure or empty result.  |
| `firecrawl_client.agent()` (prompt + schema) | LLM-driven extraction with custom JSON Schema.                     | **Use `extract_client.extract()`** — already wraps with spider `/ai/scrape` fallback.                                        |
| `firecrawl_client.scrape_with_actions()`     | Click-through flows (Accela login, multi-step navigation).         | **No fallback. Stays direct.** Spider has no `/ai/scrape` analogue for action-based navigation. Failure-mode is loud (HTTP). |

**Why this split:** plain page scrapes and agent-driven extraction each have a one-to-one spider equivalent (`/scrape` and `/ai/scrape` respectively). Action flows (form fills, button clicks, multi-step navigation) are firecrawl-specific. Forcing a uniform wrapper would either silently drop the actions or require a third vendor (Playwright/Browserbase) — neither is worth the complexity today.

**The trap this closes:** firecrawl's `/v2/agent` can silently return `status=completed` with `data=null` on dead or blocked URLs. Spider's analogues either return rows or raise a structured `404`/`525` that makes the dead URL actionable. Silent empty rows is the trap that wasted three sessions.

**Live call sites (2026-05-27):**

- `scripts/swfl_cre_intel_probe.py` → `extract_client.extract()` (agent mode, wrapped)
- `ingest/pipelines/news_swfl/pipeline.py` → `firecrawl_client.scrape()` direct (must migrate to `scrape_with_fallback` — tracked)
- `ingest/pipelines/lee_permits/scraper.py` → `scrape_with_actions()` direct (correct, no fallback)
- `ingest/pipelines/collier_permits/fetcher.py` → `scrape_with_actions()` direct (correct, no fallback)

**Enforcement is by code review, not lint.** If a new PR adds `from ingest.lib.firecrawl_client import scrape` at the call site instead of going through `extract_client.scrape_with_fallback`, the PR is broken regardless of whether tests pass.
