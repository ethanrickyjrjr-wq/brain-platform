# Pipeline Freshness Standard

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

---

## 2. Secrets Reference

All secrets are set at the repository level (`Settings → Secrets and variables → Actions`). To add a new secret:

```bash
gh secret set MY_SECRET_NAME --body "value"
# or read from a file:
gh secret set MY_SECRET_NAME < secret.txt
```

| Secret                               | Used by                                                                       | Notes                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `BLS_API_KEY`                        | `bls_laus`, `bls_qcew`                                                        | BLS Public Data API v2                                                              |
| `CENSUS_API_KEY`                     | `census_cbp`                                                                  | api.census.gov                                                                      |
| `DESTINATION__POSTGRES__CREDENTIALS` | all dlt Tier 2 pipelines                                                      | Full DSN bundle; set via `gh secret set` as a single-line JSON or connection string |
| `FIRECRAWL_API_KEY`                  | `news_swfl`, `marketbeat_swfl`, `county_planning_swfl`, `corridor_narratives` | Firecrawl API                                                                       |
| `FRED_API_KEY`                       | `macro_us` (planned)                                                          | FRED economic data                                                                  |
| `SUPABASE_SERVICE_KEY`               | all pipelines that write to Storage or `_tier1_inventory`                     | Service-role JWT, not anon                                                          |
| `SUPABASE_URL`                       | all pipelines                                                                 | `https://<project-ref>.supabase.co`                                                 |

**Do not add** `BRAINS_*`, `SUPABASE_PG_*`, or `SLACK_*` secrets. Those were removed in PR #19.

---

## 3. Cron-Picking Rules

Avoid stacking multiple workflows on the same day-of-month. Current schedule:

| Day(s)              | Workflow                            | Cadence                       |
| ------------------- | ----------------------------------- | ----------------------------- |
| 1 (Jan/Apr/Jul/Oct) | `marketbeat-quarterly.yml`          | quarterly                     |
| 2                   | `corridor-narratives-quarterly.yml` | quarterly                     |
| 3                   | `county-planning-monthly.yml`       | monthly                       |
| 4                   | `bls-laus-monthly.yml`              | monthly                       |
| 5                   | `census-cbp-annual.yml`             | annual (Oct 5)                |
| 8                   | `fema-nfip-quarterly.yml`           | quarterly                     |
| 15                  | `fdot-aadt-annual.yml`              | annual (Apr 15)               |
| Feb 1               | `fhfa-hpi-quarterly.yml`            | quarterly (Feb/May/Aug/Nov 1) |
| Mar 1               | `leepa-parcels-annual.yml`          | annual (Mar 1)                |
| daily               | `news-daily.yml`                    | daily                         |

**Rules for picking a new slot:**

1. Check the table above — no two non-daily workflows on the same `day-of-month + hour`.
2. Buffer ≥1 day after the source's official release date (data isn't available at midnight).
3. Stagger hours: existing workflows use 12:00–14:00 UTC; pick within that band unless you have a reason to deviate.
4. Document the slot in a comment in the workflow YAML (see `bls-laus-monthly.yml` for the format).

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

Pipelines already on GHA: `news-daily`, `marketbeat-quarterly`, `corridor-narratives-quarterly`, `county-planning-monthly`, and all six dlt pipelines above. See `docs/n8n/SETUP.md` for the n8n deployment runbook.
