# SESSION_LOG.md — Append-Only Cross-Session Memory

**Read this on session start. Append to it before every `git push`.**

## 2026-05-27 (Opus 4.7 · fix/ci-catalog-drift) — fix: catch BRAIN_CATALOG + corridor-aliases up with main

- Root-caused 3 CI failures on `main` that have been red since 15:37 UTC (every push since the permits-swfl Collier + housing-swfl + corridor-centroids ships). All three were pure registry/alias drift, no logic issues. (1) `refinery/packs/catalog.mts`: added `housing-swfl` entry (was registered in PER_PACK_REGISTRY but not BRAIN_CATALOG); rewrote `permits-swfl` scope to match the pack's new Lee+Collier copy. (2) `refinery/lib/corridor-aliases.mts`: flipped all 10 Collier `null`s to identity maps now that the Collier permits pipeline ships centroids for them; updated header comment + `corridor-aliases.test.mts` "returns null" assertion to "returns string." `bun test` 762/762 pass locally; tsc + eslint clean.
- Untouched: `app/page.tsx` mod and 4 untracked items in scope (per `commit-only-owned-files`). Open PR against `main` next.

- Added `refinery/agents/synthesis-agent.test.mts` (3 tests, all pass): empty input → `[]`; mock-mode (no `ANTHROPIC_API_KEY`) returns one mock fact per fragment; SDK-mocked path via `mock.module("./anthropic.mts", ...)` verifies the smoothing scrubber strips "approximately" from both `fact` and `value` (console.warn from the scrubber confirmed during run). Closes the "synthesis-agent test" next-item from the prior end-of-day entry.
- Diagnostic only — no source change here: live `fdotSource.fetch()` emits **4** `fdot-county-year` fragments + **0** `fdot-cohort-yoy` because PostgREST's default `max_rows=1000` silently truncates `.limit(100000)` in `fetchLive()`. Table is healthy: 103,662 rows, `yearx` column matches source (NOT a `year_` drift — the prior end-of-day diagnosis was wrong). Lee+Collier+Charlotte × 2021-2025 all populated (~4,596 in-scope rows). Fix to ship as its own PR next: `.range()` pagination loop in `fetchLive()`; verify cohort-yoy fragments appear post-fix.

## 2026-05-27 (Sonnet 4.6 · main) — decision: Step 5 broker overlay closed, superseded by PR #43

- Step 5 (Firecrawl/Spider quarterly broker narrative scrape) is permanently closed. The AI-generated type-conditional voices shipped in PR #43 cover what scraped broker narratives were supposed to deliver. Firecrawl/Spider never produced rows (0 from CRE Consultants / LSI / IPC / SVN) and is not being revived.
- Corridor character generator project is complete at Step 4.5. No further steps.
- Memory + corridor-character plan doc updated to reflect this.

## 2026-05-27 (Sonnet 4.6 · main) — END OF DAY SUMMARY

### What shipped today (main is current)

**PR #43 MERGED** — Step 4.5 type-conditional voice (`TYPE_VOICE_BLOCKS` + `buildSystemInstructions()` in `synthesize-corridor-character.mts`, 6 corridor types). Corridor character generator Steps 0–4.5 fully complete.

**housing-swfl brain** — Redfin Tier 1 Parquet → master. 125 SWFL ZIPs live (Jan 2026 vintage):

- Median sale price $400K (-3.5% YoY)
- Median DOM 72 days
- Sale-to-list 95.2%
- 4.4% sold above list · 20.8% off-market in 2 weeks
- Direction: mixed (bearish price pressure, DOM rising, below-ask sales)
  Three Parquet quirks fixed post-ship: `REGION_TYPE = 'zip code'` (not 'zip'), all numerics stored as VARCHAR (added `toNum()` helper), `zip_code` stored as `'Zip Code: XXXXX'` prefix (stripped in rowShape).

**master v54** — 15 upstreams including housing-swfl, 343 concept tags, 0 orphans. Also unblocked a pre-existing stale cre-swfl cache (17 MarketBeat orphan slugs from PR #18, pipeline deleted in PR #41 but cached output persisted — force-rebuilt).

**synthesis-agent null guard** — Stage 3 no longer crashes when Anthropic returns `{}` for tool_use input.

**vocab** — 135 total concepts (added 6 today: 5 housing-swfl metrics + `laus_lee_unemployment_rate_yoy_delta`).

### What's next

- **synthesis-agent test** — `synthesis-agent.test.mts` with two cases: mock returns `{}` → assert `[]` + warn log; mock returns fact with "approximately" → assert stripped.
- **FDOT year\_ column drift** — `data_lake.fdot_aadt_fl.year_` column missing in Tier 2; `fdot-source.test.mts` fails when `env.source=live`. Schema dump needed.
- **Collier permits v2** — pagination + per-permit detail fetch (v1 is first-page-only, 10/page, no real issued_date). Monitor June 5 cron for first real Collier data month.
- **months_of_supply in housing-swfl** — `"NA"` for all 125 ZIPs in current Parquet. Metric conditionally omitted (correct). Check a future vintage to see if Redfin publishes ZIP-level MOS.

## 2026-05-27 (Sonnet 4.6 · main) — chore: delete stale package-lock.json

- `package-lock.json` deleted (created by a prior session that ran `npm install` instead of `bun add`). `package-lock.json` added to `.gitignore` to prevent recurrence.
- No functional change. Project continues to use Bun (`bun.lock`).

Format per entry (newest at top):

```
## YYYY-MM-DD HH:MM (model · branch)
- What changed (1–3 lines, present tense, file paths welcome)
- What's next / what's blocked
- Links: PR #, issue #, plan path
```

If a hook blocks your push, that's the system working. Fix the entry, then push.

---

## 2026-05-27 (Sonnet 4.6 · main) — fix(housing-swfl): live Parquet quirks fully resolved, master v54

- `refinery/sources/housing-source.mts`: three live-Parquet discoveries fixed: (1) `REGION_TYPE = 'zip code'` (not 'zip'); (2) `PERIOD_DURATION = 90` (not 1) — filter removed; (3) all numeric columns are VARCHAR strings (read_csv_auto infers VARCHAR when 'NA' mixes with decimals) — added `toNum()` helper replacing raw `Number()` casts; (4) `zip_code` stores `'Zip Code: XXXXX'` prefix — stripped in rowShape.
- `refinery/packs/housing-swfl.mts`: key_metrics now use conditional push (omit when null) instead of `"n/a"` string fallback — validator requires `typeof number` for extensive/intensive metrics. months_of_supply correctly absent (Redfin stores 'NA' for all SWFL ZIPs in this vintage).
- `refinery/vocab/brain-vocabulary.json`: 6 new concepts (5 housing-swfl metrics + `laus_lee_unemployment_rate_yoy_delta`). Total: 135.
- `brains/cre-swfl.md`: force-rebuilt (v44) to evict stale MarketBeat metrics (17 orphan slugs from PR #18 — pipeline was deleted in PR #41 but cached output persisted). marketbeat_swfl=0, 0 orphans.
- `brains/master.md`: v54 — 15 upstreams including housing-swfl, 343 concept tags, 0 orphans. DONE.
- Next: PR #43 merge (Step 4.5 type-conditional voice) — still needs 3-step verification.

## 2026-05-27 (Opus 4.7 · main) — fix(synthesis-agent): Stage 3 null guard + universal smoothing-token scrub

- `refinery/agents/synthesis-agent.mts`: (1) null guard after `parsed = toolUse.input` — when Anthropic returns `{}` or drops the `facts` key, log raw input and return `[]` instead of crashing Stage 3 with `for (const fact of agentFacts)` over undefined. (2) Universal smoothing-language ban added to `SYSTEM_INSTRUCTIONS` — was only a per-pack suggestion in cre-swfl's synthesisContext. (3) Scrubbing pass strips surviving smoothing tokens from `fact.fact`/`fact.value` via shared `SMOOTHING_TOKENS` (imported from `refinery/lib/smoothing-tokens.mts` to stay drift-locked with the Stage 4 lint). Stage 4 `smoothing-lint.mts` abort remains as final safety net.
- Untouched: `smoothing-lint.mts`, `SMOOTHING_TOKENS`, `3-synthesis.mts`.
- Follow-up (next session homework): `synthesis-agent.test.mts` with two cases — mock returns `{}` input → assert `[]` + warn log; mock returns fact with "approximately" → assert stripped.

## 2026-05-27 (Sonnet 4.6 · main) — feat: housing-swfl brain (Redfin Tier 1 Parquet → master)

- `refinery/sources/housing-source.mts`: new DuckDB source reading `s3://lake-tier1/market/redfin_swfl.parquet` via `makeDuckDBSource` with `parquetViews`. SQL filters `PROPERTY_TYPE='All Residential' AND PERIOD_DURATION=1`, uses `QUALIFY ROW_NUMBER()=1` to get latest period per ZIP. All 21 columns aliased lowercase. `HousingZipRow` interface exported.
- `refinery/packs/housing-swfl.mts`: leaf pack (skip triage + synthesis, input_brains=[]). 6 key_metrics: median sale price, DOM, months of supply, sale-to-list ratio, sold above list, off-market-in-2-weeks. Vote-based `classifyDirection()` uses DOM/inventory/sale-to-list/MOS for bullish/bearish/neutral/mixed. Fixture run: 6 ZIPs → clean `--- OUTPUT ---` block.
- `refinery/__fixtures__/housing-swfl.sample.json`: 6 SWFL ZIP rows (Fort Myers, Naples, Punta Gorda, North Port, Cape Coral).
- `refinery/packs/index.mts` + `refinery/packs/master.mts`: housingSwfl registered; master `sources` + `input_brains` wired with `edge_type: "input"`.
- `ingest/duckdb_pipelines/redfin_swfl/constants.py`: `PACK_ID` set to `"housing-swfl"`, comments updated.
- Next: run live build once Parquet S3 access confirmed (`npm run refinery housing-swfl`), then `npm run refinery master`.
- Plan: `C:\Users\ethan\.claude\plans\lets-get-this-redfin-graceful-avalanche.md`

## 2026-05-27 (Opus 4.7 · main) — wire Naples (Collier) permits into permits-swfl brain

- `refinery/sources/permits-source.mts`: exports new `PermitBucket` + `NormalizedPermitRow`; Lee `fetch()` now maps DB rows → unified shape (`permit_uid="lee:"+permit_id`, `county="lee"`). Existing `LeePermitRow` interface kept for the raw DB shape.
- `refinery/sources/collier-permits-source.mts` (new, ~170 LOC): SELECT against `data_lake.collier_building_permits`, per-source `mapCollierRow` (drops NULL bucket + NULL date with module-level counters exposed via `getCollierDroppedRowCounts()`). Citation TTL 2592000s (monthly XLSX cadence) on the source's `citationMeta`.
- `refinery/packs/permits-swfl.mts`: sources `[permitsSource, collierPermitsSource]`; `PermitWithCorridor` extends `NormalizedPermitRow`; `buildSnapshot` adds `lee_weighted_z` + `collier_weighted_z` + `swfl_weighted_z` (renamed from `county_weighted_z`), `lee_saturation_index` / `collier_saturation_index` / `swfl_saturation_index`, per-county top heating/cooling, per-county `*_backfill_months` + `*_max_issued_date`; `buildSourceMeta(scope: "lee" | "collier" | "swfl")` selects URL + fetched*at + citation text; conclusion prose detects Lee/Naples divergence + stale-feed + zero-row fallbacks; 7 new caveats (NULL bucket, NULL date, zero rows, 60d stale Collier, 14d stale Lee, < 6 month Collier baseline). Additive emission per master grep — `permits_lee*_`keys all preserved (cre-swfl reads them); new keys`permits*swfl*_`, `permits*collier*\*` shipped alongside.
- `refinery/lib/corridor-assignment.mts`: added optional `county?: "lee" | "collier"` to `CorridorCentroid`.
- `fixtures/corridor-centroids.json`: merged 10 Naples centroids in; explicit `county` field on all 26 rows. `fixtures/collier-corridor-centroids.json` deleted (was only referenced by `geocoder.py:_CENTROIDS_PATH`).
- `ingest/pipelines/collier_permits/geocoder.py`: repointed `_CENTROIDS_PATH` to the unified file; `load_collier_centroids()` filters on `county == "collier"`.
- `refinery/vocab/brain-vocabulary.json`: 6 new concepts (`permits_swfl_*`, `permits_collier_*`) + slug_index entries — required because Stage 2.5 normalize was failing cre-swfl with orphan-concept errors on the new metric names.
- `refinery/__fixtures__/permits-collier.sample.json` (new): 17 rows in raw Collier DB shape, 15 valid + 1 NULL-bucket + 1 NULL-date for caveat exercise.
- Verification: 26/26 permits-related tests green. Live mode brain build wrote `brains/permits-swfl.md` v7 — 6 Naples corridors in the sidecar (Davis, Immokalee, Pine Ridge, US-41 Tamiami, Vanderbilt-Mercato, Waterside, real n_current 10–24). Load-bearing `Collier z-scores are based on 0 months of data` caveat fires correctly in live mode (Collier launched 2026-05-27 — caveat protects master from treating Naples z-scores as authoritative until ~Q4 2026).
- cre-swfl Stage 2.5 normalize now passes (0 orphans against new metric names). cre-swfl Stage 3 synthesis-agent failure is unrelated — Anthropic API returned a tool_use without `facts` populated; downstream of normalize-stage and not introduced by this change.
- Next: monitor June 5 cron — Collier ingest should pull May 2026 XLSX via the repointed centroid filter; brain should pick up another month's history and start drawing down the `< 6 months` baseline caveat. Plan: `C:\Users\ethan\.claude\plans\need-to-plan-out-cosmic-goblet.md`.

## 2026-05-27 (Opus 4.7 · feat/step-4-5-type-conditional-voice) — PR #43 cleanup: rebase + bun.lock fix

- Rebased `feat/step-4-5-type-conditional-voice` onto current main, dropped the Collier permits double-commit (`c03ec4b`) that main already has as `ccb79b9`. Branch now: `/data-intel page` → Step 4.5 synthesizer + chart audit → log entry.
- Regenerated `bun.lock` to include react-markdown + remark-gfm + @tailwindcss/typography (the /data-intel commit updated `package.json` and `package-lock.json` but missed `bun.lock`; CI uses bun → `bun install --frozen-lockfile` was failing).
- Deleted dead `feat/corridor-character-generator-step-2` branch + worktree at `C:/Users/ethan/dev/brain-platform-corridor-step-2` (Step 2 work already squash-merged via PR #42).
- Fixed PR #43 title + description to describe Step 4.5 (was auto-PR boilerplate referencing Collier permits).
- Next: merge PR #43 after CI green.

## 2026-05-27 (Opus 4.7 · main) — wire GHA failures into cron-rebuild-failures.md (auto-capture + auto-resolve)

- `.github/workflows/log-cron-incident.yml`: new `workflow_run` listener watching 22 cron workflows (allowlist by `name:`). Two jobs: `record_failure` on `conclusion==failure` + `maybe_auto_resolve` on `conclusion==success && event==schedule`. `ref: main` checkout to avoid detached-HEAD; `concurrency` group per workflow name to serialize fail+resolve race.
- `.github/scripts/log-cron-incident.mjs` (~190 LOC): sentinel-anchored row insertion (`<!-- INCIDENT_TABLE_START -->` / `END`); kebab-name derived from `run.path`; symptom regex extraction; layered push-retry (fetch → reset → re-read → re-apply → re-commit); issue-comment via `gh issue comment -F`.
- `docs/cron-rebuild-failures.md`: sentinels + intro paragraph + `RESOLVED (auto)` Status key. Already on main via op-side commit.
- Sticky issue #44 (`Cron incident feed (do not close)`) opened; repo variables set: `CRON_INCIDENT_ISSUE_NUMBER=44`, `CRON_INCIDENT_LOGGER_ENABLED=true`, `CRON_INCIDENT_AUTO_RESOLVE_ENABLED=true`.
- Dry-run verified both modes: failure-mode row layout matches existing entries; resolve-mode correctly identifies `faf5-annual` OPEN row (the only one in the ledger).
- Kill switches: flip either variable to `false` from repo Settings → Variables. No code change needed to disable.
- Next: first real failure (likely `faf5-annual` next cron, or the `freshness-probe-daily` if a source has gone stale) is the live test. Watch issue #44 + ledger commits.
- Plan: `C:\Users\ethan\.claude\plans\just-set-up-cron-rebuild-failures-md-luminous-yeti.md`

## 2026-05-27 (Sonnet 4.6 · feat/step-4-5-type-conditional-voice) — feat: Step 4.5 type-conditional voice + chart audit

- `refinery/tools/synthesize-corridor-character.mts`: renames `SYSTEM_INSTRUCTIONS` → `SYSTEM_INSTRUCTIONS_BASE`, adds `TYPE_VOICE_BLOCKS` (6 corridor types: beachfront-tourism, highway-strip-mall, medical-anchored, anchor-dependent, industrial-flex, mixed-use-downtown), adds `buildSystemInstructions(corridorType)`. Each type block tells the synthesizer which signals to lead with, what speculative angle to take, and closes with a Broker Take instruction.
- `refinery/tools/verify-corridor-chart-blocks.mts`: new read-only audit tool — pulls 25 in-DB `character_chart` blocks, rebuilds fact packs from the same DB data, runs `lintChartBlock` against each. Exit 1 if any chart fails ±5% provenance (Step 4.5 parity check).
- Next: operator runs `bun refinery/tools/verify-corridor-chart-blocks.mts` to see which in-DB rows fail chart provenance → regenerate those under hardened lint. Then run `--preview` on the 5 spot-check corridors with type-conditional voice to validate framing fires.
- Plan: `C:\Users\ethan\.claude\plans\thoughts-a-plan-for-cheeky-cascade.md`

## 2026-05-27 (Sonnet 4.6 · main) — feat: /data-intel page

- Adds `app/data-intel/page.tsx` — static server component rendering `docs/data-intel.md` via `react-markdown` + `remark-gfm` + `@tailwindcss/typography`. Wired `@plugin` in `globals.css`, added file tracing in `next.config.ts`. Build clean, prerendered static.
- Next: live at `/data-intel` after Vercel deploy.

## 2026-05-27 (Sonnet 4.6 · main) — update cron-rebuild-failures ledger with WAF incident

- `docs/cron-rebuild-failures.md`: added `collier-permits-monthly` WAF incident row (RESOLVED). Updated Pre-flight First-Fire Pending note — WAF fix wired, monitor June 5th run.

## 2026-05-27 (Sonnet 4.6 · main) — fix collier_permits WAF + wire FIRECRAWL_API_KEY to GHA

- `ingest/pipelines/collier_permits/fetcher.py`: replaced `_make_session()` + plain requests with `scrape_with_actions(proxy="stealth")` via `ingest.lib.firecrawl_client` for listing-page discovery; XLSX binary download stays as direct `requests.get` with browser headers.
- `ingest/pipelines/collier_permits/pipeline.py`: removed `_make_session` import + session threading; `geocode_batch` already handles `session=None`.
- `.github/workflows/collier-permits-monthly.yml`: added `FIRECRAWL_API_KEY: ${{ secrets.FIRECRAWL_API_KEY }}` to env block (was missing — key was in secrets but not passed to job).
- 35/35 tests pass. June 5th cron is ready.
- Next: first live dispatch to confirm stealth scrape resolves listing-page HTML correctly.

## 2026-05-27 (Sonnet 4.6 · main) — add cron-rebuild-failures ledger

- Created `docs/cron-rebuild-failures.md`: operational incident ledger for GHA workflows + daily rebuild. 13 historical incidents logged. Fixed 3 OPEN/BLOCKED rows that were already RESOLVED by PR #41 (deleted broker pipelines). Completed Pre-flight section with `faf5-annual` DDL gap + `collier-permits-monthly` first-fire pending row.
- Next: log `collier-permits-monthly` WAF failure to the ledger once the workaround is in.

## 2026-05-27 (Opus 4.7 · main) — promote collier_permits to active cadence

- Moved `collier_permits` from `not_yet_running:` → `pipelines:` (tier-2) in `ingest/cadence_registry.yaml`. April 2026 XLSX loaded last night by operator (table already populated; today's GHA dispatch failed because Collier WAF turned on between last night's load and morning).
- Next: WAF workaround for future months (Firecrawl/Spider stealth layer in `ingest/pipelines/collier_permits/fetcher.py` — same pattern as Lee Accela). Brain UNION into `permits-swfl` pack still queued.
- PR: none (direct main); plan: `~/.claude/plans/check-out-the-updates-woolly-cocke.md`.

## 2026-05-27 (Sonnet 4.6 · main) — ledger + cadence registry cleanup

- `docs/cron-rebuild-failures.md`: added CORRIDOR_ALIASES incident row (commit `d3db10c`), Recurring Patterns section (2 patterns: secret-not-wired, corridor-rename-without-alias-sync), Pre-flight note for the 4 newly-fired pipelines.
- `ingest/cadence_registry.yaml`: promoted fred_g17 + bls_ppi + census_vip + redfin_swfl from `not_yet_running:` → `pipelines:`. All 4 ran successfully 2026-05-27 (redfin: 66,672 rows / 125 ZIPs — first-ever run confirmed).
- Next: collier-permits-monthly first cron June 5; faf5-annual DDL still OPEN.

## 2026-05-27 (Sonnet 4.6 · main) — fire dormant pipelines + CI/rebuild fixes

- `workflow_dispatch` fired on 4 dormant pipelines: census-vip ✅, bls-ppi ✅, fred-g17 ✅, redfin (in progress). Fixed `redfin-monthly.yml` actions versions (@v6 → @v4/v5) before firing.
- Fixed daily-rebuild: added `FRED_API_KEY` to env in `daily-rebuild.yml` (was missing — caused macro-us failure daily since the pipeline shipped).
- Fixed CI: `CORRIDOR_ALIASES` had stale slugs for Bonita Beach + Daniels Pkwy renames from Step 4; updated `refinery/lib/corridor-aliases.mts` to `bonita-beach-rd-bonita-beach` + `daniels-pkwy`. All 7 alias tests pass.
- Next: verify redfin completes; move census-vip/bls-ppi/fred-g17 from `not_yet_running:` → `pipelines:` in `cadence_registry.yaml` after first rows confirmed; PR #43 verification still pending.

## 2026-05-27 (Sonnet 4.6 · cleanup) — branch merges + Step 4.5 on PR #43

- Squash-merged open PRs #39 (spider_client fix) + #41 (kill 3 dead broker pipelines) into main at `9bcc579`. Resolved 10+ conflict areas manually (modify/delete, add/add on Python files, SESSION_LOG conflict markers, cadence_registry collier_permits re-append).
- Merged 4 public scroll story branches into `builder-saimum-landing/main` (data/scene3-tables → assets/photography-references → ref/hbar-chart-and-screenshots → concept/scroll-story-v2). All 4 remote branches deleted from `builder-saimum-landing`.
- Step 4.5 work on PR #43 (`feat/step-4-5-type-conditional-voice` at `60d854f`): type-conditional voice blocks in synthesizer (`TYPE_VOICE_BLOCKS` + `buildSystemInstructions()` in `synthesize-corridor-character.mts`), `verify-corridor-chart-blocks.mts` audit tool. PR title corrected.
- Deleted stale local branches: merge-open-prs, public-main-merge. `feat/corridor-character-generator-step-2` skipped — worktree live at `C:/Users/ethan/dev/brain-platform-corridor-step-2`.
- Next: 3-step verification before merging PR #43: (1) run chart-block audit against live DB, (2) re-run any failing corridors, (3) spot-check 5 corridors for type-conditional framing. Step 5 (broker overlay) still gated on Firecrawl/Spider ingest unblock.
- PR #43: https://github.com/ethanrickyjrjr-wq/brain-platform/pull/43

## 2026-05-27 (Sonnet 4.6 · main) — docs: industry character system — 7 audience voices

- Creates `docs/superpowers/plans/2026-05-26-industry-characters/` with README + 7 voice spec files (01-main-street through 07-local-pulse).
- README covers DB schema, 5-tier routing cascade, keyword→voice table, Phase 0 shared infra (0A–0H), build order, and verification rubric. Each voice file covers audience, data sources, fact-pack shape, web query template, system preamble, and speculative framing notes.
- Next: Phase 0 blocked on Step 4 5/5 operator sign-off; Collier permits DDL + live run still pending.
- Plan: `docs/superpowers/plans/2026-05-26-industry-characters/README.md`

## 2026-05-27 (Sonnet 4.6 · main) — docs: data intelligence catalog + API source mining

- Creates `docs/data-intel.md` — master data catalog (11 domains, 55+ dataset rows) with status badges (LIVE/COLD/PARTIAL/PIPELINE EXISTS/SCRAPED/SOURCE KNOWN/GAP), table locations, brain consumers, and notes.
- Mined 4 API sources this session: NeighborhoodScout (scraped), USF library guide, public-apis/public-apis GitHub README (1881 lines), marcelscruz/public-apis JSON (1586 entries). Net additions: RentCast, Realie, OpenAQ, GDELT, QWI, ZBP, SOMA, RHFS, Community Resilience Estimates, AQICN, Open-Meteo, NWS, CDC, Medicare, OpenCorporates, Yelp, Adzuna, Socrata, EIA, USDA NASS, SEC EDGAR, OpenSky, and more.
- Priority table lists 14 actionable free sources; GDELT + RentCast + ZBP are highest ROI.
- Next: Step 4 corridor character still queued; Collier permits pipeline DDL + first live run pending.

## 2026-05-27 (Sonnet 4.6 · main) — feat(ingest): Collier County building permits pipeline

- Ships `ingest/pipelines/collier_permits/` (fetcher + normalizer + geocoder + dlt pipeline + 35 tests, 35/35 pass). Dry-run confirmed: 5030 rows from April 2026 XLSX.
- Key design: listing-page parser (URLs not predictable), Census batch geocoder (free, no key), haversine corridor assignment via `fixtures/collier-corridor-centroids.json` (10 Naples corridors). Issued-only; Applied series requires compound PK.
- Also ships: `docs/sql/20260527_collier_building_permits.sql`, `.github/workflows/collier-permits-monthly.yml`, `openpyxl` added to requirements, `collier_permits` added to `cadence_registry.yaml` `not_yet_running:`.
- Next: run DDL in Supabase, trigger first live run (`workflow_dispatch`), verify rows + move cadence entry to `pipelines:`. Brain UNION (permits-swfl consuming both tables) is a follow-up PR.

## 2026-05-27 (Opus 4.7 · main) — PR #42 merged → main at `99b062e`

- Squash-free merge (`gh pr merge --merge`) preserved all 4 atomic commits on main so C4 (`df486ab`) stays independently revertable if the live `/api/b/cre-swfl?view=speak&tier=2` smoke flags anything unexpected.
- Branch deleted from remote. Local main synced at `99b062e`.
- Test plan now waiting on Vercel deploy + daily-rebuild fire to regenerate cre-swfl brain markdown picking up the new `character_render` from 25/26 corridors.
- Phase 1 follow-up tracked: Veterans Pkwy citations-drop diagnostic (will resolve naturally when industry voices run — absorption-vs-name signal in builders-edge / main-street voices).

## 2026-05-27 (Opus 4.7 · feat/corridor-character-generator-step-4) — Step 4 SHIPPED: 25/26 corridors on new structured character output

Step 4 of the corridor-character generator landed in DB. 25 corridors carry `character_facts` / `character_speculative` / `character_chart` / `character_citations` from the Anthropic-grounded synthesizer; 1 (Veterans Pkwy / Colonial Blvd) stays on legacy `character` cold fallback — model dropped citations object on 2 deterministic retries (only corridor with negative absorption; deeper investigation deferred to Phase 1 voices, where the same-fix-path applies). Legacy `character` preserved on all 26 per plan retention rule.

Key surgery:

- `refinery/tools/run-corridor-character-preview.mts` (new) — Stage A driver: hydrates fact pack from Supabase (corridor_profiles + marketbeat_swfl + bls_laus) + downloads grounded NDJSON from lake-tier1 + invokes synthesizer + dumps preview JSONs (lint pass → `{slug}.json`, lint fail → `{slug}.rejected.json`). CLI `--corridor` / `--corridors` / `--grounded-dir` / `--output-dir`.
- `refinery/tools/write-corridor-character-to-db.mts` (new) — DB writer: reads `*.json` previews (skips `.rejected.json`), UPSERTs 6 character\_\* columns on corridor_profiles. Idempotent. CLI `--dry-run` for sanity. Split from preview tool so operator can write to DB without re-firing $0.35/corridor Anthropic calls.
- `refinery/sources/cre-source.mts` — `composeCharacterRender` flipped: prefers `character_facts` over legacy `character` (cold fallback only when facts is null); appends `character_speculative` as labeled second section; broker overlay still stacks inside facts head. 4 new structured fields on `CorridorNormalized` (character_facts/speculative/chart/citations + generated_at + fact_pack_vintage). Backwards-compat: 2-arg calls still work (4 new test cases for structured-output paths).
- `refinery/sources/bls-laus-source.mts` — exported `buildLausSwflSummary` + `DbRow` + `FL_FIPS`/`LEE_FIPS`/`COLLIER_FIPS` constants so the new driver consumes the source-of-truth summary builder instead of duplicating its logic. Surgical (additive `export` keywords); not a behavioral change.
- `refinery/validate/speculative-block-lint.mts` — three new principled exemptions: year [1900-2099] bare 4-digit ints, SWFL highway designators (US/I/SR/CR + digits), `[web-N]` upgraded from ±60-char window to sentence-scope (citation = sourced ≠ inferred). 7 new test cases including the U.S. 41 sentence-splitter edge littlebird called out.
- `refinery/validate/chart-block-lint.mts` — provenance enforcement: every numeric cell must trace to fact pack (±5% tolerance, mirrors anchors check). String cells (labels, units) and null cells bypass. 4 new test cases.
- `refinery/tools/synthesize-corridor-character.mts` — prompt iterations: facts-block softening-token strip on web cites + ❌/✅ examples; chart-block fact-pack-only with shape guidance; speculative-block predictions-not-declines with example pairs; highway-designator full-prefix-only. Defensive parseToolUse for partial tool_use payloads (coerce missing fields to legal-but-empty, let lint decide). New `acceptLintFailure` flag for preview-mode callers.
- `ingest/pipelines/corridor_grounded/pipeline.py` — env loading (.env.local + .dlt/secrets.toml fallback for DESTINATION\_\_POSTGRES\_\_CREDENTIALS), required `name: "web_search"` field on tool definition (verified against live Anthropic docs 2026-05-27 — 400 invalid_request_error without it), `ORDER BY city` not non-existent `county` column. Regression test pins the no-filter SQL shape.
- Schema migration applied via Supabase Studio (ALTER TABLE corridor_profiles ADD 6 character\_\* columns IF NOT EXISTS).
- Corridor renames in DB + 3 fixtures + alias map: `Bonita Beach Rd (US-41 to Sanibel Causeway)` → `Bonita Beach Rd / Bonita Beach` (Sanibel pull-in confirmed dropped: 0 mentions in new output, was 4+ in stale); `Daniels Pkwy (I-75 to Ben Hill Griffin)` → `Daniels Pkwy`.

Tests: bun lint suite 24 → 34 (+10), cre-source 23 → 27 (+4), corridor_grounded pipeline 14 → 15 (+1 regression). All green. Typecheck clean for changed files.

Cost: ~$22 total (Stage B grounded ×26 ≈ $9; Stage C synthesis 2 full passes + iteration ≈ $13).

Next:

- Veterans Pkwy iteration — Phase 1 follow-up; deterministic citations-object drop is the diagnostic.
- Live `/api/b/cre-swfl?view=speak&tier=2` smoke after deploy + daily-rebuild fires.
- Operator-deferred ("outside tweaks later"): I-75 Naples coverage gap (new corridor or routing layer), freshness UX wave logo + sources page, citation footnote rendering (Step 5), Vacancy-date-transparency framing, 11 data-gap-priority items.

Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`
Audit trail: `docs/superpowers/plans/2026-05-26-corridor-character-generator/audits/step4-{fact-packs,spot-checks,review-clean}.md`

## 2026-05-26 (Sonnet 4.6 · main) — PR #40 merged into main

- Squash-merged PR #40 (`feat/corridor-character-generator-step-2`) → main at `8c4a737`; branch deleted from remote.
- Lands: `build-corridor-fact-pack.mts`, `synthesize-corridor-character.mts`, corridor-character lints, `corridor_grounded` pipeline, `extract_client.py`/`spider_client.py`, dates lib, slug-parity fixture + tests (738 pass).
- Next: Step 4 — Stage A driver (`--preview` against all 26 corridors) + operator 5-corridor spot-check. Fresh session required.

## 2026-05-26 (Opus 4.7 · feat/corridor-character-generator-step-2) — Step 3 audit follow-up: 3 commits closing 7 audit items

Outside-eyes audit on Step 2 surfaced 8 findings; this push lands fixes for #2 through #8. Item #1 (spider_client extraction_schema wrapper regression on commit `0028522`) is a merge-ordering concern, not a step-2 issue: B1's grounded pipeline uses Anthropic `web_search` and never reaches firecrawl→spider, so the fix correctly lives on `fix/firecrawl-agent-client` and propagates here on rebase after that PR lands.

- `ca58c29` `fix(refinery): snap month-end + Feb 29 date arithmetic in fact pack` — `buildPermitsTrailing6Mo` + `buildZoriRentIndex` were using JS native `setUTCMonth/setUTCFullYear`, which overflow Aug 31 −6mo → Mar 3 (not Feb 28) and Feb 29 −1y → Mar 1 (not Feb 28). Added `subtractMonthsUtc` + `subtractYearsUtc` to `refinery/lib/dates.mts` with last-day-of-month snap. End-to-end effect: the permits delta sign flips on the Aug-31 case and ZORI YoY unblocks on Feb 29 latest periods. (audit #2, #3)
- `ccadb51` `fix(validate): cross-check dangling [web-N] anchors in speculative block` — orchestrator was resolving anchors only on `facts_block`, letting `[web-99]` slip through `speculative_block` and break the renderer. Extracted `findDanglingAnchorErrors()`, called on both blocks. Marker presence still optional on speculative (pure `[inference]` allowed); any web/internal anchor that DOES appear must resolve. (audit #4)
- `d676f69` `fix(ingest): pipeline exit code, URL-safe storage key, slug parity, monkeypatch hygiene` — corridor_grounded/pipeline.py now returns 1 on partial failure (was 0 → silent GHA green) (#5); storage object key uses `strftime('%Y%m%dT%H%M%SZ')` instead of raw `isoformat()` (`:` and `+` URL-encode to `%2B`, breaking lookback) (#6); test_extract_client.py Case 7 rewritten with `monkeypatch.delenv` — prior `if "SPIDER_API_KEY" in os.environ:` guard made the test vacuously pass when the var wasn't ambient (#8); `fixtures/corridor-slug-parity.json` pins the slug() rule with 33 cases (26 verified corridors verbatim + 7 edge cases), parity tests in BOTH TS (`refinery/tools/corridor-slug-parity.test.mts`) and Python (`test_pipeline.py::test_slug_parity_python_side`) trip on any divergence between the two independent implementations (#7).

Test deltas: bun suite **687 → 738 pass** (+51 new tests across `dates.test.mts`, fact-pack regressions, orchestrator REJECTs, and 33 TS slug-parity cases) / 0 fail / 56 files. Pytest local-touched suites: 20/20 (slug parity Python-side + storage-key URL-safety + Case 7 rewrite). Typecheck: zero new real type errors (+2 `bun:test`-import baseline noise matching every other test file in the project).

- Next per plan: Step 4 in a fresh session — run `--preview` against all 26 corridors, operator eyes on 5 spot-checks against the snapshot baseline using the plan's 5-point rubric, then build the Stage A driver that wires fact-pack → grounded-NDJSON → synthesizer → DB writer.
- Branch is shippable on its own (Steps 2+3 done, no regressions). Operator decision pending: open PR now or bundle Step 4 in the same branch.
- Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`

## 2026-05-26 18:52 (Opus 4.7 · feat/corridor-character-generator-step-2) — Step 2 C1+C2 + Stage A tests

- C1 synthesizer: new `refinery/tools/synthesize-corridor-character.mts` — single Anthropic call (`claude-sonnet-4-6`, forced tool_use for structured output), reads B1's grounded NDJSON via `readGroundedNdjson()`, threads `citations[]` into the model prompt as `[web-N]` anchors, and emits a three-block JSON `{facts_block, chart_block, speculative_block, citations}`. After the model returns, the orchestrator lint stack runs; a malformed run THROWS and the DB write path is never reached (Step 3 acceptance). CLI flags: `--corridor=<name>` + `--preview` (write `--write-db` is intentionally unimplemented in v1 — Step 4 owns the DB driver). Library-only entrypoint `synthesizeCorridorCharacter()` is what tests + the eventual Stage A driver call.
- C2 lint stack (split per the plan's three-file ask): `refinery/validate/speculative-block-lint.mts` enforces verbatim `Speculative — double-check` disclaimer + REQUIRES hedging tokens around any inferred number (inverted polarity vs facts — smoothing tokens are REQUIRED here, BANNED in the facts block); `refinery/validate/chart-block-lint.mts` does structural `{title, columns: string[], rows: (string|number|null)[][]}` validation with `rows[i].length === columns.length`; `refinery/validate/corridor-character-lint.mts` orchestrates (facts: smoothing + inference-bait + citation-match → speculative: disclaimer + hedging + citation-match → chart). Exports `CorridorCharacterOutput`, `SPECULATIVE_DISCLAIMER`, `lintCorridorCharacterOutput()`.
- Stage A test coverage (gap closed): `refinery/tools/build-corridor-fact-pack.test.mts` + shared `refinery/tools/corridor-character-fixtures.mts` (Naples full-data + Pine Ridge sparse fixtures used by both Stage A and Stage C suites). Stage C tests at `refinery/tools/synthesize-corridor-character.test.mts` exercise the synthesizer with a mocked Anthropic client — 7 explicit `REJECT:` cases covering missing disclaimer, unhedged inferred number, smoothing token in facts, no citation markers, dangling `[web-N]` (the "made-up tenant" shape), malformed chart_block, and no-tool_use response.
- Tests: 50 new across 3 new test files; full suite green at **687 pass / 0 fail / 54 files**. Typecheck delta: 0 new errors (15 pre-existing, all in unrelated files).
- Next: Step 4 — run all 26 corridors via `--preview` for operator sign-off, then build the Stage A driver that wires fact-pack → grounded-NDJSON → synthesizer → DB writer.
- Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`

## 2026-05-26 (Opus 4.7 · feat/corridor-character-generator-step-2) — Step 2 A1+A2: fact pack builder + SQL migration

- New `refinery/tools/build-corridor-fact-pack.mts`: pure function `buildCorridorFactPack(input)` returning `CorridorFactPack`. Computes 9 decision-relevant metrics (cap_rate, vacancy_rate, absorption_sqft, asking_rent_psf w/ marketbeat YoY math, unemployment_rate via BLS LAUS, zori_rent_index w/ YoY %, permits_trailing_6mo Lee-only, nfip_claim_frequency non-storm 3v3 baseline, fdot_aadt length-weighted). Null values carry one-line `gap_reason` per plan rule 3. No IO — caller pre-filters Supabase rows. `fact_pack_vintage = OLDEST-YYYY-MM` from scanned source vintages.
- New `docs/sql/20260526_corridor_character_generator.sql`: idempotent ADD COLUMN IF NOT EXISTS for `character_facts TEXT`, `character_chart JSONB`, `character_speculative TEXT`, `character_citations JSONB`, `character_generated_at TIMESTAMPTZ`, `character_fact_pack_vintage TEXT`. Per-column COMMENT ON documents two-block contract, citation JSONB shape, disclaimer requirement, and CLAUDE.md rule 8 carve-out. Legacy `character` untouched (cold fallback per Step 5).
- Test gap flagged: no `build-corridor-fact-pack.test.mts` yet — C1+C2 subagent owns shared fixtures + Stage A coverage in same PR.
- Next: C1 (synthesize-corridor-character.mts) + C2 (lint stack split by block) — sequential, both Opus, can start now that A1+B1 contracts are stable.
- Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`

## 2026-05-26 (Sonnet 4.6 · feat/corridor-character-generator-step-2) — Step 2 B1: corridor_grounded pipeline

- New `ingest/pipelines/corridor_grounded/pipeline.py`: one Anthropic `web_search_20250305` call per corridor (`--corridor NAME` / `--all`); captures full `model_dump()` response + flattened `citations[]` as NDJSON to `lake-tier1/corridor_grounded/{slug}/year=YYYY/month=MM/run-{iso}.ndjson`. `--dry-run` writes to `/tmp/{slug}-{date}.ndjson` for smoke acceptance. Tool-version guard: emits WARNING when `cited_text_count == 0` (the `20260209` regression signal).
- 12 unit tests green: `slug`, `_extract_citations` (dedup + null), `build_record` shape/zero-citations/full-response, `to_ndjson` NDJSON + unicode.
- `ingest/cadence_registry.yaml`: `corridor_grounded` entry under `not_yet_running` with `lake-tier1/corridor_grounded/` prefix key.
- Next: A1 (fact pack builder, TS) and A2 (SQL migration DDL) being built in parallel on this branch. B1 is the Python ingest half; C1+C2 (synthesizer + lint) depend on A1 + B1 contracts being stable.
- Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`

## 2026-05-26 (Sonnet 4.6 · chore/kill-corridor-narratives-pipeline) — SWFL CRE intel probe script + GHA workflow

- New `scripts/swfl_cre_intel_probe.py`: two-vendor extract() probe across 3 URL tiers (CW MarketBeat PDFs, Colliers SWFL HTML, academic/editorial). Confirmed-live URLs sourced from live search (CW industrial + office Q1 2026, Colliers retail Q3 2025 + office/industrial Q1 2026, FGCU RERI Q1 2026); retail CW PDF URL pattern-guessed. Dead-URL table in docstring matches brief exactly. `_bootstrap()` loads `.env.local` so script runs directly.
- New `.github/workflows/swfl-cre-intel-probe.yml`: manual `workflow_dispatch` with optional `tier` input, uploads `cre-intel-results.json` as artifact (14d retention). Uses existing `FIRECRAWL_API_KEY` + `SPIDER_API_KEY` repo secrets — no local `.env.local` needed.
- Next: `gh workflow run swfl-cre-intel-probe.yml` → inspect artifact → update BROKER_SOURCES in corridor_narratives + any surviving marketbeat URL list with confirmed working URLs.

## 2026-05-26 (Opus 4.7 · chore/kill-corridor-narratives-pipeline) — also kill marketbeat_swfl + county_planning_swfl

- Live dry-runs against the fixed wrapper (PR #39 latest) confirmed the same pattern as corridor: spider successfully scrapes the pages but the LLM extracts only null-field rows because the actual data (rents, vacancy, absorption) isn't on the broker landing pages — it lives in linked PDFs that change URL every quarter or behind CoStar/LoopNet paywalls. County planning hub pages have the same shape problem.
- Marketbeat: cushmanwakefield + lsicompanies returned 1 row each via spider, both with every field null → pipeline correctly raised `ValidationError`. cpswfl returned 0 rows. The wrapper does its job; the data source is the wrong shape. County: cancelled after 3-minute window per operator directive.
- Deleted: `ingest/pipelines/marketbeat_swfl/` + `ingest/pipelines/county_planning_swfl/` + `.github/workflows/marketbeat-quarterly.yml` + `.github/workflows/county-planning-monthly.yml`. Stripped `not_yet_running:` rows from `cadence_registry.yaml`; dropped both names from the `FIRECRAWL_API_KEY` comment in `.env.example`; removed the cron-clash comment in `bls-laus-monthly.yml`.
- **Preserved** (downstream consumers, untouched): `refinery/sources/marketbeat-swfl-source.mts`, `refinery/packs/cre-swfl.mts`, `refinery/lib/marketbeat-submarket-aliases.mts`, `refinery/__fixtures__/marketbeat-swfl.sample.json`, `docs/sql/20260525_marketbeat_swfl.sql`, `app/r/source/_tables.ts` provenance row. The `data_lake.marketbeat_swfl` table stays empty; cre-swfl already handles the empty case gracefully. Future data backfill from a real source (CoStar / direct broker feeds / outreach response) writes to the same table; brain pack picks it up automatically.
- PR #41 retitled + body updated to cover all 3 pipeline kills. Sibling PR #39 (wrapper + spider fallback as durable infra) keeps its scope unchanged.

## 2026-05-26 (Opus 4.7 · chore/kill-corridor-narratives-pipeline) — delete dead broker-scrape pipeline

- `corridor_narratives` is superseded by the v2 corridor-character-generator (`ingest/pipelines/corridor_grounded/`, B1 shipped on `feat/corridor-character-generator-step-2`). All 4 source broker URLs (creconsultants, lsicompanies, ipcswfl, svnswfl) are 404 or 525-blocked; pipeline has never produced a row. v2 uses Anthropic `web_search_20260209` for grounded citations — different directory, different schema, no dependency on the deleted pipeline or its `_pending` quarantine column.
- Deleted: `ingest/pipelines/corridor_narratives/` (pipeline.py, test_pipeline.py, **init**.py) + `.github/workflows/corridor-narratives-quarterly.yml` + `docs/sql/20260525_corridor_broker_narrative_pending.sql` (v1 quarantine column; v2's migration at `20260526_corridor_character_generator.sql` adds `character_facts`/`_chart`/`_speculative`/`_citations`/`_generated_at`/`_fact_pack_vintage` — no consumer for `_pending`).
- Bookkeeping: removed corridor_narratives row from `ingest/cadence_registry.yaml not_yet_running:`; dropped corridor_narratives from `FIRECRAWL_API_KEY` consumer list in `ingest/.env.example`; updated cron-clash comment in `bls-laus-monthly.yml`.
- Sibling PR (#39, `fix/firecrawl-agent-client`) keeps the firecrawl + spider extraction wrapper as durable infra — that has general value for future firecrawl-backed pipelines. This PR is the housekeeping that should have been a separate diff from the start.

## 2026-05-26 (Opus 4.7 · fix/firecrawl-agent-client) — extract timeout + GHA wall-clock tuning

- Corridor + county dry-runs hit GHA's 15m/20m wall-clock without ever reaching a vendor traceback — firecrawl SDK was still polling at the kill. Marketbeat (3 URLs) finished in 9m and surfaced both vendor errors cleanly; corridor (4 URLs) couldn't make the same window. Confirms firecrawl agent polling time scales roughly per-URL.
- `extract()` default `timeout` lowered 900 → 480s so spider fallback always gets a real turn. GHA workflow `timeout-minutes` bumped 15→25 (corridor + marketbeat) and 20→25 (county) — combined budget of 8m firecrawl + ~12m spider per-URL fits comfortably under 25m even on the worst-case dead-URL run.
- Cancelled in-flight county run (was using the pre-fix spider body shape; would have timed out anyway). Marketbeat already finished and surfaced the spider 400 — that diagnostic was what enabled the schema-shape fix in the previous commit.

## 2026-05-26 (Opus 4.7 · fix/firecrawl-agent-client) — spider /ai/scrape request-shape fix

- Live GHA dry-runs on `fix/firecrawl-agent-client` surfaced two real failures: (1) firecrawl agent terminal `status=failed` with `Refusal: Error: Agent reached max credits (credits_used=0, job_id=None)` — vendor-side refusal before any work; (2) spider returning HTTP 400 with empty body on every URL. Root cause for spider: `extraction_schema` was being sent as OpenAI-style `{name, description, schema: JSON-encoded string, strict: bool}` wrapper, but spider's OpenAPI spec defines `extraction_schema: object` — a raw JSON Schema, no wrapper.
- Verified vendor-first against `spider.cloud/openapi.yaml`: spider's `/ai/scrape` body is `allOf(RequestParams, AIRequestExtras)`; `extraction_schema` is a plain object; `stealth`/`anti_bot`/`proxy_enabled` are top-level RequestParams fields (current placement correct); required field is `prompt` (current naming correct).
- Fix in `ingest/lib/spider_client.py`: `ai_scrape()` now forwards `schema` directly as `extraction_schema=schema`. Removed unused `schema_name`/`schema_description` parameters and the `json` import. `_post()` error message now includes request body keys + parsed response keys when present, so future empty-body 400s yield actionable debugging info instead of `returned 400: `.
- 14/14 tests still green (extract_client tests mock at the boundary, no breakage from signature change). Next: re-trigger dry-runs against the new commit; firecrawl refusal still needs separate diagnosis but spider fallback should now actually deliver rows.

## 2026-05-26 (Opus 4.7 · fix/firecrawl-agent-client) — firecrawl /v2/agent polling fix + spider fallback layer

- Root cause: `ingest/lib/firecrawl_client.py:agent()` was a single sync POST that returned the job-ID payload, never polled `GET /v2/agent/<id>`. Three pipelines (corridor_narratives, marketbeat_swfl, county_planning_swfl) were silently failing with "zero rows" because the extractor was reading `data.result.rows` on `{success, id}` — finds nothing → empty. Vendor-first verified `firecrawl-py>=4.28.0` already implements correct polling via `Firecrawl().agent()`.
- Wrapper fix: `agent()` now delegates to the SDK; raises `FirecrawlError` on terminal non-completed status (`failed` / `cancelled`) so silent-empty stops being a failure mode. `extract_agent_rows()` reads `data.rows` first; keeps legacy `data.result.rows` + `result.rows` as defensive fallbacks. 7 mocked tests cover happy + failed + legacy + empty + missing-key paths.
- Fallback layer (operator-requested, same PR): new `ingest/lib/spider_client.py` wraps `https://api.spider.cloud/ai/scrape` (defensive response parsing — OpenAPI spec underdocumented); new `ingest/lib/extract_client.py` `extract()` tries firecrawl across all URLs → on empty/error, per-URL spider fallback. Returns firecrawl-shape dict + `_provenance` log; raises `ExtractError` only when both vendors fail loudly per URL. 7 fallback tests green. 3 pipelines swapped to `extract()`; `SPIDER_API_KEY` wired to 3 GHA workflow env blocks + `ingest/.env.example`. Pipelines stay running on firecrawl-only when `SPIDER_API_KEY` unset.
- Why bundled: shared root cause (single client, three consumers); spider rescue is the durable answer to the silent-fail vendor lock-in.
- Discovery (use spider triage before next PR): all 4 corridor_narratives BROKER_SOURCES URLs are dead — `creconsultants.com/research/` 404, `lsicompanies.com/market-reports/` 404, `ipcswfl.com/research/` 525, `svnswfl.com/market-reports` 525. Wrapper fix surfaces this loudly now; URL audit is a separate follow-up PR per the corridor-broker-promotion plan Step 1.
- Followup commit on same branch: `spider_client.ai_scrape()` now sets `stealth=True` + `anti_bot=True` + `proxy_enabled=True` by default. Spider's `/unblocker` endpoint per OpenAPI only takes `RequestParams` (no `prompt`/`extraction_schema`), so chaining unblocker → re-extract would have been two round-trips; setting the same RequestParams flags on `/ai/scrape` does the unblock-then-extract in one call. This is the durable answer for the 525-blocked broker pages (`ipcswfl.com`, `svnswfl.com`).
- Next: live dry-runs (`gh workflow run corridor-narratives-quarterly.yml -f dry_run=true`, same for county-planning + marketbeat) to confirm spider rescue path lights up. Then URL audit follow-up.

---

## 2026-05-26 (Opus 4.7 · main) — corridor character generator Step 1 SHIPPED + tool-version correction

- Step 1 (Anthropic web_search verification + smoke against Pine Ridge Rd Naples) done. Vendor-first WebFetch confirmed contract; ran two questions through `web_search_20260209` then an A/B with `web_search_20250305` on Q1 after observing zero `cited_text` spans in the dynamic-filtering variant. Same prompt, same model, same `allowed_domains`: `20260209` returned 0 cited spans (Claude pipes content through code-execution and emits text from Python variables); `20250305` returned 9 verbatim cited spans with raw publisher URLs. **Corrected tool-version pick from `20260209` → `20250305`** in the v2 plan, the research doc (correction note at top), and memory. Anthropic-as-vendor unchanged.
- Other findings: `news-press.com` and `naplesnews.com` block Anthropic's crawler — API rejects allowlist with 400. Pine Ridge–specific NNN rents are not on the open web (paywalled in LoopNet/CoStar) — facts block will have to surface this as `{value: null, gap_reason: ...}` and let the speculative block do the inference work. Token budget for the full generator is ~$30/yr at `20250305`.
- Files: `docs/vendor-notes/anthropic-web-search-wire-up.md` (Step 1 deliverable — full Q&A, A/B table, blocked-publisher list, verified seed allowlist, parallel-eligible Step-2 task split for Opus + Sonnet), `docs/vendor-notes/anthropic-web-search-smoke-output.json` + `anthropic-web-search-compare-output.json` (raw API responses), `scripts/smoke/anthropic_web_search_smoke.py` + `anthropic_web_search_compare.py` (re-runnable). Plan + research doc + memory + this log carry the correction. `pip install anthropic` added a setup dep — flag for ingest pipeline `requirements.txt` work in Step 2 B1.
- Next: Step 2 (Pine Ridge end-to-end generator) — A1 Stage A fact pack builder + A2 SQL migration can run in parallel on Opus; B1 Stage B Python pipeline runs against the verified `20250305` contract on Sonnet; C1+C2 synthesis + lint stack are Opus-sequential after A+B contracts firm. Worktree pattern recommended. Plan path: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`. Wire-up doc: `docs/vendor-notes/anthropic-web-search-wire-up.md`.

---

## 2026-05-26 (Sonnet 4.6 · main) — CCPM installed + corridor character generator epic wired to GitHub

- Installed CCPM (agentskills.io PM skill) into `.claude/skills/ccpm/` — gives any session a live `standup.sh` + GitHub Issues source of truth instead of relying on SESSION_LOG alone. Motivated by 4-5 parallel sessions with no shared state.
- Created corridor character generator epic in CCPM: `.claude/prds/corridor-character-generator.md` + `.claude/epics/corridor-character-generator/` with 5 task files (34.md–38.md). Synced to GitHub: epic #33, tasks #34–#38 (`ethanrickyjrjr-wq/brain-platform`).
- Step 1 (vendor verification) was already DONE by a prior Opus session — discovered from untracked `docs/vendor-notes/anthropic-web-search-wire-up.md`. Critical finding: **use `web_search_20250305`, NOT `web_search_20260209`** (dynamic filtering kills citations — 0 `cited_text` spans). Posted finding on GitHub epic #33 and closed issue #34.
- Step 2 parallel decomposition from wire-up doc posted to GitHub: Batch A (fact pack builder + SQL migration, parallel) → Batch B (corridor_grounded pipeline, `web_search_20250305`) → Batch C (synthesizer + lint stack).
- Next: any session picking up Step 2 should read `docs/vendor-notes/anthropic-web-search-wire-up.md` first, then `gh issue view 35` for acceptance criteria. Branch: `feat/corridor-character-generator-step-2`.

## 2026-05-26 (Opus 4.7 · main) — corridor character generator v2 plan propagation

- Locked v2 plan for replacing `corridor_profiles.character` (24–26 May-era Claude-drafted strings) with a two-block generator output: facts block (strict, sourced, lint-tight) + speculative block (AI unleashed with inline "Speculative — double-check" disclaimer). Optional chart block when comparison is useful. Sources chart page at the bottom of every answer carries citations + freshness token + legal/disclaimer (NOT in the answer body).
- Anthropic `web_search_20260209` locked as the grounded-search vendor. Decision rationale captured in `docs/vendor-notes/grounded-search-research-2026-05-26.md` from a 7-vendor background research run; per-claim citations with `cited_text` spans + raw publisher URLs + `ANTHROPIC_API_KEY` already wired. Three-vendor bake-off skipped — structural pick was clear.
- Propagation shipped in this commit: canonical plan at `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`; vendor research at `docs/vendor-notes/grounded-search-research-2026-05-26.md`; CLAUDE.md SWFL Protocol rule 8 carries an in-place carve-out exempting the speculative block from the smoothing-tokens ban; ontology-and-roadmap.md bumped to v1.6 with a new "Future-vision items (post-character-generator)" section (FL-other-cities comparison, statewide/national anchors, forecasts, outlier brain, BYO overlay, Tavily helper — all gated, none start before the generator ships one full cycle); memory `project_corridor-character-generator.md` indexed in MEMORY.md as a high-visibility ACTIVE PLAN pointer.
- Next: Step 1 — Anthropic web_search vendor-first check + smoke test against one corridor (Pine Ridge Rd Naples). Gated on operator availability. Plan path: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`.

---

## 2026-05-26 (Opus 4.7 · main) — corridor character snapshot baseline

- Froze the live `corridor_profiles.character` strings into a committed baseline at `docs/audits/2026-05-26-corridor-character-snapshot.md` (26 corridors · 10 Collier · 16 Lee · 0 unknown-county · 0 pending broker narratives). Source: `refinery/tools/pull-corridor-character-snapshot.mts` (re-runnable; same-day re-runs are byte-identical). Renames an earlier audit-mode puller; strips the per-row decision-checkbox template — file is a data snapshot, not a worksheet. Reverted the `docs/audits/*-corridor-character-audit.md` gitignore rule. Added `npm run snapshot:corridor-character`. Carries along the parallel-session commit `20692fc` (bare-env fix) onto origin/main.
- Why now: the May-2026 Claude-drafted character strings are about to be replaced by a corridor-character generator (deterministic local data pack + Gemini grounded answer → cited prose). Need a diff baseline + restore safety before the live column gets rewritten.
- Next: vendor-first check on the Gemini grounding API (model ID, grounded-answer response shape, citation format) before scoping the generator pipeline. Do not start the generator until that check is in-session.

---

## 2026-05-26 (Opus 4.7 · main) — env names: BRAINS\_ no longer required

- Finished the 2026-05-25 env normalization. Code now reads canonical bare `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` first, with `BRAINS_SUPABASE_*` as legacy fallback (matches the `service-role.ts` pattern from PR #19/#30). Updated: `refinery/config/env.mts:76-82`, `refinery/lib/predictions-log.mts:97-104`, `refinery/lib/predictions-log.test.mts` (clears both pairs), `scripts/lake-probe.mts:8-10`. Stale doc comments fixed: `refinery/tools/embed-all-concepts.mts`, `refinery/packs/cre-swfl.mts`, `.claude/commands/vault.md`, `utils/supabase/service-role.ts`.
- Why this slipped: PR #19 normalized `.env.example` + the GHA cron wrappers but left the runtime code reading `BRAINS_`-prefixed only. Anyone running with a fresh `.env.local` (bare names only) hit "missing env" — Ricky just hit it via `npm run audit:corridor-character`. The legacy fallback stays per `docs/littlebird-notes/2026-05-26.md`: "Don't cleanup the fallback first" — Vercel still has the legacy names.
- Verified: `bun test refinery/lib/predictions-log.test.mts` 5/5 pass; `npx tsc --noEmit -p .` clean.
- Next: when Vercel env is renamed, one-line PR to delete the `??` legacy fallback in each of the 4 code sites.

---

## 2026-05-26 (Opus 4.7 · main) — cleanup pass

- Merged PR #32 (`acee6aa`) and PR #29 (`ca0a099`). main is at `ca0a099`. Zero open PRs.
- Resolved PR #29's SESSION_LOG.md conflict in the `brain-platform-permits` worktree by taking origin/main's version (which had the corrective Opus entry from PR #32) — no content was lost. Merge commit on the branch: `1a14e85`, squashed into `ca0a099` on merge.
- Cleaned up 4 stale remote branches (`feat/permits-swfl-v2`, `feat/firecrawl-pipelines`, `feat/firecrawl-pipelines-github-actions`, `fix/waitlist-resend-lazy-init`) — all confirmed merged via PRs #29/#17/#15/#16. Removed the permits worktree. Force-deleted 2 stale local branches (squash-merge orphans).
- Final remote: only `origin/main`. Final local: only `main`. Working tree: only the untracked `docs/superpowers/plans/2026-05-26-corridor-broker-narrative-promotion/` directory (operator's, not from any session).
- Next: operator refresh — `git pull` in any other sessions, point Sonnet at the worktree pattern (`git worktree add ../brain-platform-<branch> <branch>`) for the next parallel run.

## 2026-05-26 (Opus 4.7 · fix/redfin-dry-run)

- Restored the Opus race-condition entry below that the prior `9c514eb` commit dropped (append-only violation: Sonnet edited from a stale read of SESSION_LOG.md and rewrote my entry with an older version).
- No code changes; SESSION_LOG.md only. This is a corrective commit so the eventual merge to main does not silently delete the warning entry already on origin/main.
- Lesson for the next session: **before editing SESSION_LOG.md, `git pull` first and confirm you see every prior session's entry.** If your edit would remove any line of any prior `## YYYY-MM-DD (model · ...)` block, stop — you're working from a stale base.

## 2026-05-26 (Sonnet 4.6 · fix/redfin-dry-run)

- Added `--dry-run` to `ingest/duckdb_pipelines/redfin_swfl/pipeline.py` + `test_dry_run.py`.
- Last of the not-yet-running pipelines missing the flag; all 8 now covered.
- Next: merge PR #29 and this PR after CI green.

## 2026-05-26 (Sonnet 4.6 · feat/permits-swfl-v2)

- Rebased `feat/permits-swfl-v2` (651c102) onto main (c19d3ca); 1 commit, clean.
- Added `--dry-run` to `ingest/pipelines/lee_permits/pipeline.py` + test; 33/33 green.
- Updates PR #29 (already open); no new PR needed.
- Next: merge PR #29 after CI green; add `--dry-run` to `redfin_swfl` on separate branch.

## 2026-05-26 (Opus 4.7 · main)

- Shipped enforced session-log mechanism + commit/push autonomy rubric. Five files: `SESSION_LOG.md` (this), `CLAUDE.md` (RULE 0 + RULE 1 at top, behind `<!-- SESSION-LOG-RULE-MARKER -->`), `.claude/hooks/print-session-log.mjs` (SessionStart: prints last 8 entries + verifies marker), `.claude/hooks/check-session-log-on-push.mjs` (PreToolUse Bash: blocks `git push` when no commit ahead touched SESSION_LOG.md), `.claude/settings.json` (wired).
- RULE 1 authorizes Claude to commit + push small/policy/tooling changes without asking, and lists what still requires a diff review (brain pack math, ingest→data_lake, schema migrations, multi-file refactors, anything affecting live `/api/b/*` or MCP).
- Race condition discovered mid-build: a parallel Sonnet 4.6 session sharing this working tree picked up my untracked `SESSION_LOG.md`, committed it onto `feat/permits-swfl-v2`, and switched HEAD under me. Sonnet's own entry will arrive on `main` when PR #29 merges — expect a 30-second conflict on this file, resolve by keeping both entry blocks. **Operator action needed: use `git worktree add` for parallel Claude sessions, not the same working tree.**
- Memory: `project_session-log-mechanism.md` + high-visibility pointer at top of MEMORY.md.
- Pushing this commit now under RULE 1 authority.

## 2026-05-25 (prior session · main)

- Seed entry — see git log for c19d3ca (GHA unblock + brand scrub), 86435b8 (Lane D fully live), c3b9d0a (waitlist env-name fallback #30).
