# Sold-resolution: lat/long parcel crosswalk (Lee)

**Date:** 2026-07-01
**Status: SPIKE RUN, BUILD BLOCKED — not on code, on data that doesn't exist yet.**

## Problem

Prior session's addendum to `phase-2-sold-resolution-fallback-lane-HANDOFF.md` claimed
"`listing_state` already carries `lat`/`lon` per listing" and proposed building a point-in-polygon
crosswalk (listing lat/lon → LeePA parcel polygon → FOLIOID → `leepa_parcels.last_sale_amount`) to
price departed listings the SteadyAPI path can't reach (no `property_id`).

## Spike result (live-queried this session, before writing any pipeline code)

1. **The `lat`/`lon` columns exist** (`migrations/20260630_listing_state_api_columns.sql`) and the
   extractor does read them off the SteadyAPI response (`extract_api.py` `loc.get("lat"/"lon")`,
   `distill.py` `_STATE_COLS`). The prior session's claim was schema-correct.
2. **But they are 100% NULL right now.** Live count against `data_lake.listing_state`:
   `source_name='api_feed'`, Lee 7,412 rows + Collier 2,749 rows, **`has_lat = 0` for both counties**
   (same 10,161 rows that all have `property_id = NULL`, per the HANDOFF doc's "Verified current
   state"). Reason: lat/lon populates from a live SteadyAPI sweep response, and — same as
   `property_id` — **no live sweep has ever run** (`listing-lifecycle-daily.yml` schedule is commented
   out; the one historical dispatch predates the SteadyAPI cutover and failed). This is the identical
   blocker gating everything else in the HANDOFF doc, not a new one.
3. **Zero departures exist to test against either way.** `data_lake.listing_transitions` has no
   `api_feed` rows at all — only the `lifecycle_seed` baseline stamp (10,459 rows, all `to_state='active'`).
   Nothing has ever departed through this pipeline. There is no real "10 recently-departed listings"
   sample to spike a crosswalk against today, populated lat/lon or not.
4. **What IS newly confirmed, and is a real advance over the prior session:** the point-in-polygon
   direction (given a lat/lon, find the containing parcel) was never actually tested before — only the
   reverse (given a known FOLIOID, fetch its geometry). Tested live this session:
   - LeePA MapServer layer 0 metadata confirms `"geometryType":"esriGeometryPolygon"` (it IS a real
     parcel-boundary layer despite the misleading `"Tangible Business Names"` display name).
   - A zero-buffer `esriSpatialRelIntersects` point query against an imprecise test coordinate
     correctly returned zero features (not a bug — the point wasn't actually inside any polygon).
   - The same query with a 200m buffer (`distance=200&units=esriSRUnit_Meter`) returned real FOLIOIDs
     from the surrounding parcels — confirming the endpoint's spatial query mechanics work end-to-end
     for point→FOLIOID, not just FOLIOID→geometry.
   - So: once real listing lat/lon exists, the crosswalk mechanism itself is de-risked. That part is
     no longer a research question.
5. **`leepa_parcels` sale-data freshness (separate question, also checked live):** 528,130 / 548,798
   parcels have `last_sale_amount` populated (NULL scare from `leepa-no-sale-price` memory does NOT
   reproduce at this count — consistent with the 2026-06-04 "populated" finding, not the disputed
   "100% NULL" report), newest `last_sale_date` = 2026-05-01, 315 parcels sold in the last 90 days.
   Lee's side of the data is fresh enough to be useful, IF the join ever has real coordinates to run on.

## Goal (unchanged, just now correctly sequenced)

Resolve a sold price for a departed listing without a `property_id`, using our own already-held
parcel geometry as the join key instead of an address string match.

## What we're building — HELD, not now

Not writing the join/pipeline code today: there is nothing live to validate it against (0 lat/lon
rows, 0 departures). Building it now would be writing code against a fixture, not real data, and per
[[feedback_pre-build-state-check]] that's exactly the trap this spike was meant to catch.

**Real next unblock is the same one every other lane in this HANDOFF doc is waiting on: an
operator-authorized live (`dry_run=false`) dispatch of `listing-lifecycle-daily.yml`.** That single
action simultaneously: stamps `property_id` on survivors, populates `lat`/`lon` going forward, and
starts producing real departures to build/test this crosswalk against. Nothing else unblocks it
faster. Until that dispatch happens (operator's call — paid SteadyAPI calls, not fired this session),
this crosswalk stays a verified-mechanism-in-waiting, not a shippable pipeline.

**When it does unblock**, the build is small: extend the existing point-in-polygon query
(`geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects`, zero buffer, real
listing coordinate) → FOLIOID → `leepa_parcels` lookup → take `last_sale_amount`/`last_sale_date` if
`last_sale_date` postdates the listing's departure; otherwise fall through to Lane 3 (crawl4ai named
source) per the existing cascade.
