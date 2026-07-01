# Phase 2 — Sold lake + on-demand comps

**Builders:** split —
- `ingest-engineer` for the organic sold capture into `listing_transitions`.
- `answer-engine-guardian` for the on-demand comp helper wired into `lib/assistant`.

**Why two parts:** there is **no bulk sold-search** (the API's `/search` is for-sale only;
`/price-histogram?status=sold` → 422). Sold is reachable only per-property / per-radius. So we deliver it
two ways, both grounded in the live API.

## Part A — Organic sold capture (ingest-engineer)

When a tracked for-sale listing **leaves the sweep** (it was in the prior snapshot, not the current one),
fire one `/property-tax-history?propertyId=` for it:
- If the history shows a recent **Sold** event → record sold price + sold date into `listing_transitions`
  ("another land"), status `sold`.
- If no sold event → it was delisted; record status `withdrawn`/`expired`.

Bounded by turnover (~240/day). **Sample to fit budget** (~500/mo): prioritize higher-value ZIPs or
listings that were active longest. Over months this becomes a genuine SWFL sold-price dataset for the
inventory we already track — sourced legitimately, never invented.

Files: `ingest/pipelines/listing_lifecycle/pipeline.py` (off-market hook), `extract_api.py` (a
`fetch_sold_event(property_id)` helper), `transitions.py`.

> **IMPLEMENTED 07/01/2026** — spec `docs/superpowers/specs/2026-07-01-steadyapi-sold-capture-design.md`,
> check `steadyapi_sold_capture_live_verify`. Two corrections to the sketch above (advisor review):
> 1. **"no sold event → withdrawn" was a fabrication.** A for-sale listing most often leaves the feed by
>    going *pending* (closes weeks later); at departure there is no sale yet. So `meta.current_status` is
>    the authority — pending/ambiguous/API-gap stays `holding` (claims nothing); only a positively
>    off-market status with no recent sale is `withdrawn`. "No sold event" ≠ withdrawn.
> 2. **Holding re-check added** (operator-approved) — the single departure probe misses pending-then-
>    closed sales, so aged `holding` listings are re-probed (rotated via `listing_state.sold_check_at`).

## Part B — On-demand comp helper (answer-engine-guardian)

When the AI values/comps a property, it calls (live, cited, never stale):
1. `/nearby-home-values?lat=&lon=&radius=` → the 25 nearest properties (sold + off-market + for-sale) with
   beds/baths/sqft + realtor.com AVM estimate + last list price + status — **1 call**.
2. For the exact sold price + sold date on a chosen comp, `/property-tax-history?propertyId=` — +1 call.

~1–3 calls per comp request (usage-driven). Wire into `lib/assistant` comp path; reads `lib/assistant/CLAUDE.md`.
Citations (LOCKED 06/30/2026): **never surface "SteadyAPI" anywhere.** In prose, state comps + the as-of date
(MM/DD/YYYY) only — no source named in prose. Sources ride only in the collapsed accordion, limited to
**SWFL Data Gulf** + the **realtor.com homepage** (`https://www.realtor.com`, never the deep permalink).
**Never surface an MLS number.** See `docs/superpowers/specs/2026-06-30-steadyapi-comp-helper-design.md`.

## Parallelism

Part B (`lib/assistant`) shares **nothing** with the ingest phases → fully parallel with Phase 1/3/4.
Part A touches `pipeline.py`/`extract_api.py` → serial with Phase 1 (same files, same builder).

## Note — distinct from the Email Lab/Social rewire

The Email Lab + Social RentCast→SteadyAPI rewire is a **separate** follow-up (check
`email_social_steadyapi_rewire`), not part of this build. The on-demand comp helper here is the answer
engine's comp path, not the labs' listing-context path.

## Verification

- Part A: `pytest` on the off-market hook; assert a known sold listing produces a `sold` transition with
  price+date; assert sampling cap holds the call count.
- Part B: live-verify one comp request returns cited nearby solds with no MLS# leak; assert ≤3 calls.
