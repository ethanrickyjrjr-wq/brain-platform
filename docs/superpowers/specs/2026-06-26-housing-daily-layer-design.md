# Design — housing-swfl daily layer (ZIP-grain active-listings + 3-city web median)

**Date:** 2026-06-26
**Status:** Design approved (operator), pending spec review → implementation plan.
**Brain:** `housing-swfl` · **Pack:** `refinery/packs/housing-swfl.mts`

---

## Problem

`/r/housing-swfl` sits on **monthly Redfin** data with a data window ending ~2026-01-01, built 2026-06-03. The page never moves day to day. Meanwhile the platform ingests real daily housing signals that are siloed elsewhere:
- `data_lake.active_listings_residential` — daily region-wide active listings (Lee/Collier/Charlotte/Sarasota), **ZIP-grain** (each row carries `zip_code`). Consumer today: only `active-listings-swfl`.
- `data_lake.daily_truth` — daily web-sourced median sale price for 3 cities (Cape Coral, Fort Myers, Naples). Consumer today: only `freshness-pulse`.

Now that `daily-rebuild` can push to `main` again (PAT fix, 2026-06-26), a daily layer in `housing-swfl` will actually reach users every morning.

## Hard constraint (the moat)

Four-lane / no-invention. The daily **web** median (3-city, sold-side, lane-3) and the monthly **Redfin** median (125-ZIP, sold-side, lane-1) are different methodology AND different grain. They MUST NOT be merged into one number. Disaggregating a city median to ZIPs is invention — forbidden. List-side (asking) ≠ sold-side; always labeled.

## Design — one brain, two clearly-dated layers

Monthly Redfin stays the **structural backbone** (existing 6 metrics + 125-ZIP sold `detail_table`, untouched). A **daily layer** is added alongside. Conclusion prose leads with what moved today, then anchors to the monthly structure. Every metric self-cites its source + as-of date (MM/DD/YYYY); nothing blended.

### New source connectors

1. **`active-listings-housing-source.mts` (NEW) — daily, ZIP-grain.**
   One **aggregated SQL query** against `data_lake.active_listings_residential` (aggregate at source — never haul rows):
   - Per ZIP: `count(*)` active inventory, `median(list_price)`, `median(days_on_market)`, `max(scraped_at)` as the as-of.
   - One region rollup row (all in-scope ZIPs).
   - Filter `source_name='active_listings_seed'` (RESO feed swaps the same table later).
   Feeds: a NEW daily ZIP `detail_table` + region-level daily `key_metrics`.

2. **`daily-median-source.mts` (NEW) — daily, 3-city.**
   Latest row per area from `data_lake.daily_truth` where `metric_key='median_sale_price'` (mirror `freshness-pulse`'s read). Emits one clearly-labeled **"daily sold median (web, 3 cities)"** signal — the swappable slot for a future real daily-sold feed.

### New / extended metrics

Daily layer (region-level `key_metrics`, each with its own source + as-of):
- `housing_daily_active_inventory_swfl` — active listings count (our data)
- `housing_daily_list_price_swfl` — median **list** price (our data, labeled asking)
- `housing_daily_dom_swfl` — median DOM of active listings (our data)
- `housing_daily_sold_median_web_swfl` — 3-city web sold median (named web source, labeled)

Monthly layer — emit the 5 already-queried-but-dropped Redfin fields:
- `housing_median_list_price_swfl`, `housing_median_ppsf_swfl`, `housing_price_drops_pct_swfl`, `housing_pending_sales_swfl`, `housing_median_sale_price_mom_swfl`

### Output structure

- `key_metrics`: monthly (6 existing + 5 new) + daily (4 new). Each carries `source` + as-of.
- `detail_tables`: existing 125-ZIP monthly sold table (unchanged) **+ NEW daily ZIP table** (active inventory / list price / DOM per ZIP, as-of today).
- `conclusion`: leads with the daily movement (inventory + list price direction), then the monthly anchor. List-side vs sold-side stated explicitly.

## Forward-compatibility (the "daily sales" slot)

`housing_daily_sold_median_web_swfl` is a **named slot**, not a hard dependency on the web. When a licensed daily-sold feed (MLS/RESO sold) lands, it replaces the source behind this slot — the metric id, page section, and prose framing stay; only the connector + label ("web, 3 cities" → "MLS sold, ZIP") change. Same pattern as `active_listings`' `source_name` swap.

## Out of scope (already handled elsewhere)

The 3 new Redfin parquets (`price_drops`, `contract_cancellations`, `delistings_relistings`, ingested 2026-06-14) feed **`seller-stress-swfl`** (`refinery/packs/seller-stress-swfl.mts` + its 3 stress sources already exist). The housing page cross-renders that brain's signals. They are "in housing" via that existing cross-brain section — NOT duplicated into this pack.

## Ship discipline

- Register every new metric slug in `refinery/vocab/brain-vocabulary.json` in the **same commit** (orphan linter aborts the GHA rebuild otherwise).
- Pre-push Gate 2 (vocab/alias) + Gate 5 (pack ⇆ catalog + bun:test) apply.
- Rebuild with `bun refinery/cli.mts master --target-only` (avoid clobbering parallel sessions; avoid the cre-swfl egress hang).
- Pack `key_metrics` shape/math change = RULE 1 ask-first (approved for this work).

## Verify during planning (not yet confirmed)

- `data_lake.active_listings_residential` exact column names + that DuckDB/Postgres `median()` (or `percentile_cont`) is the right aggregate for the lane it lives in.
- `data_lake.daily_truth` schema (column names for area / metric_key / value / retrieved_at) — read `freshness-pulse`'s source to mirror exactly.
- `housing-swfl.mts` `BrainOutput` typing for multi-source `sources: []` + per-metric `source` provenance (already supported; confirm the daily metrics thread their own as-of, not the build token).
- Whether the daily ZIP `detail_table` should cap rows or show all in-scope ZIPs with data.

## Non-goals

- No ZIP-level daily *sold* median (no web source; disaggregation = invention).
- No change to the monthly Redfin metrics' math.
- No frontend redesign — the existing `app/r/housing-swfl/page.tsx` already renders `key_metrics` + `detail_tables`; new metrics/table flow through it.
