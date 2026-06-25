# JRW Active Residential Listings — pipeline + brain (design)

**Date:** 2026-06-25 · **Status:** approved (operator chose "full hardened build in one shot") · **Branch:** main

## Goal

Land **region-wide SWFL residential active listings** from John R. Wood (johnrwood.com,
FGCMLS-powered IDX) into `data_lake.active_listings_residential` so the platform has **real
residential numbers to run on and benchmark against today** — before per-user RESO connections
exist. When RESO tokens land (Bridge `swfl_mls` / Trestle `nabor`, currently un-credentialed) the
same table is populated from the licensed feed; **the scrape is the "for now," RESO is the swap.**

## Why scrape and not RESO (decided this session)

`lib/reso/` (committed `f64f1bc1`) is the licensed channel and returns the same fields, but it is
**scaffolded only — no tokens exist** (`gh secret list` / `gh variable list` / `.dlt/secrets.toml`
all clean; only `client.test.ts` mock values). It cannot pull one live row. RESO is also currently
**per-user** (`member_mls_id` filter). So the scrape is the only source of real region-wide numbers
right now. Table shape is RESO-compatible so the future feed is a drop-in (RESO `ListingKey`→`mls_id`,
`StandardStatus`→`status`, `PostalCode`→`zip_code`, etc.).

## What we verified live (RULE 0.4/0.5, in-session)

- crawl4ai **0.9.0**; `AsyncHTTPCrawlerStrategy` + `HTTPCrawlerConfig` available.
- JRW list is **server-rendered HTML** (FGCMLS IDX). A browser render **virtualizes the list to ~4
  cards + adds a Google-Maps price-pin layer** (noise). The **raw HTTP fetch returns all 12 cards/page,
  full prices, every field** — so we fetch with crawl4ai's **HTTP strategy, not the browser.**
- robots.txt: `User-agent: *` allows `/listings/` and `/listing/*`; only favorites/user/count paths
  disallowed. `?page=N` paginates; `?county=Collier|Lee|...` filters.
- Card = `a.listing__link[href*='/listing/']`. Fields: `.listing__price-value` (full $), `.listing__city`,
  `.listing__state`, `.listing__subdivision` (community), `.listing__address-display` (street),
  dedicated `.listing__property-detail {bed,bath,lot-size,sqft,days-on-market}`, `.listing__mls__number`.
  `mls_id` + `zip` are in the href: `/listing/{MLS_ID}/{street}-{city}-fl-{ZIP}/`.

## Table — `data_lake.active_listings_residential` (new)

PK `(source_name, mls_id)` → idempotent merge, multi-source ready. `source_name='john_r_wood'`.
Columns: `list_price, street_address, city, community, beds, baths, sqft, acres, days_on_market,
status, property_type, zip_code, county, state, listing_url, scraped_at, _ingested_at`. `zip_code` is
the **site** address ZIP from the listing URL (ZIP gate G1 ✓). Migration `GRANT`s + `NOTIFY pgrst`.

## Pipeline — `ingest/pipelines/jrw_listings/`

- `extract.py` — crawl4ai `AsyncHTTPCrawlerStrategy` GET of `?county={C}&page={N}` for the SWFL
  counties JRW covers (Collier, Lee, Charlotte, Sarasota; Glades/Hendry return 0), paginate until a
  page yields 0 new cards or a hard page cap; dedup by `mls_id`; parse cards with the selectors above;
  drop any row whose `zip_code` is not in `fixtures/swfl-zip-county.json` (scope guard, no invented geo).
- `distill.py` — normalize (parse "$17,950,000"→numeric, "5 Beds"→5, "0.34 Acres"→0.34, etc.),
  derive `county` from the ZIP fixture, upsert via psycopg `ON CONFLICT (source_name, mls_id)`.
- `pipeline.py` — `--dry-run` / `--county`; **volume guards** `assert_min_rows` + `assert_vs_baseline`
  (a blocked/empty scrape can never wipe the table); **fail loud** if every county returns 0 (matches
  crexi: silent fake-green is the enemy).

## Cron — parked until runner-IP proven

`.github/workflows/jrw-listings-daily.yml`: daily + `workflow_dispatch` + `dry_run` input,
`ENGINE_ENABLED` guard, crawl4ai-setup. Cadence entry uses `probe_mode: odd_window` (probe-excluded)
until a **green GHA run proves the datacenter IP isn't WAF-blocked** — the recurring scraper failure
(Collier, Crexi). Seed is run **locally (home IP, proven)** now. No pretending an unverified cron works.

## Brain — `active-listings-swfl` pack

Tier-2 reporter: inventory count, median ask price, avg DOM by ZIP/community (aggregated at source per
the operator decree — COUNT/median in SQL, not row-haul). Empty-tolerant. Vocab slugs registered in the
**same commit** (kills the orphan-slug master HOLD). Satisfies the brain-first ingest gate.

## Failure modes designed against (from the pipeline ledger)

WAF-from-runner (parked cron + HTTP-strategy + optional `CRAWL4AI_PROXY`) · schema drift (fixed DDL +
typed normalize) · orphan slug (vocab in same commit) · missing GRANT (in migration) · silent empty
(volume guards + fail-loud) · secret-not-wired (workflow `env:` block complete) · action-version
(`checkout@v6`/`setup-python@v5`, matching crexi) · browser virtualization (use HTTP strategy).

## Also in this PR

Bible refresh (drop Firecrawl from §2; add the anti-WAF/runner-IP + browser-virtualization scrape
standard and a cron-execution-freshness rule); `graphify:update`; SESSION_LOG entry.
