# Handoff — implement the housing-swfl daily layer

**Date:** 2026-06-26
**Status:** Design **approved by operator**. Spec written. **No code yet.** Ready to implement.
**Spec (read first):** `docs/superpowers/specs/2026-06-26-housing-daily-layer-design.md`

---

## One-line

Make `/r/housing-swfl` move every day: add a daily layer (ZIP-grain active-listings + a 3-city web sold-median) alongside the existing monthly Redfin backbone, with **nothing blended** and each number self-citing its source + as-of.

## Why this is now worth doing (context that landed on `main` today)

- **`daily-rebuild` was broken for days** — it built brains fine but couldn't push to `main` (`GH013`: ruleset requires PR + CI, bot has no bypass). Fixed 2026-06-26: `daily-rebuild.yml` checkout now pushes via `secrets.REBUILD_PAT` (a fine-grained PAT owned by the operator = the ruleset's bypass actor). **Proven** — run `28259145510` landed `0ad59f1` (city-pulse, freshness-pulse, master). So a daily layer here will actually reach users now.
- **`crawl4ai` wrapper rename** (`8fb76c9a`) — the `*crawl4ai*` gitignore had swallowed `ingest/lib/crawl4ai_client.py` (now `crawl_client.py`), breaking ~14 scrapers in CI. Fixed; that's why daily scrapers (incl. active-listings) can run.
- **active-listings cron un-parked** (`e3aaa08f`) — daily 09:00 UTC; ZIP-grain data flowing into `data_lake.active_listings_residential`. (Open: the full 4-county sweep 403s under load — see `docs/handoff/2026-06-26-active-listings-waf-proxy.md`. Single-county is clean; the table already holds ~9,368 rows.)

## Implementation order

1. **Probe the two daily tables first (do NOT assume schemas).**
   - `data_lake.active_listings_residential` — confirm columns (`zip_code`, `list_price`, `days_on_market`, `scraped_at`, `source_name`) and the right median aggregate for its lane (Postgres `percentile_cont` vs DuckDB `median`). Use the lake MCP (`mcp__lake__describe_view` / `query_lake`).
   - `data_lake.daily_truth` — mirror `refinery/packs/freshness-pulse.mts` + its source EXACTLY for the column names (area / metric_key / value / retrieved_at) and the "latest row per area" pattern.
2. **`refinery/sources/active-listings-housing-source.mts` (NEW)** — ONE aggregated SQL query (aggregate at source, never haul rows): per ZIP → `count(*)`, median list price, median DOM, `max(scraped_at)`; + a region rollup. Filter `source_name='active_listings_seed'`.
3. **`refinery/sources/daily-median-source.mts` (NEW)** — latest `median_sale_price` per area from `daily_truth` (3 cities). One clearly-labeled web sold-median signal (the swappable "daily sold" slot).
4. **`refinery/packs/housing-swfl.mts`** — add the daily `key_metrics` (4) + the 5 dropped Redfin fields; add a daily ZIP `detail_table`; rewrite the conclusion to lead with daily movement then anchor monthly. `sources: [housingSource, activeListingsHousingSource, dailyMedianSource]`. **Each daily metric threads its OWN `source` + as-of (MM/DD/YYYY) — never the build token.**
5. **`refinery/vocab/brain-vocabulary.json`** — register all new slugs **in the same commit** (orphan linter aborts the GHA rebuild otherwise). Run `bun refinery/tools/check-vocab-coverage.mts --all` + `bun test refinery/lib/corridor-aliases.test.mts` (Gate 2).
6. **Rebuild** — `bun refinery/cli.mts master --target-only` (avoid clobbering parallel sessions + the cre-swfl egress hang). Verify `brains/housing-swfl.md` carries the daily metrics + table.
7. **Gates** — Gate 5 (pack ⇆ catalog mirror + `bun:test` per pack); `bunx next build`.

## Landmines (this repo will bite you)

- **No-invention:** never merge the 3-city web median with the 125-ZIP Redfin median. No ZIP disaggregation of the city median (that's invention). List-side (asking) ≠ sold-side — label both.
- **Vocab + pack in the SAME commit**, or the daily GHA rebuild aborts in the gap.
- **`--target-only`** on the rebuild, or you clobber other sessions' `brains/*.md`.
- **as-of MM/DD/YYYY**, never the raw `SWFL-…-YYYYMMDD` freshness token (CI `display-leak.test.mts` blocks a leak).
- **Aggregate at source** (SQL COUNT/median), not `selectAllPaged` row-hauling — operator decree.
- **Parallel-session git chaos is live** — multiple agents commit to this repo at once; refs move between commands. Stage explicit paths, use `git commit --only`/pathspec, verify with `git show --stat HEAD`, and read remote truth via `gh api .../contents/...` when local refs disagree.
- **Pack `key_metrics` change = RULE 1 ask-first** — already approved for this spec; re-confirm before widening scope.

## Out of scope (already handled)

The 3 new Redfin parquets (`price_drops`, `contract_cancellations`, `delistings_relistings`) feed **`seller-stress-swfl`** (pack + 3 stress sources already exist); the housing page cross-renders that brain. Do NOT duplicate them into the housing pack.

## Files

- Spec: `docs/superpowers/specs/2026-06-26-housing-daily-layer-design.md`
- Pack: `refinery/packs/housing-swfl.mts` (emits 6 monthly metrics today; `by_metro` computed not emitted)
- Existing source: `refinery/sources/housing-source.mts` (queries 5 fields it never emits)
- Mirror for daily_truth read: `refinery/packs/freshness-pulse.mts`
- Page (already renders metrics + detail_tables): `app/r/housing-swfl/page.tsx`
- Active-listings follow-up: `docs/handoff/2026-06-26-active-listings-waf-proxy.md`
