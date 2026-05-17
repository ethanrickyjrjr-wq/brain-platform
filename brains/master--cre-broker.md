# CRE Broker Briefing: master

_Market-direction read framed for commercial real estate decisions, with flood-veto and rate signals foregrounded._

## TL;DR

**BEARISH** (magnitude 0.85) — overrides fired: `flood-veto`

## ⚠️ Caveats (read first)

- Override "flood-veto" forced bearish (priority 90)

## Conclusion

Read is bearish (high magnitude). Driven by: franchise-outcomes, cre-swfl, macro-us, macro-florida, macro-swfl, sector-credit-swfl, tourism-tdt, env-swfl, logistics-swfl. Overrides: flood-veto. Note conflicts: cre-swfl (bullish) vs sector-credit-swfl (bearish). Combined confidence 0.98, trust tier T4, based on 9 upstream brains.

## Key Findings

### Most relevant to your role

- **Florida unemployment rate** — 3.4 → _(source: [FRED Florida Unemployment Rate (series_id FLUR) — latest observation 3.4 percent for period 2026-04, stable vs prior 6…](https://api.stlouisfed.org/fred/series/observations?series_id=FLUR&units=lin&file_type=json&sort_order=desc&limit=24), T1, fetched 2026-05-17T16:28:13Z)_
- **SOFR (Secured Overnight Financing Rate)** — 4.31 ↓ _(source: [FRED Secured Overnight Financing Rate (series_id SOFR) — latest observation 4.31 percent_annualized for period 2026-05-…](https://api.stlouisfed.org/fred/series/observations?series_id=SOFR&units=lin&file_type=json&sort_order=desc&limit=24), T1, fetched 2026-05-17T16:28:07Z)_
- **SWFL area-weighted Special Flood Hazard Area coverage** — 0.4324 (43.24%) → _(source: [FEMA NFHL Flood Hazard Zones (Layer 28 / S_FLD_HAZ_AR), area-weighted aggregate across 6 SWFL counties: Charlotte (1201…](https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28), T1, fetched 2026-05-17T05:56:47Z)_
- **Median SWFL CRE cap rate (21 of 25 corridors)** — 6.25 ↓ _(source: [Brains Supabase corridor_profiles (verified, non-deleted) — median across 21 corridors reporting cap_rate_pct: Immokale…](https://jtkdowmrjaxfvwmemxso.supabase.co/rest/v1/corridor_profiles?select=*&verification_status=eq.verified&deleted_at=is.null&cap_rate_pct=not.is.null), T2, fetched 2026-05-17T05:53:13Z)_

### Additional context

- **Total inbound domestic freight to SWFL, year 2024 (thousand tons)** — 12853.1 → _(source: [FAF5 inbound domestic freight flows (data_lake.faf_flows, dlt-ingested from ORNL FAF5.7.1) — dms_dest=129 (Remainder of…](fixture://refinery/__fixtures__/logistics-swfl.sample.json), T1, fetched 2026-05-17T16:39:09Z)_
- **Professional, Scientific & Technical Services (NAICS 54) — best SWFL SBA survival rate** — 100 → _(source: [SBA 7(a)/504 loan outcomes via Brains Supabase sba_loans_by_naics_county MV (Lee + Collier counties, FY 2024+); federal…](fixture://refinery/__fixtures__/sector-credit-swfl.sample.json#naics_2digit=54), T1, fetched 2026-05-17T16:28:25Z)_
- **Latest monthly TDT collections (Lee County, 2026-04, shoulder season)** — 9028029.34 ↑ _(source: [Florida DOR Tourist Development Tax collections via Brains Supabase fl_dor_tdt_collections (Lee County, 103 monthly row…](https://jtkdowmrjaxfvwmemxso.supabase.co/rest/v1/fl_dor_tdt_collections?select=id,county,period,collections_usd), T1, fetched 2026-05-17T05:56:47Z)_
- **SBA franchise overall survival rate (173 resolved loans, 137 brands)** — 91.9 → _(source: [SBA 7(a)/504 franchise loan outcomes via Brains Supabase RPC get_franchise_outcomes_aggregated (Lee + Collier counties,…](https://jtkdowmrjaxfvwmemxso.supabase.co/rest/v1/rpc/get_franchise_outcomes_aggregated), T1, fetched 2026-05-17T05:49:55Z)_

## Drivers

- `franchise-outcomes` — input
- `cre-swfl` — input
- `macro-us` — input
- `macro-florida` — input
- `macro-swfl` — input
- `sector-credit-swfl` — input
- `tourism-tdt` — input
- `env-swfl` — **veto**
- `logistics-swfl` — input

## Contradictions surfaced

- cre-swfl (bullish) vs sector-credit-swfl (bearish)
- cre-swfl (bullish) vs env-swfl (bearish)
- macro-us (bullish) vs sector-credit-swfl (bearish)
- macro-us (bullish) vs env-swfl (bearish)
- sector-credit-swfl (bearish) vs tourism-tdt (bullish)
- tourism-tdt (bullish) vs env-swfl (bearish)

## Confidence

- **0.98** (deterministic: trust tier × freshness × upstream propagation)
- Worst trust tier in chain: T4
- Upstream brains that passed the relevance floor: 9

---

_Brain: `master` v33 · refined 2026-05-17T16:39:16Z · relevance half-life 720h · decay `weeks`_
