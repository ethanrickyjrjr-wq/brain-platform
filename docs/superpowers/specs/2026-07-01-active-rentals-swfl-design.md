# Active rental listing inventory (Phase 4)

**Date:** 2026-07-01

Executes `docs/superpowers/plans/2026-06-30-steadyapi-sole-spine/phase-4-rentals-brain.md`.

## Problem

We have no active RENTAL listing inventory signal. `rentals-swfl` exists but is the Zillow ZORI rent
INDEX (monthly trend/direction) — not a count of what's actually for rent right now. SteadyAPI's
`/rentals-search` covers this (~9,000 SWFL rentals) but was unused.

## Naming collision (resolved)

The plan's proposed id `rentals-swfl` collides with the live ZORI brain. Operator picked
`active-rentals-swfl`, mirroring the existing `active-listings-swfl` (inventory machine, SteadyAPI) vs
`housing-swfl` (Redfin sold-trend index) split already in production — same shape, sale side vs rent side.

## Vendor verification (live, 07/01/2026)

- Real `/rentals-search` shape captured (Naples, FL probe): `meta.{total,returned,limit,offset}`;
  `body[].{property_id, price:{min,max,display}, permalink, photo_url, description:{type,beds,baths,
  sqft}, address:{line,city,zip}}`. No lat/lon on rental rows — `address.zip` is the grain key.
- The plan's "Lee county-form 500s" did not reproduce: 4 retries + a full pagination probe (offset
  0→5210) both returned clean 200s. Lee county-form total (5,211) exceeds the plan's 7-city sum (4,895)
  — the city list would have silently missed smaller Lee towns. **The per-Lee-city sweep was dropped**;
  both counties sweep via county-form only, ~471 calls/weekly sweep.

## What we're building

- `ingest/pipelines/rentals/` — weekly county-form paginated sweep (Lee + Collier), mirrors
  `ingest/pipelines/market_aggregates/` structurally (throttled client, pure parser, network-free
  `--dry-run`).
- `data_lake.rental_listings_swfl` (append-with-captured_date) + `_latest` view + `rental_listing_stats`
  aggregate view (GROUPING SETS region/county/zip — count + price MIN/MAX only).
- `active-rentals-swfl` pack: headline = listing COUNT only. Explicitly does NOT compute a median/average
  rent from the vendor's per-listing price.min/price.max ranges (advisor-caught: blending a range into a
  synthetic point value has no source and would violate the locked "derivable ≠ source-faithful" rule).
  The source-faithful median rent per ZIP stays `market-temperature-swfl`'s; this brain cites it rather
  than duplicating it.
- Wired: `index.mts`, `catalog.mts`, BRAIN_GEO (`zip-dossier.ts`), 1 vocab slug
  (`active_rental_listings_count_swfl`), cadence entry (parked), GHA cron wrapper (`ingest-rentals.yml`,
  `dry_run` defaults true). NOT wired into `master` yet (deferred, matches Phase 3's precedent).

## Live-verify (this check)

Apply `docs/sql/20260701_rentals_swfl_table.sql`, dispatch `ingest-rentals.yml` with `dry_run=false`,
confirm the `[budget]` line (~471 calls) and real rows in `rental_listings_swfl`, then rebuild the brain
live and confirm no MLS#/"SteadyAPI" leak in the cited output.
