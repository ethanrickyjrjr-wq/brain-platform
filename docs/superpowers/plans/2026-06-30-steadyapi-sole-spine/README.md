# SteadyAPI Sole Spine — build folder

**Date:** 2026-06-30 · **Slug:** `steadyapi-sole-spine` · **Language:** Python (extends the existing ingest island)

RentCast is dead. SteadyAPI (a realtor.com proxy) is the **sole** property/listing data spine. This folder
is the executable build, split by phase + an orchestration map (who builds what, what runs together).

## What we're doing

Keep the existing **10,459** seed rows (`data_lake.listing_state`, `source_name='lifecycle_seed'`), use
SteadyAPI to fetch the rest and fill the gaps (photo, baths, list-date, status, property_id), catch up once,
then on a cadence move only the **changes** into history (`listing_transitions`). One sweep already carries
price + status + flags, so a single diff catches the only three things that change day to day: **new
listings, price changes, status moves (pending/sold/gone).**

## Hard constraints

- **Budget:** $14.95/mo Starter = **10,000 requests/month** (+ a 7-day trial). Stay well under.
- **Never post an MLS number anywhere on the site** — it's an internal join key only.
- **Never invent a number** — every figure cites a real source (our lake / upload / named web / user figure).
- **Brain-first ingest gate:** no new `data_lake.*` table without its consuming `PackDefinition` in the same PR.

## Locked decisions (Ricky, 06/30/2026)

1. **Two-layer split** — the aggregate market layer is separate from the per-listing inventory machine.
2. **Brains IN:** market-temperature, price-distribution, rentals, mortgage-rate context, + sold-comp capability.
3. **Sold:** there is **no bulk sold-search** (the API's `/search` is for-sale only). Deliver BOTH —
   always-on on-demand comps AND a built sold lake via sampled organic capture on off-market events.
4. **Rentals:** weekly sweep.
5. **Overlap (AVM / tax / permits / environment-risk): SKIP** — we already hold all of it (county
   appraisers, Zillow ZHVI, Accela, our flood-risk brain).
6. **Legacy list_date:** lazy backfill via property_id; new listings get true list_date going forward.
7. **Land + manufactured:** parked for spare-call backfill (ODD scaffold).

## Budget — the version that makes sense

> ✅ **Budget-bomb fixed in code + unit-tested (06/30)** — batched `/nearby-home-values` enrichment +
> `known_ids` threading + a real network-free `--dry-run` replace the old 2-calls/listing,
> always-re-enriches-everything design. **NOT yet proven live** — no real call has been made against
> SteadyAPI this session (operator authorization pending). The figures below are the code's target;
> they become a verified fact only after a live `--dry-run` reads the real number. See `phase-1`.

**One-time catch-up ≈ 1,200 calls** (~12% of one month):
- Full for-sale sweep, both counties (~21k residential @ 200/page): ~106
- Baths on the ~10,500 current listings missing them, batched `/nearby-home-values` (~17 useful/call): ~600
- Rentals first full pull (~9k @ 20/page): ~450
- Market/price brains first pull (~60 ZIPs + 2 counties + ~10 cities + mortgage): ~75

**Steady-state ≈ 3,000–4,700/month** (30–47% of cap), sweep every 2–3 days (NOT daily — median DOM is 87,
listings move slowly):
- For-sale sweep, every 2–3 days: ~1,060
- Baths on new listings only (~240 new/day ÷ ~17): ~420
- Rentals weekly (~450 × 4.3): ~1,935 (biweekly ≈970)
- Market/price brains weekly: ~320 · mortgage-rate weekly: ~5
- Sold capture on off-market events, sampled: ~500
- On-demand sold comps: usage-driven, ~500

**Measured inputs (live 06/30/2026):** for-sale ~21k residential (Lee 14,161 / Collier 6,960); rentals ~9k
(Collier county 4,178; Naples 3,778; Fort Myers 1,716; Cape Coral 1,262 — Lee county-form 500s, sweep Lee
by city); `/search` pages at 200, `/rentals-search` at 20; DOM 87 (ZIP 33901 and Lee county).

## Files in this folder

- `00-foundation-endpoint-catalog.md` — every verified SteadyAPI endpoint + the match/efficiency analysis
- `phase-1-inventory-cutover.md` — the critical path: scrape → SteadyAPI for-sale, keep the 10,459
- `phase-2-sold-lake-and-comps.md` — organic sold capture + on-demand comp helper
- `phase-3-market-brains.md` — market-temperature + price-distribution aggregate brains
- `phase-4-rentals-brain.md` — rentals asset class
- `phase-5-land-manufactured-parked.md` — parked backfill (ODD scaffold)
- `orchestration.md` — who builds what, what runs together vs separate, the dependency DAG

## Out of scope (tracked separately)

Email Lab + Social still wire dead RentCast — tracked as check `email_social_steadyapi_rewire`. See
`phase-2` notes and the follow-up; that redesign is **not** part of this build.
