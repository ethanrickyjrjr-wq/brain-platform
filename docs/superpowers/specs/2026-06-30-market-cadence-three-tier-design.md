# Market data — three-tier cadence (momentum / distribution / yield)

**Date:** 2026-06-30 · **Slug:** `market-cadence-three-tier` · supersedes the "two full market brains"
shape in `docs/superpowers/plans/2026-06-30-steadyapi-sole-spine/phase-3-market-brains.md`.

## Problem

Phase-3's brief proposed two full SteadyAPI market brains (`market-temperature`, `price-distribution`)
polled weekly. A code probe + a crawl4ai research pass (RULE 0.4/0.5) showed that shape both
**duplicates data we already hold free** and **polls a monthly-cadence source weekly** (false precision +
wasted metered calls).

## Research evidence (crawl4ai, 06/30/2026 — sources named, verbatim cadence)

The market moves at three speeds and every major shop cadences the same way:

| Tier | Metrics | Natural cadence | Sources (as-of 06/30/2026) |
|---|---|---|---|
| **Monthly** (lagging, needs a month of closings to stabilize) | median sold price, DOM, sale-to-list, months of supply, price/sqft, hotness | monthly | realtor.com ZIP Core Metrics updated 06/03/2026 (May data); Market Hotness 06/11/2026; Zillow ZHVI/ZORI published the 16th; Redfin price-drops monthly. **realtor.com's ZIP-grain data is monthly-only — its weekly product is national/metro, never ZIP.** |
| **Weekly** (leading, list-side flow) | new listings, active inventory, **price-cut share**, median asking | weekly | Altos Research ("weekly, by ZIP + quartile; Market Action Index"); Redfin weekly tracker; Zillow weekly cuts (still refreshed monthly) |
| **Daily** | mortgage rate; a *modeled* price index | daily | Freddie Mac PMMS 6.49% as of 06/25/2026 (weekly Thu); Parcl Labs daily modeled index across 70,000+ markets |

Key trap: **SteadyAPI `/housing-market-details` IS realtor.com data**, refreshed monthly at ZIP grain —
polling it weekly re-fetches identical numbers 3-4×. The "new AI" frontier (Parcl) is *modeling* (a nowcast
index) + a conversational MCP surface (which we already run), **not** faster polling.

## Decision — Option 1 (cadence-honest, minimal change). Operator go 06/30/2026.

We are already ~80% correctly built: monthly sold/DOM/hotness (market-heat + housing), monthly value/rent
(ZHVI/ZORI), daily mortgage (freshness-pulse), seller motivation (seller-stress) — **all unchanged.**
Three additions fill the real gaps, cheapest-first:

### Piece 1 — `listing-momentum-swfl` (weekly, $0 extra API)
The leading list-side layer, from our **own** listing sweep. New view `data_lake.listing_momentum_stats`
over `listing_state` (source_name='api_feed', state='active'): per region/county/ZIP —
`active_listing_count`, `price_reduced_share` = `flag_price_reduced`/total, `new_listing_share` =
`flag_new_listing`/total. **Point-in-time shares** off the flag columns (not a transitions replay) → works
on week one, no seed-spike risk. Empty-tolerant until the sweep runs live. No metered calls.

### Piece 2 — `price-distribution-swfl` (weekly, ~2 calls/wk)
`/price-histogram?location=<county>` → listing count per $50k band (affordability shape). Genuinely new —
no existing brain holds a price-band distribution. Table `data_lake.listing_price_histogram_swfl`.

### Piece 3 — `market-temperature-swfl` (monthly, ~60 calls/mo)
`/housing-market-details?zipcode=` per SWFL ZIP, **monthly** (matches the source's real cadence).
Net-new headline = **sold-to-rent gross yield** (sold × rent; unpublished free). `list_to_sold` +
`market_strength` are secondary (realtor's own, cross-source corroboration) but **do not re-vote in master**
(housing-swfl + market-heat already vote those). median sold/list/rent/DOM/ppsqft/hotness ride in a cited
context detail_table — the "full snapshot", but not the vote. Table `data_lake.market_details_swfl`.

## Cross-cutting

- **Writes:** append-with-`captured_at` (time series), merge on a composite key — dodges the Gate-4
  destructive-replace guard. Never `write_disposition="replace"`.
- **Provenance:** `source_tag` / citation = `realtor.com` (the data origin). SteadyAPI (access layer) is
  NEVER surfaced in any citation, prose, or source_tag.
- **Brain-first gate:** each new `data_lake.*` table lands with its consuming `PackDefinition` in the same
  PR. Momentum's "table" is a view over existing tables → gate trivially satisfied.
- **Vocab gate:** every emitted slug (incl. conditionals) registered in `brain-vocabulary.json` same commit.
- **Completion bar:** offline green — `pytest` (market_aggregates), `bunx next build`, each pack's
  `bun:test`, `catalog.test.mts`, `check-vocab-coverage --all`. Live-verify (real SteadyAPI calls) is
  operator-gated; cron parked until the runner-IP WAF + budget are proven.

## Out of scope (parked)

- Daily modeled price-index nowcast (Parcl-style) — a bigger AI build; revisit after the monthly layer runs.
- Mortgage-rate context — already surfaced daily via freshness-pulse; no new brain.
</content>
</invoke>
