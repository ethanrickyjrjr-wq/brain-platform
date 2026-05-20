# CRE Broker Briefing: master

_Market-direction read framed for commercial real estate decisions, with flood-barrier-mode-1 and rate signals foregrounded._

## TL;DR

**MIXED** (magnitude 0.46) — overrides fired: `flood-barrier-mode-1`

## ⚠️ Caveats (read first)

- Override "flood-barrier-mode-1" fired (priority 90)
- 1 of 8 corridors have no cap_rate / vacancy_rate metrics — direction is read from the 7 corridors with data.
- Macro indicators in this build are synthetic fixture data (FRED-shaped) — unset REFINERY_SOURCE or set it to `live` for the live FRED API.
- Florida macro indicators in this build are synthetic fixture data (FRED-shaped) — unset REFINERY_SOURCE or set it to `live` for the live FRED API.
- macro-swfl emits no SWFL-specific metrics today — the brain is a chain-position placeholder until county-level BLS LAUS for Lee + Collier is ingested. Downstream brains should declare macro-florida or macro-us as direct upstreams for macro context in the interim.
- Charge-off rates use the resolved-loan denominator (n_chargeoffs / (n_chargeoffs + n_paid_in_full)); the materialized view's `chargeoff_pct` is intentionally ignored because it understates risk on still-active loans.
- Sectors with fewer than 5 resolved loans are not ranked — small-sample charge-off rates are directional, not actionable.
- Worst-sector charge-off 33.3% (Arts, Entertainment & Recreation, NAICS 71) above 30% bearish threshold — sector-level credit risk is elevated.
- TDT collections in this build are SYNTHETIC fixture data — unset REFINERY_SOURCE or set it to `live` to read the real fl_dor_tdt_collections table.
- Latest month is a trough-season reading (trough). Operators should not extrapolate the single-month figure to an annual run rate — weight against trailing_12mo_collections_usd instead.
- Area aggregates are in square decimal degrees (WGS84 / EPSG:4326), not projected meters. Ratios across zones within the same county are accurate; absolute areas are NOT physical units and are never propagated.
- Bbox-intersect queries include polygons that touch the county envelope, so edge polygons may belong to neighboring counties. The DFIRM_ID on each polygon is the authoritative county affiliation; v1 surfaces the bbox-aggregate without re-attributing edge polygons.
- Fixture mode: only Lee County is populated. SWFL-wide metrics reflect Lee alone — switch to REFINERY_SOURCE=live for the full 6-county footprint.
- FEMA NFHL is queried live on every refinery run (v1). LOMR-based cache invalidation (Layer 1, EFF_DATE) is documented in docs/env-swfl-spike-findings.md and reserved for v2 once a hot-path issue is observed.
- NFIP claims are policyholder-only. Uninsured properties and parcels outside NFIP participation are NOT in the archive — true SWFL flood loss is materially larger than what these numbers show.
- Storm-year list (Charley 2004, Wilma 2005, Irma 2017, Ian 2022, Helene 2024, Milton 2024) was last reviewed 2026-05-17. Requires update in refinery/sources/fema-nfip-source.mts when a new named storm hits SWFL.
- Per-ZIP AAL denominator uses 2020 ACS population × 0.3 NSI-coverage proxy for insured-property count (v1). Replace with the live OpenFEMA NFIP Policies insured count in v2 before treating per-ZIP magnitudes as policy-grade — current numbers compress toward each other when actual NFIP penetration in a ZIP diverges from the 30% proxy.
- USGS surface stage metric includes both Approved (A) and Provisional (P) qualifiers — magnitudes may revise as USGS approves provisional readings over the 6-12 month review window. For approval-only reads, brain-level consumers should filter on the qualifiers column directly.
- Three additional hydrology metrics (Lee groundwater median, SWFL annual rainfall, Lee groundwater high-water-day count) were stripped from this brain on 2026-05-19 after their backing Postgres table (data_lake.usgs_daily) was lost in the Cold Lane migration. Re-source via SFWMD DBHYDRO before depending on those signals.
- FAF5 flows in this build are synthetic fixture data — unset REFINERY_SOURCE or set it to `live` to query data_lake.faf_flows.
- Scope is inbound domestic only (dms_dest=129 AND trade_type=1). Imports (trade_type=2), exports (trade_type=3), and outbound flows (dms_orig=129) are intentionally excluded — separate brains would own those scopes if built.
- Year scope is 2024 (latest historical FAF5 year). FAF5 forecast years are deliberately not consumed here; bump LATEST_HISTORICAL_FAF_YEAR in refinery/sources/faf5-source.mts when ORNL publishes the next vintage.
- v1 emits no direction/magnitude vote — the brain reports a point-in-time snapshot, not a time series. Direction reads require a multi-year retro (planned for v2 once a second FAF5 vintage is ingested).
- FDOT freight segments and shock-log entries in this build are synthetic fixture data — unset REFINERY_SOURCE or set it to `live` to query data_lake.fdot_aadt_fl + data_lake.fdot_freight_nowcast_shock_log.
- Path B (post-commit 297ad23): deviation math compares CURRENT FDOT segment-count activity (Σ AADT × tfctr × payload × 365) against the rolling mean/stddev of the same quantity in the last 90 days of shock-log history. The FAF5 number above is preserved as audited CONTEXT but is no longer the math anchor — the prior v1 design comparing FDOT activity to FAF5 flow had dimensional + population mismatches.
- Daily-cadence shock detection uses a synthetic per-day denominator (annual tons_per_year ÷ 365) because Tier 2 carries only annual FDOT AADT. 30d / 90d escalation thresholds will rarely fire from current Tier 2 data alone — true daily AADT-equivalent (FDOT continuous-count stations) is reserved for v2 ingest.
- Conversion math: activity_tons_per_year_per_segment = AADT × tfctr × 16 × 365. The 16.0 tons/truck payload is FHWA HS 2023 Table VM-1 (combination trucks); commodity-mix shifts (heavy gravel vs light electronics) are not modeled in v1.
- Path B over-counts pass-through traffic (one truck traversing five segments contributes to five segment counts) — the over-count is constant across days and cancels in the z-score, but the headline tons/year number should NOT be compared directly to FAF5 flow.
- Scheduled FDOT construction closures look mathematically identical to genuine slowdowns; v1 has no calendar-aware filter to separate the two.
- FDOT AADT segments in this build are synthetic fixture data — unset REFINERY_SOURCE or set it to `live` to query data_lake.fdot_aadt_fl.
- Length-weighting uses shape_length (auto-generated geometry length in the layer projection). The shape_leng attribute is not consulted — it may be stale after route realignments.
- Cohort-matched YoY identifies segments by (roadway, desc_frm, desc_to). If FDOT changes any of those three fields between years for the same physical segment, that segment drops from the cohort silently — small cohort sizes (< 100) should be read with skepticism.
- Truck factor metric reports a length-weighted MEAN of per-county MEDIANS rather than a true cross-county median (true median would require raw segment access, defeating the source aggregation). Treat the value as a county-mix-aware estimate, not an exact statistic.
- Year scope is 2021-2025. Bump LATEST_FDOT_YEAR in refinery/sources/fdot-source.mts when FDOT publishes the next vintage.
- Post-Ian recovery index DELIBERATELY uses a wider 3-county set (Lee + Collier + Charlotte) than the brain's standard 2-county scope — Charlotte sat in Ian's eye-wall path and must be included for the storm signal to be honest. The other 4 metrics stay 2-county.
- Direction thresholds: bullish ≥ +3% YoY; bearish ≤ -3% YoY; neutral otherwise.
- Sales-velocity baseline is derived from each parcel's LATEST qualified sale, so re-sales attributed to recent years are subtracted from earlier-year buckets. Current-year z-score is therefore biased UPWARD; treat marginal bullish reads as suggestive rather than confirmatory.
- Qualified-sale-only sample: inheritance, divorce, and non-arms-length transfers do not appear in the velocity counts. The signal measures market-mediated parcel turnover, not total ownership change.
- Lee County only — Collier and Charlotte are NOT included. SWFL-wide reads must be assembled from sibling brains (not yet built).
- FHFA HPI metrics (Cape Coral MSA + FL state) use a repeat-sale methodology and are published quarterly with a ~2-month lag. They measure price-level change, not transaction volume — the LeePA z-score and the FHFA YoY are complementary, not interchangeable.
- Save-Our-Homes gap median is restricted to parcels with cap_difference > 0 (actively benefiting from the SOH cap). Non-homestead and newly-homesteaded parcels are excluded from the median; total_parcels is the full snapshot row count for context.
- Direction thresholds: bullish if z ≥ +1.0σ; bearish if z ≤ -1.0σ; neutral otherwise. Standard deviation is population std over 3 baseline years; if variance is zero (all baseline years identical) z is undefined and direction is neutral.

## Conclusion

Read is mixed (moderate magnitude). Driven by: franchise-outcomes, cre-swfl, macro-us, macro-florida, macro-swfl, sector-credit-swfl, tourism-tdt, env-swfl, logistics-swfl, logistics-swfl-nowcast, traffic-swfl, properties-lee-value. Overrides: flood-barrier-mode-1. Note conflicts: cre-swfl (bullish) vs sector-credit-swfl (bearish). Combined confidence 0.95, trust tier T4, based on 12 upstream brains.

## Key Findings

### Most relevant to your role

- **Florida unemployment rate** — 3.4 → _(source: [FRED Florida Unemployment Rate (series_id FLUR) — latest observation 3.4 percent for period 2026-04, stable vs prior 6…](https://api.stlouisfed.org/fred/series/observations?series_id=FLUR&units=lin&file_type=json&sort_order=desc&limit=24), T1, fetched 2026-05-20T07:33:19Z)_
- **SOFR (Secured Overnight Financing Rate)** — 4.31 ↓ _(source: [FRED Secured Overnight Financing Rate (series_id SOFR) — latest observation 4.31 percent_annualized for period 2026-05-…](https://api.stlouisfed.org/fred/series/observations?series_id=SOFR&units=lin&file_type=json&sort_order=desc&limit=24), T1, fetched 2026-05-20T07:33:17Z)_
- **SWFL area-weighted Special Flood Hazard Area coverage** — 0.3795 (37.95%) → _(source: [FEMA NFHL Flood Hazard Zones (Layer 28 / S_FLD_HAZ_AR), area-weighted aggregate across 1 SWFL counties: Lee (12071).](https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28), T1, fetched 2026-05-16T23:00:00Z)_
- **Lee sales velocity, year 2025 (qualified sales per 1,000 parcels)** — 15.1 → _(source: [LeePA parcel snapshot via data_lake.leepa_parcels (dlt-ingested from gissvr.leepa.org ParcelInfo/MapServer layers 9+10+…](https://jtkdowmrjaxfvwmemxso.supabase.co/rest/v1/leepa_parcels?select=folioid,just_value,taxable_value,cap_difference,last_sale_date,use_code), T2, fetched 2026-05-20T18:58:54Z)_

### Additional context

- **Total inbound domestic freight to SWFL, year 2024 (thousand tons)** — 12853.1 → _(source: [FAF5.7.1 inbound domestic freight flows (ORNL/FHWA Cold Lane Parquet; dms_dest=129 trade_type=1, year 2024). Aggregate:…](fixture://refinery/__fixtures__/logistics-swfl.sample.json), T1, fetched 2026-05-20T07:42:54Z)_
- **Professional, Scientific & Technical Services (NAICS 54) — best SWFL SBA survival rate** — 100 → _(source: [SBA 7(a)/504 loan outcomes via Brains Supabase sba_loans_by_naics_county MV (Lee + Collier counties, FY 2024+); federal…](fixture://refinery/__fixtures__/sector-credit-swfl.sample.json#naics_2digit=54), T1, fetched 2026-05-18T20:50:57Z)_
- **Latest monthly TDT collections (Lee County, 2025-09, trough season)** — 1800000 ↑ _(source: [Florida DOR Tourist Development Tax collections via Brains Supabase fl_dor_tdt_collections (Lee County, 48 monthly rows…](fixture://refinery/__fixtures__/tourism-tdt.sample.json), T1, fetched 2026-05-18T20:50:57Z)_
- **SBA franchise overall survival rate (169 resolved loans, 14 brands)** — 78.1 → _(source: [SBA 7(a)/504 franchise loan outcomes via Brains Supabase RPC get_franchise_outcomes_aggregated (Lee + Collier counties,…](fixture://refinery/__fixtures__/franchise-outcomes.sample.json), T1, fetched 2026-05-18T20:48:54Z)_

## Drivers

- `franchise-outcomes` — input
- `cre-swfl` — input
- `macro-us` — input
- `macro-florida` — input
- `macro-swfl` — input
- `sector-credit-swfl` — input
- `tourism-tdt` — input
- `env-swfl` — modifier
- `logistics-swfl` — input
- `logistics-swfl-nowcast` — input
- `traffic-swfl` — input
- `properties-lee-value` — input

## Contradictions surfaced

- cre-swfl (bullish) vs sector-credit-swfl (bearish)
- cre-swfl (bullish) vs env-swfl (bearish)
- macro-us (bullish) vs sector-credit-swfl (bearish)
- macro-us (bullish) vs env-swfl (bearish)
- sector-credit-swfl (bearish) vs tourism-tdt (bullish)
- sector-credit-swfl (bearish) vs traffic-swfl (bullish)
- sector-credit-swfl (bearish) vs properties-lee-value (bullish)
- tourism-tdt (bullish) vs env-swfl (bearish)
- env-swfl (bearish) vs traffic-swfl (bullish)
- env-swfl (bearish) vs properties-lee-value (bullish)

## Confidence

- **0.96** (deterministic: trust tier × freshness × upstream propagation)
- Worst trust tier in chain: T4
- Upstream brains that passed the relevance floor: 12

---

_Brain: `master` v51 · refined 2026-05-20T18:59:11Z · relevance half-life 719.9999999999999h · decay `weeks`_
