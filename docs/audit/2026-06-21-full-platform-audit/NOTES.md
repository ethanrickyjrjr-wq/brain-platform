# Full-Platform Audit — Notes + TODOs (2026-06-21)

> Output of a 6-agent read-only audit (917K tokens) + hand-verification against live GHA logs.
> Scope: the website/app, graphify, the brain factory, data ingest, crawl4ai-in-repo, and the
> daily-breakage root cause. Every claim is grounded in files read this run; cites are `file:line`.
> This is the Step-1 deliverable for the operator's "look at the code / graphify / brains / data,
> take notes, make todos" pass. The crawl4ai deep-dive (3 live rounds) lives in
> `docs/audit/2026-06-21-crawl4ai-live/`.

---

## 0. The headline answer — "everything breaks every day, with no root"

**The daily flappers are `daily-rebuild` (11×) and `freshness-probe-daily` (4×). Their latest runs
are GREEN. They flap because three real defects recur AND because the logging pipeline records the
symptom but discards the cause.**

### The masking chain (why there is never a root)
1. A watched cron fails → `log-cron-incident.yml` fires.
2. `.github/scripts/lib/cron-run.mjs` `fetchLogTail` grabs only a **30-line tail** of the run log.
3. `.github/scripts/classify-cron-failure.mjs` pattern-matches that tail; anything it doesn't
   recognize (exit-1, type-mismatch, deterministic HOLD) falls to **`UNKNOWN`**.
4. The ledger row is written with Root Cause = **`_auto-captured; pending triage_`**.
5. `heal-cron-failure.yml` excludes `daily-rebuild` and only retries *transient* classes.
6. The next scheduled green run flips the row to **`RESOLVED (auto — self-healed, untriaged)`**.

Net: `docs/cron-rebuild-failures.md` is a **symptom log that auto-heals**, never a root-cause log.
The system is built to *capture + recover*, not to *diagnose*.

### The three real roots (found in the logs, never in the ledger)
| Cron | Ledger row | **Real root (live log)** | Fix class |
|---|---|---|---|
| `freshness-probe` 06-06 | "Traceback" → RESOLVED (auto) | `psycopg.errors.UndefinedTable: relation "data_lake.collier_parcels" does not exist` — `check_tier1_entry`/`run_probe` are **unguarded** so a missing table crashes (the "always exit 0" promise is false). Also 06-05 noaa_ghcn_rainfall, 05-29 `KeyError: dlt_schema_name`, 06-02 timeout. | guard `run_probe` |
| `daily-rebuild` 06-18 | "exit code 1" → RESOLVED (auto) | master **deterministic HOLD** — `_build-report.json` `failureClass: deterministic, reason: <master-input brain>.md not found` (a brain in master `sources[]` but not built/`input_brains[]`; same class as the fgcu-reri reconcile at `672180c`). Correct *loud* behavior; never triaged. | sources[]⇆input_brains[] invariant |
| `news-swfl` 06-20 | "exit code 1" → OPEN | crawl **succeeded**; dlt LOAD failed: `psycopg2.errors.DatatypeMismatch: column "published_date" is of type date but expression is of type character varying`. dlt never ALTERs an existing column → fails every run. **Misattributed to crawl4ai.** | ALTER COLUMN migration |

### Structural fragility multiplier
Every daily cron runs `pip install -r ingest/requirements.txt` — the **entire ~100-package tree**
(crawl4ai + playwright + patchright + `unclecode-litellm` + scipy/shapely/trimesh/pymupdf/nltk/…),
even `freshness-probe`, which uses only `psycopg` + `pyyaml`. So every daily run is exposed to the
full dependency surface (and Chromium download) of the heaviest pipeline. A yanked wheel or a PyPI
500 on any of those ~100 packages reddens a cron that doesn't use the package.

---

## 1. Website / Next.js app

**Stack (verified `package.json`):** Next 16.2.6 App Router (`runtime nodejs`, force-dynamic on
data/AI routes), React 19.2.4, Tailwind v4, Supabase SSR, `mcp-handler` + `@modelcontextprotocol/sdk`,
recharts + echarts, Anthropic SDK 0.69. ~37 page routes, 56 API handlers.

**The "One Assistant" unification is FURTHER ALONG than the trackers say.** There is exactly one AI
endpoint, `POST /api/assistant` → `lib/assistant/engine.ts` → dispatch on `report_id`:
- `runReportPath` (`lib/assistant/report-path.ts`) — the `/r/*` in-page ask dock; grounded single-turn;
  **emits chart frames** (proven: `scripts/.prove-chart-deflection-result.json` `fixed_with_chart_bad_rate:0`).
- `runConversationPath` (`lib/assistant/conversation-path.ts`) — PROJECT AI / OUTSIDE AI / public funnel;
  multi-turn; **text-only, no chart emit**.

- `/api/converse` + `/api/welcome/chat` are **fully DELETED** (not "thin deprecated forwarders" as
  build-queue.md:20 + several header comments still claim). Logic moved verbatim into
  `lib/assistant/{report,conversation}-path.ts`.
- **Client flip is effectively DONE**: every chat client already POSTs `/api/assistant`
  (`use-chat-stream.ts:55`, `BriefcaseChat.tsx:76/175`, `useWelcomeStream.ts:25`, `highlighter/converse.ts:104`).
  The open item is the *prod live-verify* (`one_assistant_unify_live_verify`), not the wiring.

**Verified gaps:** charts work on the report path but the conversation path tells the analyst it
*cannot* chart (`conversation-path.ts:96-100` INTERIM note; `routeChart` imported but only used for
grounding selection, never to emit). Two parallel grounded-prompt assemblies
(`conversation-path` inline vs `lib/grounded-answer.ts`) — a no-invention fix must touch both.

---

## 2. graphify (knowledge graph)

- `graphify-out/` is **gitignored** → absent in CI/fresh clone (RULE 0.5 grep/Glob fallback applies there).
  `graphify` CLI 0.8.41 installed + working locally (`graphify query` returns valid subgraphs).
- Merged `graph.json` (27.4 MB): **16,774 nodes / 27,437 edges**. Data plane: brain=29, slug=275,
  pipeline=63 + 15,898 untyped AST nodes. App plane (via `scripts/graphify-app-nodes.mjs`):
  lib_module=214, table=80, component=65, api_route=57, app_component=48, page=38, hook=7.
- **Split-brain**: app plane regenerated today at HEAD (`951ad3e2`); data plane + `GRAPH_REPORT.md` +
  communities are 102 commits behind (`4c259c11`, 2026-06-20). `graphify:publish` only refreshes the
  app overlay, not the data plane.
- **Footgun**: `graph.json` carries BOTH `links[]` (27,321, networkx-canonical, stale) AND `edges[]`
  (27,437). The app-nodes script appends 116 app edges to `edges[]` only — a consumer reading `links[]`
  silently misses the app plane.
- Two **orphaned** Python generators (`scripts/graphify/build-graph.py`, `export-ops-graph.py`) — in no
  npm script/doc/hook/workflow. **Node path supersedes them 1:1** (verified 2026-06-22): the `graphify` CLI
  builds `graph.json`; `scripts/graphify-publish.mjs` writes the SAME target the `.py` did
  (`swfldatagulf-ops/app/graph/brain-graph.json`) — plus the app plane the `.py` never had. The /ops
  `/graph` page reads that **committed JSON**; it runs **no python**. Safe to retire (build 16).

---

## 3. Brain factory (refinery/)

- Every vertical is one `PackDefinition` config object (`refinery/types/pack.mts`); engine is pack-agnostic.
- **It's actually FIVE stages, not four**: 1-ingest → 2-triage → **2.5-normalize (vocab bridge)** →
  3-synthesis → 4-output. Stage 2.5 (`stages/2.5-normalize.mts:446`) **throws on an orphan slug** and
  aborts the build — the load-bearing gate the "4-stage" framing omits.
- Thin-pipe rule is **structurally** enforced (downstream reads only the `--- OUTPUT ---` BrainOutput).
  Deterministic-math/narrative split is real; **master has zero LLM in its output path**
  (`master.mts:327` skip flags + `synthesisStrategy: 'deterministic'`).
- Exit codes: 0 clean / 2 transient-degraded-quiet / 1 loud (`resilient-build.mts:186` deriveExitCode),
  backstopped by an **independent, fail-closed** master-freeze watchdog (`master-freeze-watchdog.mts`).
- **Recurring breakage class**: master `sources[]` (30) ⇆ `input_brains[]` (30) drift. The DAG only
  walks `input_brains` (`dag.mts:49`); a source not in `input_brains` is fetched-but-never-built →
  deterministic master HOLD. Reconciled twice already (672180c; 06-18). **No automated gate verifies
  the two lists mirror.** (This IS the daily-rebuild flapper root.)
- Cosmetic: `brain-vocabulary.json` `meta.concept_count=214` but actual concepts=277 / slug_index=304;
  `meta.description` has Windows-1252 mojibake.

---

## 4. Data ingest

- Two families: **dlt→Postgres** (`ingest/pipelines/`, ~48 dirs, Tier-2 `data_lake.*`) and
  **DuckDB→Parquet** (`ingest/duckdb_pipelines/`, 11 dirs, Tier-1 Supabase Storage cold). Single source
  of truth = `ingest/cadence_registry.yaml`; `cadence_days` = SOURCE publish cadence, not run frequency.
- ~45 LIVE pipelines across: real-estate/housing (ZHVI, ZORI, Redfin ×6, FHFA, LeePA, Collier parcels,
  Realtor listings), economy/labor/macro (BLS LAUS/QCEW/OEWS/PPI, Census CBP/VIP, FRED ×3, FL DOR sales
  tax, FGCU RERI, swfl_inc, live-search median price/mortgage), tourism (FL DOR TDT, RSW airport),
  flood/hurricane/env (FEMA NFIP, HURDAT2, storm-history, USGS, NOAA rainfall), traffic/logistics
  (FDOT AADT, FAF5), CRE/corridor (MarketBeat/Colliers/MHS ODD PDFs, city_pulse + corridors),
  credit/licensing/safety/news (FL DBPR licenses/applicants/SIRS/press/notices, FDLE crime, news_swfl).
- PARKED (`not_yet_running:`): `sba_foia_franchise_outcomes`, `airdna_str_swfl`. ODD-window (manual-drop):
  crexi_listings, lee_associates_swfl, premier_commercial_swfl + svn_florida_swfl (**confirmed dead ends —
  no survey tables, stubs exit 1**), estero_edc, fmb_recovery.
- Freshness: tier-1 = `_tier1_inventory.updated_at`; tier-2 dlt = `_dlt_loads.inserted_at`; non-dlt =
  `MAX(freshness_column)`. PostgREST view-liveness probe catches missing GRANTs.
- Brain-first ingest gate is **policy, not mechanically enforced** (Gate 4 only enforces the
  destructive-replace non-null guard).

---

## 5. crawl4ai in-repo

- In-process Python SDK only, `crawl4ai==0.9.0` (`requirements.txt:19`, single source of truth — the
  `>=0.8.9 (line 14)` in older logs predates the 06-20 bump). **Confirmed firing here** (smoke test 5.7s).
- Three surfaces in `ingest/lib/crawl4ai_client.py`: `Crawl4aiSession` (UndetectedAdapter stealth,
  sequential, `js_code_before_wait`, `download_step`), `fetch_many` (MemoryAdaptiveDispatcher+RateLimiter),
  `fetch_page_markdown/html` (non-stealth static). `extract_client.py` adds `extract()` (stealth → strip →
  Haiku JSON, chunk+dedup) + `scrape_with_fallback()` (crawl4ai → spider → firecrawl, latter two dormant).
- In-process-only constraint is real: 0.9.0 remote server 400-rejects `js_code/proxy/cookies`; stealth can
  never move to the server. `CRAWL4AI_API_URL` consumed nowhere live.
- **`crawl4ai` pulls `unclecode-litellm==1.81.13` as a hard transitive dep regardless** — so the DIY-extract
  "avoid the litellm dependency" rationale in the 06-20 research is **moot** (litellm is installed anyway).
- **`supercrawl4ai.py` is fully built + tested but imported by ZERO pipelines/jobs** — every win (tables,
  fit_markdown, virtual_scroll, proxy, jitter, monitor) is dormant dead weight until a Phase-2 migration.
- **Crexi `extract.py:83` still hard-truncates `[:28000]` + single-scroll** — the highest-volume LLM source
  silently amputates rows; the no-truncation chunked rewrite was never routed through it.
- GHA stealth/non-stealth split is correct (patchright present exactly where UndetectedAdapter is used) but
  install COMMAND form is inconsistent across 11 jobs; `crawl4ai-doctor` missing from 4 jobs.
- `news_swfl/fetcher.py` bypasses the shared client (bare `AsyncWebCrawler`, no dispatcher/rate-limiter,
  per-source 10-article cap (`MAX_ARTICLES_PER_SOURCE = 10`) — ~40 total across the 4 sources).

---

## TODOs (consolidated, by priority)

### P0 — daily breakage, fix now
- [ ] **news_swfl `published_date`**: run an idempotent `ALTER COLUMN ... TYPE` (or fix the normalizer to
  emit a `date`) so the dlt LOAD stops failing every run. Verify exit 0 on a dispatch.
- [ ] **daily-rebuild diagnosis**: echo `_build-report.json` master `failureClass` + `reason` to stdout
  *before* `exit 1`, so the classifier records the actual held brain instead of `UNKNOWN`.

### P1 — stop the recurrence + restore truth
- [ ] **Guard the freshness probe**: wrap `run_probe` / `check_tier1_entry` (ingest/scripts/check_freshness.py:283-295)
  so a missing table or `KeyError: dlt_schema_name` can't crash it — honor the "always exit 0" contract.
- [ ] **master sources[]⇆input_brains[] invariant**: add a load-time check (sibling to the
  `config/packs.mts:389` public_label invariant) that every `makeBrainInputSource` source has a matching
  `input_brains` entry — throw at module load, not at the nightly rebuild.
- [ ] **Classifier rules**: extend `classify-cron-failure.mjs` with `DatatypeMismatch` (schema drift) and
  `deterministic HOLD` rules; widen `cron-run.mjs fetchLogTail` beyond 30 lines.
- [ ] **Crexi `[:28000]` truncation**: route Crexi through the chunked extractor (keep the scroll in a
  stateful `Crawl4aiSession`; apply `_chunk_text/_dedup_rows` to the full captured text).
- [ ] **Charts on the conversation path** (Phase 3A): port `buildChartForIntent` + chart-frame emit into
  `runConversationPath`; remove the INTERIM "cannot chart" note.

### P2 — hygiene / decisions
- [ ] Decide supercrawl4ai: adopt into Crexi (after the virtualized-vs-accumulating + GHA-IP probes) or
  park/remove it — it's untested-in-prod library weight today.
- [ ] Replace blind `delay_after` sleeps (dbpr_sirs 16s, crexi 5s+4s) with js row-count settle predicates.
- [ ] Re-baseline placeholder `expected_rows_min` floors (several are `1`).
- [ ] Slim the per-cron install: `freshness-probe`/rebuild-gate need only `psycopg`+`pyyaml`, not the full
  ingest tree — a minimal requirements file for probe-class jobs removes the biggest daily-failure surface.
- [ ] Run `bun run graphify:update` to resync the 102-commits-stale data plane; fix `links[]`/`edges[]` dup.
- [ ] Update stale docs: build-queue.md:20 + header comments ("deleted", not "deprecated forwarders");
  `grounded-answer.ts` `/api/converse` reference.

### P3 — lower
- [ ] De-dup the crexi JSON-fence logic onto `extract_client`. Fix the extract() timeout-unit ambiguity
  (480s→480000ms page_timeout). Migrate news_swfl onto the shared client. Delete/re-wire the two orphaned
  graphify Python generators. Fix `brain-vocabulary.json` meta count + mojibake. Decide fate of the 4
  dead CRE-broker ODD sources. Reconcile "4-stage" naming → 5 stages.
