# Firecrawl Pipeline Skeleton + 4 Scheduled Flows — v2

## Context

Brain platform has no automated data ingestion today — all source data is fetched manually or via one-off scripts (`ingest/pipelines/lee_permits/` is the only standing Firecrawl integration, and it's run by hand). This plan wires Firecrawl's scheduling + scraping into a repeatable pipeline using n8n as the orchestrator. Two of the four flows close concrete brain gaps; two seed historical corpora for brains that haven't shipped yet.

Verified vendor surface (live fetch, 2026-05-25):

- Endpoint: `POST https://api.firecrawl.dev/v2/agent` — `/extract` deprecated in v2.9.0.
- Models: `spark-1-mini` (default, ~60% cheaper) and `spark-1-pro`.
- Webhook signature: `X-Firecrawl-Signature: sha256=<hex>`, HMAC-SHA256 over `JSON.stringify(payload)` server-side, per-team secret from `teams.hmac_secret` (source: `mendableai/firecrawl/apps/api/src/services/webhook/delivery.ts#L164-L167`, commit `3afe6df`).
- n8n: Official Firecrawl node (verified by n8n) — operations: Agent, Agent Async, Crawl, Batch Scrape, Search, Map, Interact.
- SDK: `firecrawl-py 4.28+` (already pinned in `ingest/requirements.txt:8`).

## Decision log — what changed from v1

| #   | v1                                                                    | v2                                                                                                                                           | Why                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Webhook handler ships in Part A                                       | **Deferred.** No DDL, no route, no env var.                                                                                                  | All four v1 flows are synchronous n8n → Postgres/Storage. Zero current async-callback consumers. Spec is verified, but shipping vendor-fragile code for a non-use-case is build-because-the-diagram-shows-a-box. Re-add when a job actually needs async.                               |
| 2   | news_articles + county_planning_docs → Tier 2 Postgres ("waiver")     | **Tier 1 cold storage** (`lake-tier1` bucket, NDJSON, `_tier1_inventory` audit row)                                                          | Brain-first gate is a hard rule in [[data-tier-policy]]; "waiver" invents an exception the policy doesn't have. Graphiti is blocked on a CVE patch — likely quarters away. FAF5/USGS/HURDAT2 cold-lane pattern is proven; promotion-on-consumer is how the policy is designed to work. |
| 3   | cre-swfl "kills hardcoded placeholders" with fallback branch          | **Populate-previously-null metrics**, no fallback branch                                                                                     | Verified in code: `refinery/packs/cre-swfl.mts:314-321` already nulls when no rows. New source just contributes rows when `verified = true` — same null-out path when empty.                                                                                                           |
| 4   | Allowlist edit in `app/r/source/[table]/page.tsx`                     | **`app/r/source/_tables.ts`** + `CREATE INDEX ON {table} ({date_col} DESC)` per its own contract                                             | File-path drift in v1; the allowlist file's own header documents the index requirement.                                                                                                                                                                                                |
| 5   | Validation: `throw` but description says "route to Slack"             | **Halt-and-alert.** Throw on first range violation; n8n top-level error workflow POSTs Slack/email.                                          | LittleBird's recommendation for ~5–15 row quarterly batches — "investigate" beats "silently quarantine." Description matches code.                                                                                                                                                     |
| 6   | Schedules in cron-UTC default                                         | **Anchor to ET in schedule notes**; n8n cron is UTC.                                                                                         | `0 9 * * *` = 4–5 AM ET, not what was intended. Documented per-flow with the UTC value.                                                                                                                                                                                                |
| 7   | Corridor broker narratives wrote to existing table without a consumer | **Same-PR consumer wired in Part 6b** — `cre-source.mts` reads `character_broker_narrative`; pack surfaces per-corridor `broker_positioning` | Piggybacking on an existing table doesn't exempt the brain-first gate. Caught after v2 draft. Closes `[[airport-pulling-split]]` per-row character text backlog as a bonus.                                                                                                            |

## Architecture

**n8n on Railway (~$5/mo, self-hosted)** is the single orchestrator. All four flows live as exported JSON in `docs/n8n/workflows/` (version-controlled — Railway dropouts don't lose work).

Two write paths:

```
                ┌─ Firecrawl /v2/agent ──┐
   n8n cron ────┤                        ├──> validate (Code node)
                └─ Firecrawl batch scrape┘            │
                                                      ├─ pass ──> Postgres (data_lake.*)  [tier 2: cre-swfl-feeding flows]
                                                      │           └─> n8n HTTP → GitHub Actions workflow_dispatch
                                                      │               (.github/workflows/daily-rebuild.yml)
                                                      ├─ pass ──> Supabase Storage (lake-tier1, NDJSON)
                                                      │           └─> Postgres _tier1_inventory upsert
                                                      └─ fail ──> error workflow (Slack/email)
```

**Why two write paths:** flows with a same-PR consuming brain land in Tier 2 (`marketbeat_swfl` → cre-swfl, `corridor_broker_narrative` → cre-swfl). Flows without a consuming brain land in Tier 1 cold storage until a brain materializes (news, county PDFs).

**n8n bypasses dlt** — accepted divergence from the existing ingest pattern. dlt earns its complexity on schema-migration + write-disposition + bulk Postgres loads. These flows write 5–100 rows at a time with known schemas, or write per-run NDJSON files. Raw Postgres / raw Storage API is simpler. Tradeoff: contributors learn two ingest patterns. Acceptable; revisit if n8n flows grow > 10 or schema migration becomes painful.

## Part 1 — n8n infrastructure (one-time setup)

1. **Deploy n8n on Railway** — official one-click template. Set base URL, basic-auth admin, persistent volume.
2. **Credentials in n8n:**
   - Firecrawl: `FIRECRAWL_API_KEY` (same key as `ingest/.env`).
   - Postgres: `SUPABASE_PG_*` from `ingest/.dlt/secrets.toml` (direct Postgres, dedicated IPv4 add-on already enabled per `[[hardcoded-postgres-password]]`).
   - HTTP Header Auth — GitHub PAT with `workflow` scope, for `daily-rebuild.yml` dispatch.
   - Supabase Storage — service-role JWT, for `lake-tier1` writes via Storage REST API.
3. **n8n Firecrawl node** — install latest from n8n community marketplace. Smoke-test it can hit `/v2/agent` (not just legacy `/extract`).
4. **Error workflow** (n8n native) — wire a top-level error workflow in n8n Settings → Error Workflow that POSTs to a Slack incoming webhook. Without this, `throw` in Code nodes dies silently in execution logs.
5. **Skeleton test flow:** Manual trigger → Firecrawl scrape `https://firecrawl.dev` → Postgres insert of one test row into a throwaway table → confirm round-trip. Tear down.
6. **Workflow export:** After each flow ships, commit its exported JSON to `docs/n8n/workflows/{flow-name}.json`.

## Part 2 — MarketBeat quarterly (cre-swfl signal upgrade)

**Schedule:** `0 13 1 1,4,7,10 *` (quarterly, Jan/Apr/Jul/Oct 1st at 13 UTC = 9 AM ET).

**Node chain:**

1. Cron trigger.
2. Firecrawl **Agent** node:
   - `urls`: Cushman & Wakefield SWFL MarketBeat, LSI Companies, CPSWFL.
   - `prompt`: "Extract Southwest Florida commercial real estate market data: vacancy rate (%), net absorption (sq ft), average asking rent ($/sq ft NNN), reporting submarket name. Return one record per submarket."
   - `schema`: `{ submarket, vacancy_rate, asking_rent_nnn, absorption_sqft, quarter, source_url }`.
   - `model`: `spark-1-mini` (verified).
   - `maxCredits`: 1000.
3. **Validate** Code node — halt-and-alert on any range violation:
   ```js
   const RANGES = {
     vacancy_rate: { min: 1, max: 40 },
     asking_rent_nnn: { min: 8, max: 80 },
     absorption_sqft: { min: -600_000, max: 600_000 },
   };
   for (const row of items) {
     for (const [field, { min, max }] of Object.entries(RANGES)) {
       const v = row.json[field];
       if (v != null && (v < min || v > max)) {
         throw new Error(
           `Range violation: ${field}=${v} on "${row.json.submarket}"`,
         );
       }
     }
     row.json._ingested_at = new Date().toISOString();
     row.json.verified = false; // manual spot-check gate
     row.json._source_model = "spark-1-mini";
   }
   return items;
   ```
   Throw routes to n8n error workflow → Slack. No silent quarantine.
4. **Postgres UPSERT** `data_lake.marketbeat_swfl` on `(submarket, quarter)`.
5. **HTTP** node — POST `https://api.github.com/repos/{OWNER}/{REPO}/actions/workflows/daily-rebuild.yml/dispatches` with `{ "ref": "main", "inputs": { "pack_id": "cre-swfl", "force": "false" } }`. Reuses existing workflow per `.github/workflows/daily-rebuild.yml:7-16,42-45`. (`{OWNER}/{REPO}` resolved from `git remote` at build time.)

**Manual spot-check gate:** First-run rows land `verified = false`. `marketbeat-swfl-source.mts` only emits rows where `verified = true`, so the rebuild is a no-op until you `UPDATE data_lake.marketbeat_swfl SET verified = true WHERE quarter = '2026-Q3';` after eyeballing. Brain output gains vacancy/rent metrics it didn't have before — there are no placeholder values to overwrite.

## Part 3 — Corridor broker narratives quarterly

**Schedule:** `0 13 2 1,4,7,10 *` (quarterly, day 2 at 13 UTC = 9 AM ET; offset from Part 2 to avoid Firecrawl rate clash).

**Node chain:**

1. Cron trigger.
2. Firecrawl **Batch Scrape** node — markdown for CRE Consultants, LSI, Investment Properties Corporation, SVN SWFL market-report pages.
3. Firecrawl **Agent** node (per scraped page):
   - `schema`: `{ corridor_name, market_positioning, dominant_tenant_types, development_pipeline_notes }`.
4. **Match** Code node — normalize `corridor_name` against `corridor_profiles.corridor_name` using existing alias table (from corridor pipeline Part B — see `[[corridor-pipeline-mcp-bundle]]`).
5. **Postgres UPSERT** `corridor_profiles.character_broker_narrative` (new JSONB column). **Do NOT touch the existing `character` TEXT column** — that's hand-crafted and quoted verbatim by cre-swfl today.
6. **HTTP** dispatch `daily-rebuild.yml` with `pack_id=cre-swfl`.

## Part 4 — News crawl daily (Tier 1 cold storage, no Postgres)

**Schedule:** `0 11 * * *` (daily at 11 UTC = 7 AM ET).

**Brain-first status:** No consuming brain in v1. Stored in Tier 1 (~$0.021/GB/mo, news ≈ 5 MB/day = ~$0.003/mo) until Graphiti unblocks or another consumer emerges.

**Node chain:**

1. Cron trigger.
2. Firecrawl **Batch Scrape** node — markdown for `gulfshoresbusiness.com`, `naplesnews.com/business/`, `news-press.com/business/`, `businessobserverfl.com`, `winknews.com/category/local/business/`. `onlyMainContent: true`.
3. **Shape** Code node — flatten to NDJSON, one line per article: `{ url, title, published_date, content_md, source_domain, _ingested_at }`. Dedup keyed by URL within the batch.
4. **HTTP** node — PUT `https://{project}.supabase.co/storage/v1/object/lake-tier1/news/year={YYYY}/month={MM}/day={DD}/run-{ISO}.ndjson` with service-role JWT.
5. **Postgres** node — upsert `data_lake._tier1_inventory` row matching pattern in `ingest/lib/tier1_inventory.py:46-88`:
   ```sql
   INSERT INTO data_lake._tier1_inventory (id, bucket, path, vintage, byte_size, pack_id, source_url, updated_at)
   VALUES ('lake-tier1/news/...', 'lake-tier1', 'news/year=.../day=.../run-...ndjson', '{YYYY-MM-DD}', {bytes}, NULL, NULL, now())
   ON CONFLICT (id) DO UPDATE SET ...;
   ```
   `pack_id` is NULL — no consumer yet. Promotion to Tier 2 happens in the future PR that lands the consumer pack.

**No GitHub Actions dispatch.** Nothing consumes this yet.

## Part 5 — County government PDFs monthly (Tier 1 cold storage)

**Schedule:** `0 14 3 * * *` (3rd of each month at 14 UTC = 10 AM ET).

**Brain-first status:** Same as Part 4 — no consuming brain. The plan-of-record consumer is an env-swfl source connector update; until that ships, cold storage.

**Node chain:**

1. Cron trigger.
2. Two parallel Firecrawl **Agent** branches — Lee + Collier county planning commission pages:
   - `schema`: `{ decision_date, decision_type, location, description, source_url, county }`.
   - `maxCredits`: 1500 per county.
3. **Merge** node — concatenate Lee + Collier results.
4. **Shape** + **HTTP PUT** + **`_tier1_inventory` upsert** — same pattern as Part 4, path: `lake-tier1/county-planning/year={YYYY}/month={MM}/lee-collier-{ISO}.ndjson`.

## Part 6 — cre-swfl source connector + pack wiring (two consumers, same PR)

This part wires **two** same-PR consumers — one for MarketBeat (Part 2), one for the new corridor broker narrative column (Part 3). Both satisfy the brain-first gate.

### 6a. MarketBeat source — Option A (separate blocks)

**New file:** `refinery/sources/marketbeat-swfl-source.mts`.

**Pattern reference:** mirror `refinery/sources/macro-florida-cbp-source.mts` — that's the actual fixture-sentinel + live-Supabase-fetch pattern. (NOT `cre-source.mts:78-90` — those lines are type field defs, not the I/O pattern.)

Query:

```sql
SELECT submarket, vacancy_rate, asking_rent_nnn, absorption_sqft, source_url, quarter
FROM data_lake.marketbeat_swfl
WHERE verified = true
ORDER BY quarter DESC;
```

Returns latest-quarter row per submarket. When the table is empty or no `verified = true` rows exist, returns `[]`.

**Three code gaps to close (in order):**

1. **Type-lift `SynthesisFact`** — `refinery/types/event.mts` currently defines `SynthesisFact = { topic, fact, value, source_fragment_ids }`. Add optional `period?: string` so MarketBeat rows can carry their `"2026-Q3"` quarter through to the brain output. This is a single-line type add + a brief comment; no backfill needed because existing facts simply omit it.
2. **Create test file** — `refinery/sources/marketbeat-swfl-source.test.mts` does not exist. Create with fixture-mode tests covering: empty result, single verified quarter, multi-quarter (latest wins), quarter field round-trips into the typed row.
3. **Pack integration shape = Option A (separate blocks)** — `refinery/packs/cre-swfl.mts` emits MarketBeat metrics as **their own** BrainOutput key_metric entries (e.g. `vacancy_rate_marketbeat_swfl`, `asking_rent_nnn_marketbeat_swfl`), NOT merged with the corridor-median vacancy/rent blocks. Reasons: (a) different denominator (submarket-level vs corridor-level), (b) different freshness cadence (quarterly survey vs whatever cre-source feeds), (c) different `source_url` per row. Merging would average across incompatible bases and silently lose the freshness signal.

### 6b. Corridor broker narrative consumer (closes Part 3's gate)

The `corridor_profiles.character_broker_narrative` JSONB column added in Part 7 is a Tier 2 write — same brain-first gate that pushed news + county PDFs to cold storage. Piggybacking on an existing table doesn't exempt it. The minimum-viable consumer below makes the gate honest.

**Modify:** `refinery/sources/cre-source.mts:78-90` — add `character_broker_narrative` JSONB to the SELECT and the typed row shape. Default `null` when the column is empty (existing rows pre-Flow-3 stay null).

**Modify:** `refinery/packs/cre-swfl.mts` — for each corridor, when `character_broker_narrative.market_positioning` is non-null **and** the existing `character` TEXT is also non-null, surface a per-corridor `broker_positioning` field in the BrainOutput narrative section (append after the hand-authored character text, prefixed with "Broker positioning (Q{n} {YYYY}): "). When only the broker narrative exists, use it as a fallback for `character`. When only character text exists, no change.

**Why this is minimum-viable, not minimum-effort:** it closes the `[[airport-pulling-split]]` backlog item ("per-row character text") by giving every corridor a freshness-tagged narrative source. Hand-authored `character` text stays the primary signal where it exists; broker narrative fills gaps and adds a quarterly freshness anchor.

**New file:** `refinery/sources/cre-source.test.mts` — this file does NOT exist today; create it. Cases: (1) column empty (default null), (2) only broker narrative present (broker used as character fallback), (3) both present (append order + freshness prefix verified). Pair with a fixture under `refinery/__fixtures__/corridor-profiles.broker-narrative.sample.json`.

## Part 7 — DDL + provenance allowlist + repo wiring

**New file:** `docs/sql/20260525_marketbeat_swfl.sql`:

```sql
CREATE TABLE IF NOT EXISTS data_lake.marketbeat_swfl (
  id              TEXT PRIMARY KEY,                       -- submarket||'_'||quarter
  submarket       TEXT NOT NULL,
  quarter         TEXT NOT NULL,                          -- "2026-Q3"
  vacancy_rate    NUMERIC,
  asking_rent_nnn NUMERIC,
  absorption_sqft INTEGER,
  source_url      TEXT,
  verified        BOOLEAN NOT NULL DEFAULT false,
  _source_model   TEXT NOT NULL DEFAULT 'spark-1-mini',
  _ingested_at    TIMESTAMPTZ NOT NULL,
  UNIQUE (submarket, quarter)
);
CREATE INDEX IF NOT EXISTS idx_marketbeat_swfl_quarter
  ON data_lake.marketbeat_swfl (quarter DESC);
GRANT SELECT ON data_lake.marketbeat_swfl TO service_role;

ALTER TABLE corridor_profiles
  ADD COLUMN IF NOT EXISTS character_broker_narrative JSONB;
```

No `firecrawl_jobs`, no `news_articles`, no `county_planning_docs` — those would only exist if we ship the webhook handler + Tier 2 versions.

**Modify:** `app/r/source/_tables.ts:33-39` — add **one** entry:

```ts
marketbeat_swfl: {
  label: "MarketBeat — SWFL CRE quarterly",
  brain: "cre-swfl",
  date_col: "quarter",
},
```

The index on `quarter DESC` is already in the DDL above per the file's own header instruction.

**`marketbeat-swfl-source.mts`** uses `buildSourceCitationUrl("marketbeat_swfl", { date_col: "quarter", ... })` for per-row citation.

**GitHub Actions:** No new workflow file. `daily-rebuild.yml` already accepts `workflow_dispatch` with `pack_id` + `force` inputs (verified `.github/workflows/daily-rebuild.yml:7-16,42-45`).

## Env vars

| Var                           | Where                   | Source                                            |
| ----------------------------- | ----------------------- | ------------------------------------------------- |
| `FIRECRAWL_API_KEY`           | n8n credentials         | Already in `ingest/.env`                          |
| `SUPABASE_PG_*`               | n8n Postgres credential | `ingest/.dlt/secrets.toml`                        |
| Supabase service-role JWT     | n8n HTTP Header Auth    | Supabase dashboard                                |
| GitHub PAT (`workflow` scope) | n8n HTTP Header Auth    | New — generate per [GitHub fine-grained PAT docs] |
| Slack incoming webhook URL    | n8n error workflow      | New — create in Slack admin                       |

Nothing in `.env.local` for the Next.js app (no webhook handler in v1).

## Build order

1. `git checkout -b feat/firecrawl-pipelines main` (working tree is clean except for two `.claude/` scratch files; ignore).
2. Apply `docs/sql/20260525_marketbeat_swfl.sql` to Supabase via SQL editor; verify GRANTs.
3. Update `app/r/source/_tables.ts` with the `marketbeat_swfl` entry.
4. `mkdir docs/n8n/workflows && touch docs/n8n/workflows/.gitkeep` — directory doesn't exist; needs to be tracked before any workflow JSON exports land.
5. **Type-lift `SynthesisFact`** — add `period?: string` to the interface in `refinery/types/event.mts`. One-line type add, no backfill (existing facts omit the field). Run `bun test` to confirm no regressions.
6. Write `refinery/sources/marketbeat-swfl-source.mts` + `refinery/sources/marketbeat-swfl-source.test.mts` (TDD: red fixture test → green source). Pattern mirrors `macro-florida-cbp-source.mts`.
7. Wire it into `refinery/packs/cre-swfl.mts` as **Option A separate blocks** (new `vacancy_rate_marketbeat_swfl` + `asking_rent_nnn_marketbeat_swfl` key_metrics, NOT merged with corridor-median blocks). Run `bun test` — expect baseline green (table is empty so MarketBeat blocks simply don't emit).
8. **Part 6b consumer wiring** — modify `refinery/sources/cre-source.mts` to read `character_broker_narrative`; modify `cre-swfl.mts` to surface `broker_positioning` per corridor; add tests in `cre-source.test.mts` (empty column, only broker, both present). Run `bun test` — expect baseline + new tests green (no regressions).
9. Railway: deploy n8n; configure credentials; wire error workflow; ship skeleton test.
10. Build Flow 2 (MarketBeat) end-to-end. Manual trigger → confirm row lands → eyeball → flip `verified = true` → confirm GitHub Actions dispatch fires → confirm brain rebuild ships vacancy/rent metrics.
11. Build Flow 3 (corridor narratives). Manual trigger → confirm `character_broker_narrative` populated and `character` TEXT column untouched → confirm `brains/cre-swfl.md` surfaces `broker_positioning` per corridor where the JSONB is non-null.
12. Build Flow 4 (news) — confirm NDJSON lands in `lake-tier1/news/...` + inventory row.
13. Build Flow 5 (county PDFs) — same as Flow 4.
14. Export all n8n workflow JSONs to `docs/n8n/workflows/`. Commit.

## Verification

- **MarketBeat → cre-swfl:** Manual trigger → row in `data_lake.marketbeat_swfl` with `verified=false` → `/r/source/marketbeat_swfl?date_col=quarter` shows it → SQL flip to `verified=true` → GitHub Actions log shows `daily-rebuild.yml` dispatched with `pack_id=cre-swfl` → `brains/cre-swfl.md` regenerated with non-null vacancy/rent key_metrics.
- **Corridor narratives:** Manual trigger → `corridor_profiles.character_broker_narrative` JSONB populated → `corridor_profiles.character` TEXT untouched (diff query) → GitHub Actions dispatch fires → `brains/cre-swfl.md` quotes existing character text verbatim **and** surfaces per-corridor `broker_positioning` (Q{n} {YYYY}) where the JSONB is non-null. Corridors with hand-authored character text show both; corridors without show broker positioning as the fallback narrative.
- **News (cold storage):** Manual trigger → `lake-tier1/news/year=2026/month=05/day=25/run-{ISO}.ndjson` exists in Supabase Storage → `SELECT * FROM data_lake._tier1_inventory WHERE bucket='lake-tier1' AND path LIKE 'news/%'` returns the row.
- **County PDFs (cold storage):** Same shape as news, `lake-tier1/county-planning/...`.
- **Validation halt:** Synthetically inject a `vacancy_rate=99` in a test run → n8n flow fails → Slack alert fires → no row written to Postgres.
- **Webhook signature spec is verified-but-deferred:** No webhook handler shipped. `app/api/webhooks/firecrawl/route.ts` does NOT exist. `data_lake.firecrawl_jobs` does NOT exist. Re-open when first async use case appears.
- **bun test:** baseline + new tests green (no regressions).
- **No regressions:** `npm run refinery cre-swfl` produces the same output as today until the first `verified=true` row exists.

## Deferred (explicitly out of v1)

- **Webhook handler** + `data_lake.firecrawl_jobs` — vendor contract verified, but no consumer. Re-add when an async use case appears (long-running crawls, bulk Agent Async jobs).
- **Promotion of news_articles + county_planning_docs to Tier 2.** When Graphiti unblocks or env-swfl source connector update lands, the same PR (a) writes a dlt pipeline that reads the NDJSON files from `lake-tier1`, (b) creates `data_lake.{news_articles | county_planning_docs}` with consuming pack DDL, (c) lands the consumer brain. Brain-first gate satisfied.
- **Search-based news discovery.** Firecrawl `/search` could surface fresh SWFL articles more efficiently than scraping homepages. Worth evaluating after a quarter of homepage scrapes shows whether duplicate-rate is meaningfully high.
- **Detail-page enrichment for permits-swfl v2.** Separate plan, separate Firecrawl integration. Tracked at `[[permits-swfl-v2-pagination-detail]]`.
