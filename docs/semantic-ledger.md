# Semantic Ledger

_The data on the data — auto-generated read-only view of the SKOS vocabulary, DAG, and constitution overrides that drive the SWFL Intelligence Lake._

**Generated:** 2026-05-20T23:09:39.971Z (commit `4f4dde4`)
**Vocab schema:** 1.0.0 · created 2026-05-16 · next review 2026-08-15
**Audit doc:** `docs/vocab-audit.md`

## TL;DR

- **102** SKOS concepts across **7** categories (100 active, 2 stub).
- **111** raw slugs registered in `slug_index`.
- **15** distinct source brains referenced (live + planned).
- **15** packs in the runtime registry.

## Regenerate

```
bun refinery/tools/semantic-ledger.mts
```

## Categories

| Category | Concepts | Active | Stub |
| --- | ---: | ---: | ---: |
| `credit-risk` | 17 | 16 | 1 |
| `environmental` | 35 | 34 | 1 |
| `hospitality` | 5 | 5 | 0 |
| `logistics` | 19 | 19 | 0 |
| `macro` | 9 | 9 | 0 |
| `qualitative` | 5 | 5 | 0 |
| `real-estate` | 12 | 12 | 0 |

## Concepts by Category

### `credit-risk` (17)

| Concept ID | prefLabel | Raw slugs | Type | Unit | Range / Allowed | Source brains | Domains | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sba_best_sector_survival` | Best-Sector SBA Survival Rate | `best_naics_survival` | percentage | % | 0 – 100 | `sector-credit-swfl`, `master` | `finance` | ✅ active |
| `sba_chargeoff_rate_sector_23` | Construction (NAICS 23) — SBA Charge-off Rate | `sector_23_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance` | ✅ active |
| `sba_chargeoff_rate_sector_42` | Wholesale Trade (NAICS 42) — SBA Charge-off Rate | `sector_42_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance` | ✅ active |
| `sba_chargeoff_rate_sector_44` | Retail Trade — Motor Vehicle & General Merchandise (NAICS 44) — SBA Charge-off Rate | `sector_44_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance` | ✅ active |
| `sba_chargeoff_rate_sector_45` | Retail Trade — Clothing, Sporting Goods & Non-store (NAICS 45) — SBA Charge-off Rate | `sector_45_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance` | ✅ active |
| `sba_chargeoff_rate_sector_48` | Transportation & Warehousing (NAICS 48) — SBA Charge-off Rate | `sector_48_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance` | ✅ active |
| `sba_chargeoff_rate_sector_52` | Finance & Insurance (NAICS 52) — SBA Charge-off Rate | `sector_52_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance` | ✅ active |
| `sba_chargeoff_rate_sector_53` | Real Estate, Rental & Leasing (NAICS 53) — SBA Charge-off Rate | `sector_53_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance`, `real-estate` | ✅ active |
| `sba_chargeoff_rate_sector_54` | Professional, Scientific & Technical Services (NAICS 54) — SBA Charge-off Rate | `sector_54_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance` | ✅ active |
| `sba_chargeoff_rate_sector_56` | Administrative & Support Services (NAICS 56) — SBA Charge-off Rate | `sector_56_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance` | ✅ active |
| `sba_chargeoff_rate_sector_62` | Health Care & Social Assistance (NAICS 62) — SBA Charge-off Rate | `sector_62_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance` | ✅ active |
| `sba_chargeoff_rate_sector_71` | Arts, Entertainment & Recreation (NAICS 71) — SBA Charge-off Rate | `sector_71_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance`, `hospitality` | ✅ active |
| `sba_chargeoff_rate_sector_72` | Accommodation & Food Services (NAICS 72) — SBA Charge-off Rate | `sector_72_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance`, `hospitality` | ✅ active |
| `sba_chargeoff_rate_sector_81` | Other Services — Personal & Repair (NAICS 81) — SBA Charge-off Rate | `sector_81_chargeoff_rate` | percentage | % | 0 – 100 | `sector-credit-swfl` | `finance` | ✅ active |
| `sba_naics_distress_baseline` | NAICS Sector Distress Baseline | `naics_distress_baseline` | percentage | % | 0 – 100 | _none_ | `finance` | ⚠️ stub |
| `sba_overall_survival_rate` | SBA Franchise Survival Rate (Corpus) | `overall_survival_rate` | percentage | % | 0 – 100 | `franchise-outcomes`, `master` | `finance` | ✅ active |
| `sba_worst_sector_chargeoff` | Worst-Sector SBA Charge-off Rate | `worst_naics_chargeoff` | percentage | % | 0 – 100 | `sector-credit-swfl`, `master` | `finance` | ✅ active |

<details><summary>Scope notes</summary>

- **`sba_best_sector_survival`** — Corpus-level derived aggregate. Identifies the top-ranked 2-digit NAICS sector by survival rate for the reporting period.
- **`sba_chargeoff_rate_sector_44`** — DISTINCT from sba_chargeoff_rate_sector_45. NAICS 44 covers motor vehicle dealers, electronics, building materials, and food/beverage stores. Both 44 and 45 are officially titled 'Retail Trade' by the SBA — use naics_code to disambiguate, never the label alone.
- **`sba_chargeoff_rate_sector_45`** — DISTINCT from sba_chargeoff_rate_sector_44. NAICS 45 covers clothing stores, sporting goods, hobby shops, general merchandise, and non-store retailers. Both 44 and 45 are officially titled 'Retail Trade' by the SBA — use naics_code to disambiguate, never the label alone.
- **`sba_naics_distress_baseline`** — Pre-registered for the naics-distress-veto override rule in refinery/constitution/real-estate.mts. Fires false until sector-credit-swfl exposes a baseline metric. Pair with sba_chargeoff_rate_sector_{naics} for the comparison.
- **`sba_overall_survival_rate`** — Resolved-loan denominator only: n_paid_in_full / (n_paid_in_full + n_chargeoffs). Never computed over total loans.
- **`sba_worst_sector_chargeoff`** — Corpus-level derived aggregate. Above 30% triggers bearish threshold per sector-credit-swfl caveat logic.

</details>

### `environmental` (35)

| Concept ID | prefLabel | Raw slugs | Type | Unit | Range / Allowed | Source brains | Domains | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `env_collier_sfha_coverage_pct` | Collier County Area-Weighted SFHA Coverage | `collier_county_sfha_pct_area_weighted` | ratio | ratio (0–1) | 0 – 1 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_collier_ve_zone_coverage_pct` | Collier County Area-Weighted Coastal V/VE Coverage | `collier_county_ve_zone_pct_area_weighted` | ratio | ratio (0–1) | 0 – 1 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_flood_losses_swfl_baseline_annual_usd` | SWFL Non-Storm-Year Annual NFIP Paid Claims (Median) | `flood_losses_baseline`, `swfl_nonstorm_claims_baseline` | currency | USD | 0 – 100000000 | `env-swfl`, `master` | `environmental`, `real-estate` | ✅ active |
| `env_flood_losses_swfl_post_ian_ratio` | SWFL Post-Ian Flood Recovery Ratio (Latest Year ÷ Baseline) | `swfl_post_ian_claims_ratio`, `post_ian_claims_ratio`, `swfl_flood_recovery_ratio` | ratio | ratio (1.0 = matches non-storm baseline) | 0 – 100 | `env-swfl`, `master` | `environmental`, `real-estate` | ✅ active |
| `env_flood_losses_swfl_storm_year_count_since_2000` | SWFL Named-Storm-Year Count Since 2000 | `storm_year_count_swfl`, `swfl_storm_frequency` | count | count | 0 – 20 | `env-swfl`, `master` | `environmental`, `real-estate` | ✅ active |
| `env_flood_losses_swfl_storm_year_total_usd` | SWFL Storm-Year NFIP Paid Claims (Cumulative) | `flood_losses_storm_total`, `swfl_storm_year_claims_usd` | currency | USD | 0 – 50000000000 | `env-swfl`, `master` | `environmental`, `real-estate` | ✅ active |
| `env_flood_risk_pct` | Flood Risk Percentage | `flood_risk_pct` | percentage | % | 0 – 100 | _none_ | `environmental`, `real-estate` | ⚠️ stub |
| `env_gw_highwater_exceedance_days` | Lee County Groundwater High-Water Exceedance Days (>2 ft NAVD88) | `swfl_gw_highwater_days_lee`, `lee_gw_exceedance_days_above_2ft` | count | days | 0 – 366 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_gw_level_lee_median_ft` | Lee County Groundwater Median Elevation (NAVD88) | `swfl_gw_lee_median_ft`, `lee_gw_median_navd88_ft` | elevation_ft | ft (NAVD88) | -50 – 50 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_hurricane_cat3plus_passes_within_50mi_30yr_swfl` | SWFL Cat-3+ Hurricane Passes Within 50mi (30-Year Window) | `hurricane_cat3plus_passes_within_50mi_30yr` | count | storms | 0 – 100 | `hurricane-tracks-fl` | `environmental`, `real-estate` | ✅ active |
| `env_hurricane_closest_pass_5yr_min_mi_swfl` | SWFL Closest Hurricane Pass (Trailing 5-Year Window, miles) | `hurricane_closest_pass_5yr_min_mi` | distance_mi | statute miles | 0 – 1000 | `hurricane-tracks-fl` | `environmental`, `real-estate` | ✅ active |
| `env_hurricane_landfalls_swfl_30yr` | SWFL Hurricane Landfalls (Trailing 30-Year Window) | `hurricane_landfalls_30yr` | count | storms | 0 – 100 | `hurricane-tracks-fl` | `environmental`, `real-estate` | ✅ active |
| `env_hurricane_most_recent_landfall_swfl` | SWFL Most Recent Hurricane Landfall (Storm + Date) | `hurricane_most_recent_landfall_date` | string | — | _unbounded_ | `hurricane-tracks-fl` | `environmental`, `real-estate` | ✅ active |
| `env_hurricane_nfip_paid_per_landfall_storm_avg_usd_swfl` | SWFL Average NFIP Paid per Landfall Storm (USD) | `hurricane_nfip_paid_per_landfall_storm_avg_usd` | currency_usd | USD | 0 – 10000000000 | `hurricane-tracks-fl` | `environmental`, `real-estate`, `finance` | ✅ active |
| `env_hurricane_worst_storm_county_year_nfip_paid_usd_swfl` | SWFL Worst Storm-County-Year NFIP Paid (USD) | `hurricane_worst_storm_county_year_nfip_paid_usd` | currency_usd | USD | 0 – 100000000000 | `hurricane-tracks-fl` | `environmental`, `real-estate`, `finance` | ✅ active |
| `env_lee_sfha_coverage_pct` | Lee County Area-Weighted SFHA Coverage | `lee_county_sfha_pct_area_weighted` | ratio | ratio (0–1) | 0 – 1 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_lee_ve_zone_coverage_pct` | Lee County Area-Weighted Coastal V/VE Coverage | `lee_county_ve_zone_pct_area_weighted` | ratio | ratio (0–1) | 0 – 1 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_rainfall_swfl_annual_in` | SWFL Annual Rainfall (Latest Complete Year) | `swfl_rainfall_annual_in`, `rainfall_swfl_latest_year_in` | depth_in | in | 0 – 120 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_storm_counties_covered_swfl` | SWFL Counties Present in Storm History Corpus | `storm_counties_covered` | string | — | _unbounded_ | `storm-history-swfl` | `environmental` | ✅ active |
| `env_storm_extreme_wind_events_10yr_swfl` | SWFL Hurricane-Force Wind Events (10-Year Window) | `storm_extreme_wind_events_10yr` | count | events | 0 – 1000 | `storm-history-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_storm_ingest_vintage_swfl` | SWFL Storm-History Ingest Vintage Range | `storm_ingest_vintage` | string | — | _unbounded_ | `storm-history-swfl` | `environmental` | ✅ active |
| `env_storm_last_billion_dollar_event_date_swfl` | Most Recent SWFL Billion-Dollar Storm Event Date | `storm_last_billion_dollar_event_date` | date | ISO 8601 date (YYYY-MM-DD) | _unbounded_ | `storm-history-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_storm_last_billion_dollar_event_type_swfl` | Most Recent SWFL Billion-Dollar Storm Event Type | `storm_last_billion_dollar_event_type` | string | — | `Hurricane` / `Hurricane (Typhoon)` / `Tornado` / `Flash Flood` / `Storm Surge/Tide` / `Tropical Storm` / `Thunderstorm Wind` | `storm-history-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_storm_major_storm_count_30yr_swfl` | SWFL Major Storm Count (Full Vintage) | `storm_major_storm_count_30yr` | count | events | 0 – 10000 | `storm-history-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_storm_property_damage_events_10yr_swfl` | SWFL Property-Damage Events (10-Year Window) | `storm_property_damage_events_10yr` | count | events | 0 – 10000 | `storm-history-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_storm_total_storm_count_30yr_swfl` | SWFL Total Storm Event Count (Full Vintage) | `storm_total_storm_count_30yr` | count | events | 0 – 100000 | `storm-history-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_sw_stage_caloosahatchee_ft` | Caloosahatchee River Stage (S-79 / Olga) | `swfl_sw_stage_caloosahatchee_ft`, `caloosahatchee_stage_latest_ft` | elevation_ft | ft (gage local zero) | -5 – 30 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_swfl_sfha_coverage_pct` | SWFL Area-Weighted SFHA Coverage | `swfl_sfha_pct_area_weighted` | ratio | ratio (0–1) | 0 – 1 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_swfl_ve_zone_coverage_pct` | SWFL Area-Weighted Coastal V/VE Coverage | `swfl_ve_zone_pct_area_weighted` | ratio | ratio (0–1) | 0 – 1 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_swfl_ve_zone_polygon_count` | SWFL Coastal V/VE Polygon Count | `swfl_ve_zone_polygon_count` | integer | polygons | _unbounded_ | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_zip_barrier_island_score` | Per-ZIP SWFL Barrier-Island Classification Score | `env_zip_barrier_island_score` | score | score (0.0 inland / 0.5 coastal-mainland / 1.0 barrier) | 0 – 1 | `env-swfl`, `master` | `environmental`, `real-estate` | ✅ active |
| `env_zip_flood_aal_pct_swfl_rank` | Per-ZIP NFIP AAL Percentile Rank Across SWFL ZIPs | `env_zip_flood_aal_pct_swfl_rank` | percentile | percentile (0-100) | 0 – 100 | `env-swfl`, `master` | `environmental`, `real-estate` | ✅ active |
| `env_zip_flood_aal_usd_per_insured_property` | Per-ZIP NFIP Average Annual Loss per Insured Property (USD/yr) | `env_zip_flood_aal_usd_per_insured_property` | currency | USD/year | 0 – 50000 | `env-swfl`, `master` | `environmental`, `real-estate` | ✅ active |
| `env_zip_flood_cap_rate_adj_bps` | Per-ZIP SWFL Flood Cap-Rate Adjustment (bps) | `env_zip_flood_cap_rate_adj_bps` | bps | bps | 0 – 100 | `env-swfl`, `master` | `environmental`, `real-estate` | ✅ active |
| `env_zip_insurance_pct_typical_noi` | Per-ZIP SWFL Imputed Flood Insurance as Share of NOI | `env_zip_insurance_pct_typical_noi` | ratio | ratio | 0 – 1 | `env-swfl`, `master` | `environmental`, `real-estate` | ✅ active |

<details><summary>Scope notes</summary>

- **`env_collier_sfha_coverage_pct`** — Collier County (FIPS 12021) area-weighted SFHA coverage — the Naples / Marco Island / Everglades-fringe footprint. Pair with env_collier_ve_zone_coverage_pct for coastal-vs-inland structural read.
- **`env_collier_ve_zone_coverage_pct`** — Collier County (FIPS 12021) area-weighted V/VE coastal high-hazard coverage. Companion to env_lee_ve_zone_coverage_pct under identical FEMA NFHL area-weighted methodology; Naples and Marco Island concentrate this county's V/VE polygons.
- **`env_flood_losses_swfl_baseline_annual_usd`** — Median annual total of (amount_paid_on_building_claim + amount_paid_on_contents_claim + amount_paid_on_ico_claim) from data_lake.fema_nfip_claims across the 6 SWFL counties (FIPS 12071, 12021, 12015, 12043, 12051, 12115), restricted to non-storm years only (the full 1978-onward archive MINUS the SWFL_STORM_YEARS list in refinery/sources/fema-nfip-source.mts). The 'boring-times floor' for SWFL flood losses — the denominator for env_flood_losses_swfl_post_ian_ratio.
- **`env_flood_losses_swfl_post_ian_ratio`** — Most recent complete year's sum of (amount_paid_on_building_claim + amount_paid_on_contents_claim + amount_paid_on_ico_claim) from data_lake.fema_nfip_claims across the 6 SWFL counties (FIPS 12071, 12021, 12015, 12043, 12051, 12115) ÷ env_flood_losses_swfl_baseline_annual_usd. >2 = elevated activity (still in storm recovery); ~1 = back to baseline. Tracks the Ian/Helene/Milton recovery curve.
- **`env_flood_losses_swfl_storm_year_count_since_2000`** — Count of named SWFL-impacting hurricane years since 2000 with paid-claim totals > 10× baseline. Operationally = the SWFL_STORM_YEARS hardcoded list in refinery/sources/fema-nfip-source.mts filtered to year >= 2000, deduplicated by year — currently Charley 2004, Wilma 2005, Irma 2017, Ian 2022, and 2024 (Helene + Milton, same year) (n=5 distinct years). Reads as 'how often does SWFL get hammered by flood claims'; the 6 SWFL counties (FIPS 12071, 12021, 12015, 12043, 12051, 12115) are the union scope.
- **`env_flood_losses_swfl_storm_year_total_usd`** — Sum of (amount_paid_on_building_claim + amount_paid_on_contents_claim + amount_paid_on_ico_claim) from data_lake.fema_nfip_claims across all 6 SWFL counties (FIPS 12071 Lee, 12021 Collier, 12015 Charlotte, 12043 Glades, 12051 Hendry, 12115 Sarasota) in the named SWFL-impacting storm years (Charley 2004, Wilma 2005, Irma 2017, Ian 2022, Helene 2024, Milton 2024). Storm list hardcoded in refinery/sources/fema-nfip-source.mts with a LAST_REVIEWED date; update when a new named storm hits SWFL.
- **`env_flood_risk_pct`** — Generic flood-risk percentage at unspecified spatial granularity. Currently a stub — no source brain emits it, and the SWFL flood-coverage signal is carried instead by the scope-specific concepts env_swfl_sfha_coverage_pct, env_lee_sfha_coverage_pct, env_collier_sfha_coverage_pct (and their V/VE-zone siblings).
- **`env_gw_highwater_exceedance_days`** — Count of days within the most recent 365-day window where AT LEAST ONE Lee County (FIPS 12071) USGS active dv well reported a groundwater elevation above 2.0 ft NAVD88 (parameter 62610). The 2 ft threshold is a regional rule-of-thumb for septic-system constraint and slab-on-grade construction risk in low-lying parcels (carried over from the abandoned SFWMD DBHYDRO doc). De-duped per day: multiple wells exceeding on the same day counts as one day. Days_covered surfaces honestly when the window has gaps.
- **`env_gw_level_lee_median_ft`** — Median groundwater elevation across Lee County (FIPS 12071) USGS active dv wells reporting parameter 62610 (groundwater level above NAVD88), computed over the most recent 90 days of observations available in data_lake.usgs_daily. Higher values mean a higher water table — relevant to septic capacity, slab construction, and post-storm dewatering capacity in low-lying parcels.
- **`env_hurricane_cat3plus_passes_within_50mi_30yr_swfl`** — Distinct named storms in NOAA HURDAT2 whose lifetime max windspeed reached Saffir-Simpson Cat 3+ (>= 111 kt) AND that passed within 50 statute miles of any SWFL county centroid during the trailing 30-year window. Distance computed haversine from HURDAT2 obs lat/lon to hardcoded county centroids; threshold of 50mi captures eye-wall + significant tropical-storm-force wind impact band.
- **`env_hurricane_closest_pass_5yr_min_mi_swfl`** — Minimum haversine distance (statute miles) from any HURDAT2 observation point to any SWFL county centroid, across all named storms in the trailing 5-year window. Lower = closer = bigger near-term impact. A 'direct hit' is ~0-10mi; eye-wall passes are 10-30mi; significant outer-band impact is 30-100mi.
- **`env_hurricane_landfalls_swfl_30yr`** — Distinct named storms in NOAA HURDAT2 that made landfall inside any SWFL county polygon (LEE+COLLIER+CHARLOTTE+HENDRY+GLADES+SARASOTA, FIPS 12015/12021/12043/12051/12071/12115) during the trailing 30-year window. Landfall is determined by HURDAT2's record_id='L' marker, not by passing near a county; counts each storm at most once per county-year.
- **`env_hurricane_most_recent_landfall_swfl`** — Storm name + ISO landfall date (e.g. 'IAN 2022-09-28') of the most recent HURDAT2-recorded landfall (record_id='L') inside the SWFL county footprint. Surfaces recency of the last named-storm impact for recovery-stage framing. Encoded as a single string for the categorical metric slot; the underlying date is parseable from the trailing 'YYYY-MM-DD'.
- **`env_hurricane_nfip_paid_per_landfall_storm_avg_usd_swfl`** — Mean of (SUM(amount_paid_on_building_claim + amount_paid_on_contents_claim + amount_paid_on_ico_claim)) across all SWFL counties × storm_year combinations where a HURDAT2 landfall occurred in the storm_year. Joins HURDAT2 landfall records to OpenFEMA NFIP claims via county_fips + year_of_loss. Cross-tier metric: HURDAT2 lives in Tier 1 Storage Parquet, NFIP in Tier 2 Postgres; the brain pre-joins both in DuckDB SQL.
- **`env_hurricane_worst_storm_county_year_nfip_paid_usd_swfl`** — Maximum NFIP paid (building+contents+ICO) across all (county, storm_year) combinations where a HURDAT2 landfall occurred in the SWFL footprint. Highlights the single worst county-year hit on record in the joined corpus; pairs with env_hurricane_nfip_paid_per_landfall_storm_avg_usd_swfl for distribution context (mean vs max). Hurricane Ian × Lee 2022 typically wins this in modern vintages.
- **`env_lee_sfha_coverage_pct`** — Lee County (FIPS 12071) area-weighted SFHA coverage — the Fort Myers / Fort Myers Beach / Sanibel / Captiva footprint. The §6.4 FMB lease question keys on this and env_lee_ve_zone_coverage_pct.
- **`env_lee_ve_zone_coverage_pct`** — Lee County (FIPS 12071) area-weighted share of mapped footprint classified as FEMA coastal high-hazard (V, VE, V1–V30, V99). Pair with env_lee_sfha_coverage_pct for full structural-flood context. Lee County's coastal high-hazard exposure concentrates in the barrier-island ZIPs (33931 Fort Myers Beach, 33957 Sanibel, 33924 Captiva); county-aggregate values average across that concentration.
- **`env_rainfall_swfl_annual_in`** — Average annual precipitation total across USGS active dv rain gauges in Lee + Collier counties (FIPS 12071, 12021), parameter 00045 with statCd 00006 (sum). Per-station annual totals are computed for the most recent year with >= 10 monthly samples; the SWFL value is the AVERAGE (not sum) of station totals — averaging gives regional intensity, summing across stations is physically meaningless. Typical SWFL annual rainfall is 50-60 inches; >70 inches suggests an exceptionally wet year.
- **`env_storm_counties_covered_swfl`** — Plus-joined alphabetical list of counties present in the storm-history corpus, e.g. 'CHARLOTTE+COLLIER+LEE'. Provides scope provenance — if a county is missing, downstream consumers know NOT to trust the SWFL-wide rollup for that county.
- **`env_storm_extreme_wind_events_10yr_swfl`** — Count of NOAA Storm Events across LEE+COLLIER+CHARLOTTE in the trailing 10-year window with MAGNITUDE >= 74 kt (hurricane-force wind threshold). Drives storm-history-swfl's bearish/neutral direction read: >= 3 events in the window flips the brain bearish.
- **`env_storm_ingest_vintage_swfl`** — Hyphen-joined year range covered by this build's NOAA Storm Events corpus (e.g. '1996-2025'). Bump YEAR_RANGE_END in ingest/duckdb_pipelines/storm_history_swfl/constants.py when NCEI publishes the next yearly file, then re-run the ingest.
- **`env_storm_last_billion_dollar_event_date_swfl`** — ISO 8601 date of the most recent NOAA Storm Event across the SWFL footprint (LEE+COLLIER+CHARLOTTE) with damage_property >= $1B. Null when no billion-dollar event exists in the corpus window (e.g. fixture mode). Surfaces the recency of catastrophic-loss events for storm-recovery framing.
- **`env_storm_last_billion_dollar_event_type_swfl`** — NOAA EVENT_TYPE string of the most recent billion-dollar storm in the SWFL corpus. Pairs with env_storm_last_billion_dollar_event_date_swfl. Examples observed in the 1996-2025 vintage: Hurricane (Charley 2004, Ian 2022), Tornado, Flash Flood, Storm Surge/Tide.
- **`env_storm_major_storm_count_30yr_swfl`** — Count of NOAA Storm Events across LEE+COLLIER+CHARLOTTE over the FULL modern-schema vintage (1996-2025) where damage_property >= $1M AND event_type in {Hurricane, Tornado, Flash Flood, Storm Surge/Tide}. Backward-looking risk-history aggregate — pair with env-swfl (modeled exposure) for forward-looking decisions.
- **`env_storm_property_damage_events_10yr_swfl`** — Count of NOAA Storm Events across LEE+COLLIER+CHARLOTTE in the trailing 10-year window with a parseable, non-zero damage_property value. Source: s3://lake-tier1/environmental/storm_events_swfl.parquet via DuckDB httpfs; ingested by ingest/duckdb_pipelines/storm_history_swfl/pipeline.py. Excludes rows with unparseable damage strings (counted separately, not summed).
- **`env_storm_total_storm_count_30yr_swfl`** — Count of ALL NOAA Storm Events across LEE+COLLIER+CHARLOTTE over the FULL modern-schema vintage (1996-2025). Denominator-style total — provides context for the major-storm and 10-year-window ratios but is not itself a risk-magnitude indicator.
- **`env_sw_stage_caloosahatchee_ft`** — Most recent daily-mean gage height across USGS active dv sites in the Caloosahatchee HUC (03090205%) reporting parameter 00065. Reference is gage local zero, NOT a vertical datum — useful for trend and threshold comparisons within the basin but NOT cross-site additive without datum conversion. Caloosahatchee at S-79 (site 02292900) is the canonical reference; multiple gages averaged via median when more than one reports on the same date.
- **`env_swfl_sfha_coverage_pct`** — Area-weighted share of mapped SWFL footprint (6 counties) classified as a FEMA Special Flood Hazard Area per 44 CFR §59.1. Computed in env-swfl via sum(Shape__Area) over SFHA-classified zones ÷ sum(Shape__Area) over all returned zones. Areas are square decimal degrees (WGS84); only the RATIO is meaningful — absolute areas never propagate.
- **`env_swfl_ve_zone_coverage_pct`** — Area-weighted share of mapped SWFL footprint (6 counties) classified as FEMA coastal high-hazard (V, VE, V1–V30, V99). Coastal-high-hazard zones are the V-prefixed subset of SFHA, distinguished from A-prefixed riverine/sheet-flow SFHA by wave-action exposure. Pair with env_swfl_sfha_coverage_pct for full structural-flood context.
- **`env_swfl_ve_zone_polygon_count`** — Count of distinct FEMA V/VE-classified polygons across the SWFL 6-county footprint. A polygon count, not an area; structural read on coastal-high-hazard fragmentation. Pair with env_swfl_ve_zone_coverage_pct for relative scale.
- **`env_zip_barrier_island_score`** — Three-state SWFL geographic classification from the static table in refinery/lib/swfl-geo.mts: 1.0 = barrier island (Fort Myers Beach 33931, Sanibel 33957, Captiva 33924, Marco Island 34145, Boca Grande 33921); 0.5 = coastal-mainland (Bonita Beach 34134, Naples coastal 34102, Cape Coral SW 33914, Fort Myers downtown 33901); 0.0 = inland (Cape Coral E 33990, North Naples 34109, East Naples 34112, plus all SWFL ZIPs not in the table — conservative default). The flood-barrier-mode-1 constitution rule in real-estate.mts fires only when this score is 1.0 AND aal_usd_per_insured_property ≥ FLOOD_BA…
- **`env_zip_flood_aal_pct_swfl_rank`** — Linear-method percentile rank of a ZIP's per-insured-property AAL across all SWFL ZIPs with ≥1 claim in the AAL_WINDOW_YEARS=10 window. 100 = highest-AAL ZIP, 0 = lowest. Computed across the FULL SWFL ZIP distribution (not just the top-6) so the value is comparable across runs even though only top-6 fragments are emitted. Emitted with slug template swfl_zip_{ZIP}_flood_aal_pct_swfl_rank; ZIP-templated slugs bypass SKOS at runtime per refinery/constitution/real-estate.mts.
- **`env_zip_flood_aal_usd_per_insured_property`** — Per-SWFL-ZIP average annual flood loss: sum(amount_paid_on_building_claim + amount_paid_on_contents_claim + amount_paid_on_ico_claim over last AAL_WINDOW_YEARS=10 years where reported_zipcode=Z) ÷ 10 ÷ insured_denominator(Z), where v1 insured_denominator(Z) = ZIP_POPULATION_2020[Z] × INSURED_PENETRATION_FACTOR (0.30 NSI proxy). Emitted by env-swfl as one metric per top-6 highest-AAL ZIP with the slug template swfl_zip_{ZIP}_flood_aal_usd_per_insured_property; the ZIP-templated slugs bypass SKOS resolveConceptSlugs at constitution-trigger time and are matched via regex (see refinery/constituti…
- **`env_zip_flood_cap_rate_adj_bps`** — Per-SWFL-ZIP cap-rate adjustment in basis points, derived from the barrier-island score via swfl-geo capRateBpsFor(): 1.0 → barrier-island midpoint, 0.5 → coastal-mainland midpoint, 0.0 → inland (zero or minimal). Calibrated against ULI/LaSalle 2024 guidance of +25-50 bps for elevated physical risk, stratified by exposure intensity. Emitted by env-swfl as one metric per top-6 highest-AAL ZIP with the slug template swfl_zip_{ZIP}_flood_cap_rate_adj_bps. Source: internal://refinery/lib/swfl-geo.mts.
- **`env_zip_insurance_pct_typical_noi`** — Per-SWFL-ZIP imputed flood insurance load as a fraction of typical NOI: (AAL × 2) ÷ (median_building_property_value × 0.08), where AAL is the per-insured-property NFIP loss (env_zip_flood_aal_usd_per_insured_property), median_building_property_value is the FEMA-reported median, and the 8% cap-rate assumption converts building value to a typical NOI proxy. Emitted by env-swfl as one metric per top-6 highest-AAL ZIP with the slug template swfl_zip_{ZIP}_insurance_pct_typical_noi.

</details>

### `hospitality` (5)

| Concept ID | prefLabel | Raw slugs | Type | Unit | Range / Allowed | Source brains | Domains | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hosp_tdt_latest_monthly_collections` | Latest Monthly TDT Collections (Lee County) | `latest_monthly_collections_usd` | currency | USD | _unbounded_ | `tourism-tdt`, `master` | `hospitality` | ✅ active |
| `hosp_tdt_post_ian_recovery_ratio` | Post-Hurricane-Ian Recovery Ratio | `post_ian_recovery_ratio` | ratio | ratio (1.0 = full recovery) | 0 – 5 | `tourism-tdt`, `master` | `hospitality`, `environmental` | ✅ active |
| `hosp_tdt_seasonal_position` | TDT Seasonal Position vs Historical Mean | `seasonal_position_vs_history` | ratio | ratio (1.0 = matches historical mean) | 0 – 3 | `tourism-tdt`, `master` | `hospitality` | ✅ active |
| `hosp_tdt_trailing_12mo_collections` | Trailing 12-Month TDT Collections (Lee County) | `trailing_12mo_collections_usd` | currency | USD | _unbounded_ | `tourism-tdt`, `master` | `hospitality` | ✅ active |
| `hosp_tdt_yoy_delta` | TDT Year-over-Year Delta | `yoy_delta_pct` | percentage | % | -100 – 200 | `tourism-tdt`, `master` | `hospitality` | ✅ active |

<details><summary>Scope notes</summary>

- **`hosp_tdt_latest_monthly_collections`** — Most recent reported month of Lee County Tourist Development Tax collections from the Florida DOR. Period grain is one calendar month; single-month reads should NEVER be extrapolated to an annual run rate — pair with hosp_tdt_trailing_12mo_collections.
- **`hosp_tdt_post_ian_recovery_ratio`** — trailing_12mo_collections / best pre-Ian 12-month total. 1.0 = full recovery; <0.7 is the bearish-bound threshold in tourism-tdt's voteTdtDirection. Ian landfall 2022-09-28; FY2023 onward is the post-Ian window.
- **`hosp_tdt_seasonal_position`** — Latest month's TDT collections ÷ mean collections for that same calendar month across all observed years. >1.0 = above-trend for the season; <1.0 = below-trend. Operators read this to separate true-bearish from in-trough-but-on-pace.
- **`hosp_tdt_trailing_12mo_collections`** — Sum of the most recent 12 months of Lee County TDT collections, ending at the latest reported period. The operator's annual-run-rate read; smooths over peak/shoulder/trough seasonality.
- **`hosp_tdt_yoy_delta`** — Same-month year-over-year change in Lee County TDT collections (latest month vs same calendar month prior fiscal year). Positive = YoY growth. Single observation, not a trend — pair with hosp_tdt_trailing_12mo_collections for run-rate context.

</details>

### `logistics` (19)

| Concept ID | prefLabel | Raw slugs | Type | Unit | Range / Allowed | Source brains | Domains | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `logistics_inbound_freight_tons_swfl` | SWFL Inbound Domestic Freight (Thousand Tons, Latest FAF5 Year) | `inbound_freight_tons_swfl` | count | thousand tons | 0 – 1000000 | `logistics-swfl`, `master` | `logistics` | ✅ active |
| `logistics_inbound_freight_value_swfl_musd` | SWFL Inbound Domestic Freight Value (Millions USD, Latest FAF5 Year) | `inbound_freight_value_swfl_musd` | count | millions USD | 0 – 1000000 | `logistics-swfl`, `master` | `logistics` | ✅ active |
| `logistics_nowcast_avg_payload_tons_per_truck` | Average Payload Per Truck (FHWA Constant) | `avg_payload_tons_per_truck` | ratio | tons/truck | 0 – 100 | `logistics-swfl-nowcast`, `master` | `logistics` | ✅ active |
| `logistics_nowcast_baseline_validity_flag` | SWFL Freight Baseline Validity Flag | `baseline_validity_flag` | enum | — | `valid` / `stale-structural` | `logistics-swfl-nowcast`, `master` | `logistics` | ✅ active |
| `logistics_nowcast_consecutive_breach_days` | SWFL Freight Consecutive Breach Days | `consecutive_breach_days` | count | days | 0 – 3650 | `logistics-swfl-nowcast`, `master` | `logistics` | ✅ active |
| `logistics_nowcast_current_activity_tons_year` | SWFL Freight Current Activity (Tons/Year, FDOT Segment-Counts) | `current_activity_tons_year`, `current_flow_tons_year` | count | tons/year | 0 – 10000000000 | `logistics-swfl-nowcast`, `master` | `logistics` | ✅ active |
| `logistics_nowcast_deviation_pct` | SWFL Freight Deviation (Percent vs Baseline) | `deviation_pct` | percentage | % | -100 – 1000 | `logistics-swfl-nowcast`, `master` | `logistics` | ✅ active |
| `logistics_nowcast_deviation_z` | SWFL Freight Deviation Z-Score | `deviation_z` | ratio | z-score | -10 – 10 | `logistics-swfl-nowcast`, `master` | `logistics` | ✅ active |
| `logistics_nowcast_faf5_inbound_flow_tons_year` | SWFL FAF5 Inbound Freight Flow (Tons/Year, CONTEXT) | `faf5_inbound_flow_tons_year`, `baseline_flow_tons_year` | count | tons/year | 0 – 10000000000 | `logistics-swfl-nowcast`, `master` | `logistics` | ✅ active |
| `logistics_nowcast_freight_segment_count` | SWFL Freight Segment Count (FDOT, Latest Year) | `freight_segment_count` | count | segments | 0 – 100000 | `logistics-swfl-nowcast`, `master` | `logistics` | ✅ active |
| `logistics_nowcast_history_days_observed` | SWFL Freight Rolling-History Days Observed | `history_days_observed` | count | days | 0 – 365 | `logistics-swfl-nowcast`, `master` | `logistics` | ✅ active |
| `logistics_nowcast_rolling_mean_activity_tons_year` | SWFL Freight Rolling-Mean Baseline (Tons/Year, FDOT History) | `rolling_mean_activity_tons_year` | count | tons/year | 0 – 10000000000 | `logistics-swfl-nowcast`, `master` | `logistics` | ✅ active |
| `logistics_nowcast_rolling_stddev_activity_tons_year` | SWFL Freight Rolling-Stddev Baseline (Tons/Year, FDOT History) | `rolling_stddev_activity_tons_year` | count | tons/year | 0 – 10000000000 | `logistics-swfl-nowcast`, `master` | `logistics` | ✅ active |
| `logistics_nowcast_shock_state` | SWFL Freight Shock State | `shock_state` | enum | — | `normal` / `anomaly` / `structural_break` / `insufficient_history` | `logistics-swfl-nowcast`, `master` | `logistics` | ✅ active |
| `traffic_aadt_swfl_5yr_cagr_pct` | SWFL AADT 5-Year CAGR (2021–2025) | `aadt_5yr_cagr`, `traffic_cagr_swfl` | percent_change | percent CAGR | -20 – 20 | `traffic-swfl`, `master` | `logistics` | ✅ active |
| `traffic_aadt_swfl_avg` | SWFL Length-Weighted Average AADT (Latest FDOT Year) | `aadt_swfl_avg`, `traffic_aadt_avg_swfl` | count | vehicles per day | 0 – 500000 | `traffic-swfl`, `master` | `logistics` | ✅ active |
| `traffic_aadt_swfl_yoy_pct` | SWFL AADT Year-over-Year Change (Latest vs Prior FDOT Year) | `aadt_yoy_pct`, `traffic_yoy_swfl` | percent_change | percent | -50 – 50 | `traffic-swfl`, `master` | `logistics` | ✅ active |
| `traffic_post_ian_recovery_index` | SWFL Coastal Counties Post-Ian Recovery Index (2025 ÷ 2022) | `post_ian_recovery`, `ian_recovery_index` | index | index (2022 = 100) | 0 – 200 | `traffic-swfl`, `master` | `logistics` | ✅ active |
| `traffic_truck_share_swfl_median_pct` | SWFL Median Truck Share (FDOT TFCTR, Latest Year) | `truck_share_median`, `freight_density_swfl` | percentage | percent | 0 – 100 | `traffic-swfl`, `master` | `logistics` | ✅ active |

<details><summary>Scope notes</summary>

- **`logistics_inbound_freight_tons_swfl`** — FAF5 sum of inbound domestic flows where dms_dest=129 (Remainder of Florida, the SWFL zone) and trade_type=1, reported in thousand-tons for the latest historical FAF5 year. Imports and exports are NOT included in this aggregate — see logistics_inbound_freight_value_swfl_musd for the dollar denominator.
- **`logistics_inbound_freight_value_swfl_musd`** — FAF5 sum of inbound domestic flow value, in millions of USD, for the same scope as logistics_inbound_freight_tons_swfl. Imports and exports excluded.
- **`logistics_nowcast_avg_payload_tons_per_truck`** — Locked constant 16.0 per FHWA Highway Statistics 2023 Table VM-1 (combination-truck average net loaded payload). Single national-average — SWFL commodity mix may skew heavier; SCTG-weighted upgrade reserved for v2.
- **`logistics_nowcast_baseline_validity_flag`** — Sticky flag. Flips to stale-structural after 90 consecutive days of |z|>3 against the ROLLING FDOT history baseline (Path B) — signals the rolling-mean baseline has drifted enough that operator review of the rolling window itself is warranted. Cold-start runs never flip the flag.
- **`logistics_nowcast_consecutive_breach_days`** — Stateful counter sourced from data_lake.fdot_freight_nowcast_shock_log (append-only Tier 2 table). Counts consecutive days |z|>3 with the same sign; resets to 0 when |z|≤3, sign flips, or the current run is cold-start (z suppressed).
- **`logistics_nowcast_current_activity_tons_year`** — Path B (post-commit 297ad23): Σ over freight-coded Lee+Collier segments of AADT × tfctr (FDOT per-segment truck-share) × AVG_PAYLOAD_TONS_PER_TRUCK (16.0, FHWA Highway Statistics 2023 Table VM-1) × 365. Deliberately omits segment length — v1 multiplied by miles which mismatched FAF5's tons baseline by units AND by population (pass-through vs delivered). This metric is ACTIVITY (segment counts, over-counts pass-through) — do not compare directly to FAF5 flow. raw_slug 'current_flow_tons_year' retained for legacy back-compat.
- **`logistics_nowcast_deviation_pct`** — Path B: (current_activity_tons_year − rolling_mean_activity_tons_year) / rolling_mean × 100. Companion to logistics_nowcast_deviation_z; both move in lockstep but percent is operator-readable. Suppressed on cold-start runs.
- **`logistics_nowcast_deviation_z`** — Path B: (current_activity_tons_year − rolling_mean_activity_tons_year) / rolling_stddev_activity_tons_year, computed over the last ROLLING_WINDOW_DAYS (90) of shock-log history. Suppressed (omitted from key_metrics) on cold-start runs (history_days_observed < COLD_START_THRESHOLD_DAYS). |z|>3 triggers shock_state escalation.
- **`logistics_nowcast_faf5_inbound_flow_tons_year`** — FAF5 audited annual inbound freight FLOW to SWFL. Derived as logistics-swfl.inbound_freight_tons_swfl × 1000 (kilotons → tons). Under Path B (post-commit 297ad23) this is preserved as CONTEXT only — it does NOT anchor the deviation math (which is computed against FDOT's own rolling-history baseline). raw_slug 'baseline_flow_tons_year' retained for legacy back-compat.
- **`logistics_nowcast_freight_segment_count`** — Number of freight-coded FDOT segments (roadway LIKE 'I-%' OR 'US-%') in Lee+Collier counties contributing to the current-flow aggregate. Sanity check — a sudden drop signals data-pull failure, not a real freight shock.
- **`logistics_nowcast_history_days_observed`** — Path B cold-start gate. Count of prior shock-log rows with non-null current_activity_tons_year inside the rolling window. Must be ≥ COLD_START_THRESHOLD_DAYS (90) before deviation_z is computed and emitted; otherwise shock_state = 'insufficient_history' and deviation_z/pct are suppressed from key_metrics.
- **`logistics_nowcast_rolling_mean_activity_tons_year`** — Path B: rolling mean of the last ROLLING_WINDOW_DAYS (90) shock-log rows with non-null current_activity_tons_year. This IS the math anchor for the deviation z-score — replaces the v1 FAF5-derived baseline. Drifts slowly as new daily activity rolls in.
- **`logistics_nowcast_rolling_stddev_activity_tons_year`** — Path B: population stddev of the same 90-day rolling window used for rolling_mean_activity_tons_year. Denominator of the deviation z-score. Replaces the v1 fixed-CoV (baseline_mu × 0.10) computation.
- **`logistics_nowcast_shock_state`** — Deterministic state machine over consecutive-day |z|>3 counter: ≥3d → anomaly; ≥30d → structural_break (candidate); ≥90d also flips baseline_validity_flag. Path B added 'insufficient_history' for the cold-start gate (history_days_observed < COLD_START_THRESHOLD_DAYS). Computed in code, never LLM.
- **`traffic_aadt_swfl_5yr_cagr_pct`** — Compound annual growth rate of length-weighted SWFL AADT (Lee + Collier) from 2021 base to 2025 latest. Comparable-segment cohort. Smooths YoY volatility (especially the 2022 Ian disruption); reads the medium-term demand trajectory.
- **`traffic_aadt_swfl_avg`** — Sum(AADT × Shape_Length) ÷ Sum(Shape_Length) across all FDOT segments in Lee + Collier counties for the latest published year. Shape_Length is the auto-generated geometry length in the layer projection (SHAPE_LENG attribute is unused — may be stale after route realignments). 2-county scope matches env-swfl and the master.mts SWFL Intelligence Lake scope; the wider 6-county FDOT extract would let thousands of rural Glades/Hendry/Monroe segments dominate the corridor signal. Length-weighting prevents short freeway off-ramps from dominating an arithmetic mean over thousands of segments.
- **`traffic_aadt_swfl_yoy_pct`** — Percent change in length-weighted AADT (Lee + Collier) between the latest and prior FDOT years, computed over the comparable-segment cohort (segments with non-null AADT in BOTH years matched on roadway + desc_frm + desc_to). Positive = vehicular demand rising; negative = falling. Sensitive to FDOT survey re-routing — see post-Ian caveat in brain OUTPUT.
- **`traffic_post_ian_recovery_index`** — Ratio of 2025 length-weighted AADT to 2022 (pre-storm) baseline across the three coastal SWFL counties most impacted by Hurricane Ian: Lee, Collier, Charlotte. >100 = volumes exceed pre-storm; <100 = below pre-storm. DELIBERATELY broader county set than the other traffic-swfl concepts (which are Lee + Collier) — the Ian index is about storm geography, not brain scope; Charlotte was in the eye-wall path and must be included for the storm signal to be honest. Glades, Hendry, Monroe excluded — Ian's path didn't materially hit them.
- **`traffic_truck_share_swfl_median_pct`** — Median value of TFCTR (truck factor) across Lee + Collier FDOT segments for the latest year. Identifies freight-dense corridors. Complements logistics_inbound_freight_tons_swfl (FAF5 zone-to-zone aggregate) — TFCTR says WHERE trucks physically move; FAF5 says WHAT TOTAL VOLUME they carry.

</details>

### `macro` (9)

| Concept ID | prefLabel | Raw slugs | Type | Unit | Range / Allowed | Source brains | Domains | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `macro_cpi_yoy` | US CPI Year-over-Year | `cpi_yoy` | percentage | % | -5 – 25 | `macro-us` | `macro` | ✅ active |
| `macro_fl_estab_count_construction` | Florida Construction Establishments (NAICS 23, Census CBP) | `fl_estab_count_construction` | count | establishments | 0 – 1000000 | `macro-florida`, `master` | `macro` | ✅ active |
| `macro_fl_estab_count_food_service` | Florida Food Service & Accommodation Establishments (NAICS 72, Census CBP) | `fl_estab_count_food_service` | count | establishments | 0 – 1000000 | `macro-florida`, `master` | `macro` | ✅ active |
| `macro_fl_estab_count_healthcare` | Florida Healthcare Establishments (NAICS 62, Census CBP) | `fl_estab_count_healthcare` | count | establishments | 0 – 1000000 | `macro-florida`, `master` | `macro` | ✅ active |
| `macro_fl_estab_count_professional` | Florida Professional Services Establishments (NAICS 54, Census CBP) | `fl_estab_count_professional` | count | establishments | 0 – 1000000 | `macro-florida`, `master` | `macro` | ✅ active |
| `macro_fl_estab_count_retail` | Florida Retail Establishments (NAICS 44-45, Census CBP) | `fl_estab_count_retail` | count | establishments | 0 – 1000000 | `macro-florida`, `master` | `macro` | ✅ active |
| `macro_fl_labor_participation` | Florida Labor Force Participation Rate | `fl_labor_participation` | percentage | % | 40 – 80 | `macro-florida` | `macro`, `demographics` | ✅ active |
| `macro_fl_unemployment` | Florida Unemployment Rate | `fl_unemployment` | percentage | % | 0 – 25 | `macro-florida`, `master` | `macro`, `demographics` | ✅ active |
| `macro_sofr_rate` | SOFR (Secured Overnight Financing Rate) | `sofr_rate` | percentage | % | 0 – 20 | `macro-us`, `master` | `macro`, `finance` | ✅ active |

<details><summary>Scope notes</summary>

- **`macro_cpi_yoy`** — Fed's 2% target is the reference anchor. Shelter remains the sticky component through 2026.
- **`macro_fl_estab_count_construction`** — Statewide Census County Business Patterns establishment count for NAICS 23 (Construction). Level metric — direction comes from sibling brains (notably sector-credit-swfl charge-off rate for construction).
- **`macro_fl_estab_count_food_service`** — Statewide Census County Business Patterns establishment count for NAICS 72 (Accommodation and Food Services). Level metric — direction comes from sibling brains.
- **`macro_fl_estab_count_healthcare`** — Statewide Census County Business Patterns establishment count for NAICS 62 (Health Care and Social Assistance). Level metric — direction comes from sibling brains.
- **`macro_fl_estab_count_professional`** — Statewide Census County Business Patterns establishment count for NAICS 54 (Professional, Scientific, and Technical Services). Level metric — direction comes from sibling brains.
- **`macro_fl_estab_count_retail`** — Statewide Census County Business Patterns establishment count for NAICS 44-45 (Retail Trade). Level metric — direction read via macro-us SOFR via the rising-rates-dominance override, not via the establishment count itself.
- **`macro_fl_labor_participation`** — Climbs against retirement-state demographic gravity. A positive signal on Florida's working-age engagement.
- **`macro_fl_unemployment`** — Primary labor-tightness read for SWFL operators. Tourism and construction absorb new entrants when this stays low.
- **`macro_sofr_rate`** — Floor for floating-rate CRE debt. Rising SOFR triggers rising-rates-dominance override in refinery/constitution/finance.mts (retargeted from macro-swfl to macro-us in the 2026-05-17 macro restructure) when magnitude > 0.6.

</details>

### `qualitative` (5)

| Concept ID | prefLabel | Raw slugs | Type | Unit | Range / Allowed | Source brains | Domains | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `qual_confidence` | Deterministic Confidence Score | `confidence` | index | 0–1 scale | 0 – 1 | `all` | `all` | ✅ active |
| `qual_magnitude` | Synthesis Magnitude | `magnitude` | index | 0–1 scale | 0 – 1 | `all` | `all` | ✅ active |
| `qual_metric_trajectory` | Metric Trajectory | `direction` | enum | — | `rising` / `falling` / `stable` | `all` | `all` | ✅ active |
| `qual_sentiment_direction` | Market Sentiment Direction | `direction` | enum | — | `bullish` / `bearish` / `neutral` / `mixed` | `all` | `all` | ✅ active |
| `qual_trust_tier` | Source Trust Tier | `trust_tier` | integer | — | `1` / `2` / `3` / `4` | `all` | `all` | ✅ active |

<details><summary>Scope notes</summary>

- **`qual_confidence`** — avg(trust_tier_score) × freshness_ratio. Deterministic — never produced by an LLM. Formula: refinery/lib/confidence.mts.
- **`qual_magnitude`** — Strength of the brain's direction read. 0 = no signal, 1 = maximum conviction. Computed deterministically from the upstream vote distribution.
- **`qual_metric_trajectory`** — Single-series time-series direction at the metric level. NEVER conflated with qual_sentiment_direction. Answers: which way is this number moving?
- **`qual_sentiment_direction`** — Brain-level qualitative read. Output of synthesis stage. NEVER conflated with qual_metric_trajectory. Answers: where should an operator lean?
- **`qual_trust_tier`** — 1=primary (federal/SEC/NOAA), 2=verified editorial/brain output, 3=secondary aggregator, 4=inferred. Worst (highest number) wins across upstreams. Defined in refinery/types/pack.mts.

</details>

### `real-estate` (12)

| Concept ID | prefLabel | Raw slugs | Type | Unit | Range / Allowed | Source brains | Domains | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cre_cap_rate` | Cap Rate (per corridor) | `cap_rate` | percentage | % | 0 – 20 | `cre-swfl` | `real-estate` | ✅ active |
| `cre_cap_rate_median` | Median Cap Rate (corpus) | `cap_rate_median` | percentage | % | 0 – 20 | `cre-swfl`, `master` | `real-estate` | ✅ active |
| `cre_corridor_evolution` | Corridor Evolution Stage | `evolution` | enum | — | `growing` / `stable` / `repositioning` / `declining` | `cre-swfl` | `real-estate` | ✅ active |
| `cre_seasonal_index` | Seasonal Index | `seasonal_index` | index | 0–1 scale | 0 – 1 | `cre-swfl` | `real-estate` | ✅ active |
| `cre_vacancy_rate` | Vacancy Rate (per corridor) | `vacancy_rate` | percentage | % | 0 – 100 | `cre-swfl` | `real-estate` | ✅ active |
| `cre_vacancy_rate_median` | Median Vacancy Rate (corpus) | `vacancy_rate_median` | percentage | % | 0 – 100 | `cre-swfl`, `master` | `real-estate` | ✅ active |
| `fhfa_cape_coral_msa_yoy_pct` | Cape Coral-Fort Myers MSA HPI Year-over-Year Change (FHFA) | `fhfa_cape_coral_msa_yoy_pct` | percent_change | percent | -30 – 30 | `properties-lee-value`, `master` | `real-estate` | ✅ active |
| `fhfa_fl_state_yoy_pct` | Florida Statewide HPI Year-over-Year Change (FHFA) | `fhfa_fl_state_yoy_pct` | percent_change | percent | -30 – 30 | `properties-lee-value`, `master` | `real-estate` | ✅ active |
| `properties_lee_sales_velocity_per_1k` | Lee County Qualified Sales Velocity (Per 1,000 Parcels, Current Year) | `sales_velocity_per_1k` | rate | qualified sales per 1,000 parcels | 0 – 200 | `properties-lee-value`, `master` | `real-estate` | ✅ active |
| `properties_lee_sales_velocity_zscore` | Lee County Sales-Velocity Z-Score (Current Year vs Trailing 3yr Baseline) | `sales_velocity_zscore` | zscore | standard deviations | -10 – 10 | `properties-lee-value`, `master` | `real-estate` | ✅ active |
| `properties_lee_soh_gap_median_pct` | Lee County Save-Our-Homes Gap Median (% Just Value Suppressed) | `soh_gap_median_pct` | percentage | % | 0 – 80 | `properties-lee-value`, `master` | `real-estate` | ✅ active |
| `properties_lee_total_parcels` | Lee County Total Parcels (Snapshot Row Count) | `total_parcels` | count | parcels | 0 – 1000000 | `properties-lee-value`, `master` | `real-estate` | ✅ active |

<details><summary>Scope notes</summary>

- **`cre_cap_rate`** — Point-in-time corridor-level cap rate. Trajectory (falling/stable/rising) signals landlord vs tenant market direction.
- **`cre_cap_rate_median`** — Median across all corridors with reported metrics in the current period. A falling median is the primary bullish signal in the cre-swfl pack.
- **`cre_corridor_evolution`** — Qualitative lifecycle stage of a corridor. Ordered by operator-friendliness descending; see cre_corridor_evolution_stages in ordered_collections.
- **`cre_seasonal_index`** — 0 = no seasonality, 1 = extreme seasonality. Corridor-level only; not aggregated to corpus median.
- **`fhfa_cape_coral_msa_yoy_pct`** — Year-over-year percent change in FHFA House Price Index (traditional, purchase-only, quarterly, NSA) for the Cape Coral-Fort Myers FL MSA — the Lee County price-level proxy. Computed from data_lake.fhfa_hpi: (latest_quarter_index - same_quarter_prior_year_index) / same_quarter_prior_year_index × 100. Negative = falling prices; positive = rising. Exogenous signal in properties-lee-value; contrasted against LeePA sales-velocity z-score.
- **`fhfa_fl_state_yoy_pct`** — Year-over-year percent change in FHFA House Price Index (traditional, purchase-only, quarterly, NSA) for the state of Florida (place_id='FL'). Computed from data_lake.fhfa_hpi. State baseline for comparison against Cape Coral MSA divergence. Negative = statewide prices falling; positive = rising.
- **`properties_lee_sales_velocity_per_1k`** — Count of LeePA-recorded qualified sales for the most recent COMPLETE calendar year (year-1 relative to today), divided by total parcels × 1000. Qualified sales exclude inheritance, divorce, and non-arms-length transfers.
- **`properties_lee_sales_velocity_zscore`** — Direction signal for properties-lee-value. Bullish if z ≥ +1.0, bearish if z ≤ −1.0. Baseline derived from each parcel's LATEST qualified sale, so re-sales overwrite earlier-year buckets — current-year z is biased UPWARD; treat marginal bullish reads as suggestive, not confirmatory.
- **`properties_lee_soh_gap_median_pct`** — Median (just_value − taxable_value) / just_value × 100 across parcels where cap_difference > 0 (actively benefiting from the Save-Our-Homes cap). Reads as a level metric describing how much of the tax base is locked behind the homestead cap. High = long-tenured ownership; low = recent turnover or non-homestead.
- **`properties_lee_total_parcels`** — Row count of data_lake.leepa_parcels (Lee County Property Appraiser parcel snapshot, layers 9+10+12 joined on FOLIOID). Single source of truth for the velocity denominator.

</details>

## Ordered Collections

### `cre_corridor_evolution_stages`

- **prefLabel:** Corridor Evolution Stage — Ordered by Operator Friendliness
- **type:** `skos:OrderedCollection`
- **ordering criterion:** operator-friendliness descending
- **ordered members:** `growing` → `stable` → `repositioning` → `declining`

| Member | Note |
| --- | --- |
| `growing` | Falling cap rate and/or vacancy, active development flags. Best landlord position. |
| `stable` | Cap rate and vacancy flat. Healthy equilibrium; limited upside. |
| `repositioning` | Tenant mix or use changing. Cap rate / vacancy may diverge. Watch flags closely. |
| `declining` | Rising cap rate and/or vacancy, outmigration signals. Tenant-market territory. |

## Brain DAG (typed edges)

Every edge is `{ id, edge_type }`. `edge_type` ∈ `input | constraint | veto | modifier` — see `refinery/types/pack.mts` → `BrainEdgeType`. A disputant reading `OUTPUT.drivers` on any brain can see edge semantics inline; this table is the authoring view of the same DAG.

| Brain | Domain | Upstream edges | Edge weight legend |
| --- | --- | --- | --- |
| `cre-swfl` | `real-estate` | _leaf_ | — |
| `env-swfl` | `environmental` | _leaf_ | — |
| `franchise-outcomes` | `real-estate` | _leaf_ | — |
| `hurricane-tracks-fl` | `environmental` | _leaf_ | — |
| `logistics-swfl` | `logistics` | _leaf_ | — |
| `logistics-swfl-nowcast` | `logistics` | `logistics-swfl` (**input**) | all input |
| `macro-florida` | `macro` | `macro-us` (**input**) | all input |
| `macro-swfl` | `macro` | `macro-florida` (**input**) | all input |
| `macro-us` | `macro` | _leaf_ | — |
| `master` | `real-estate` | `franchise-outcomes` (**input**), `cre-swfl` (**input**), `macro-us` (**input**), `macro-florida` (**input**), `macro-swfl` (**input**), `sector-credit-swfl` (**input**), `tourism-tdt` (**input**), `env-swfl` (**modifier**), `logistics-swfl` (**input**), `logistics-swfl-nowcast` (**input**), `traffic-swfl` (**input**), `properties-lee-value` (**input**) | 1× modifier |
| `properties-lee-value` | `real-estate` | _leaf_ | — |
| `sector-credit-swfl` | `finance` | `franchise-outcomes` (**input**), `macro-us` (**input**), `macro-florida` (**input**) | all input |
| `storm-history-swfl` | `environmental` | _leaf_ | — |
| `tourism-tdt` | `hospitality` | _leaf_ | — |
| `traffic-swfl` | `logistics` | _leaf_ | — |

## What each brain emits (SKOS concepts)

### `cre-swfl` (6 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `cre_cap_rate` | Cap Rate (per corridor) | `cap_rate` | active |
| `cre_cap_rate_median` | Median Cap Rate (corpus) | `cap_rate_median` | active |
| `cre_corridor_evolution` | Corridor Evolution Stage | `evolution` | active |
| `cre_seasonal_index` | Seasonal Index | `seasonal_index` | active |
| `cre_vacancy_rate` | Vacancy Rate (per corridor) | `vacancy_rate` | active |
| `cre_vacancy_rate_median` | Median Vacancy Rate (corpus) | `vacancy_rate_median` | active |

### `env-swfl` (20 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `env_collier_sfha_coverage_pct` | Collier County Area-Weighted SFHA Coverage | `collier_county_sfha_pct_area_weighted` | active |
| `env_collier_ve_zone_coverage_pct` | Collier County Area-Weighted Coastal V/VE Coverage | `collier_county_ve_zone_pct_area_weighted` | active |
| `env_flood_losses_swfl_baseline_annual_usd` | SWFL Non-Storm-Year Annual NFIP Paid Claims (Median) | `flood_losses_baseline`, `swfl_nonstorm_claims_baseline` | active |
| `env_flood_losses_swfl_post_ian_ratio` | SWFL Post-Ian Flood Recovery Ratio (Latest Year ÷ Baseline) | `swfl_post_ian_claims_ratio`, `post_ian_claims_ratio`, `swfl_flood_recovery_ratio` | active |
| `env_flood_losses_swfl_storm_year_count_since_2000` | SWFL Named-Storm-Year Count Since 2000 | `storm_year_count_swfl`, `swfl_storm_frequency` | active |
| `env_flood_losses_swfl_storm_year_total_usd` | SWFL Storm-Year NFIP Paid Claims (Cumulative) | `flood_losses_storm_total`, `swfl_storm_year_claims_usd` | active |
| `env_gw_highwater_exceedance_days` | Lee County Groundwater High-Water Exceedance Days (>2 ft NAVD88) | `swfl_gw_highwater_days_lee`, `lee_gw_exceedance_days_above_2ft` | active |
| `env_gw_level_lee_median_ft` | Lee County Groundwater Median Elevation (NAVD88) | `swfl_gw_lee_median_ft`, `lee_gw_median_navd88_ft` | active |
| `env_lee_sfha_coverage_pct` | Lee County Area-Weighted SFHA Coverage | `lee_county_sfha_pct_area_weighted` | active |
| `env_lee_ve_zone_coverage_pct` | Lee County Area-Weighted Coastal V/VE Coverage | `lee_county_ve_zone_pct_area_weighted` | active |
| `env_rainfall_swfl_annual_in` | SWFL Annual Rainfall (Latest Complete Year) | `swfl_rainfall_annual_in`, `rainfall_swfl_latest_year_in` | active |
| `env_sw_stage_caloosahatchee_ft` | Caloosahatchee River Stage (S-79 / Olga) | `swfl_sw_stage_caloosahatchee_ft`, `caloosahatchee_stage_latest_ft` | active |
| `env_swfl_sfha_coverage_pct` | SWFL Area-Weighted SFHA Coverage | `swfl_sfha_pct_area_weighted` | active |
| `env_swfl_ve_zone_coverage_pct` | SWFL Area-Weighted Coastal V/VE Coverage | `swfl_ve_zone_pct_area_weighted` | active |
| `env_swfl_ve_zone_polygon_count` | SWFL Coastal V/VE Polygon Count | `swfl_ve_zone_polygon_count` | active |
| `env_zip_barrier_island_score` | Per-ZIP SWFL Barrier-Island Classification Score | `env_zip_barrier_island_score` | active |
| `env_zip_flood_aal_pct_swfl_rank` | Per-ZIP NFIP AAL Percentile Rank Across SWFL ZIPs | `env_zip_flood_aal_pct_swfl_rank` | active |
| `env_zip_flood_aal_usd_per_insured_property` | Per-ZIP NFIP Average Annual Loss per Insured Property (USD/yr) | `env_zip_flood_aal_usd_per_insured_property` | active |
| `env_zip_flood_cap_rate_adj_bps` | Per-ZIP SWFL Flood Cap-Rate Adjustment (bps) | `env_zip_flood_cap_rate_adj_bps` | active |
| `env_zip_insurance_pct_typical_noi` | Per-ZIP SWFL Imputed Flood Insurance as Share of NOI | `env_zip_insurance_pct_typical_noi` | active |

### `franchise-outcomes` (1 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `sba_overall_survival_rate` | SBA Franchise Survival Rate (Corpus) | `overall_survival_rate` | active |

### `hurricane-tracks-fl` (6 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `env_hurricane_cat3plus_passes_within_50mi_30yr_swfl` | SWFL Cat-3+ Hurricane Passes Within 50mi (30-Year Window) | `hurricane_cat3plus_passes_within_50mi_30yr` | active |
| `env_hurricane_closest_pass_5yr_min_mi_swfl` | SWFL Closest Hurricane Pass (Trailing 5-Year Window, miles) | `hurricane_closest_pass_5yr_min_mi` | active |
| `env_hurricane_landfalls_swfl_30yr` | SWFL Hurricane Landfalls (Trailing 30-Year Window) | `hurricane_landfalls_30yr` | active |
| `env_hurricane_most_recent_landfall_swfl` | SWFL Most Recent Hurricane Landfall (Storm + Date) | `hurricane_most_recent_landfall_date` | active |
| `env_hurricane_nfip_paid_per_landfall_storm_avg_usd_swfl` | SWFL Average NFIP Paid per Landfall Storm (USD) | `hurricane_nfip_paid_per_landfall_storm_avg_usd` | active |
| `env_hurricane_worst_storm_county_year_nfip_paid_usd_swfl` | SWFL Worst Storm-County-Year NFIP Paid (USD) | `hurricane_worst_storm_county_year_nfip_paid_usd` | active |

### `logistics-swfl` (2 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `logistics_inbound_freight_tons_swfl` | SWFL Inbound Domestic Freight (Thousand Tons, Latest FAF5 Year) | `inbound_freight_tons_swfl` | active |
| `logistics_inbound_freight_value_swfl_musd` | SWFL Inbound Domestic Freight Value (Millions USD, Latest FAF5 Year) | `inbound_freight_value_swfl_musd` | active |

### `logistics-swfl-nowcast` (12 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `logistics_nowcast_avg_payload_tons_per_truck` | Average Payload Per Truck (FHWA Constant) | `avg_payload_tons_per_truck` | active |
| `logistics_nowcast_baseline_validity_flag` | SWFL Freight Baseline Validity Flag | `baseline_validity_flag` | active |
| `logistics_nowcast_consecutive_breach_days` | SWFL Freight Consecutive Breach Days | `consecutive_breach_days` | active |
| `logistics_nowcast_current_activity_tons_year` | SWFL Freight Current Activity (Tons/Year, FDOT Segment-Counts) | `current_activity_tons_year`, `current_flow_tons_year` | active |
| `logistics_nowcast_deviation_pct` | SWFL Freight Deviation (Percent vs Baseline) | `deviation_pct` | active |
| `logistics_nowcast_deviation_z` | SWFL Freight Deviation Z-Score | `deviation_z` | active |
| `logistics_nowcast_faf5_inbound_flow_tons_year` | SWFL FAF5 Inbound Freight Flow (Tons/Year, CONTEXT) | `faf5_inbound_flow_tons_year`, `baseline_flow_tons_year` | active |
| `logistics_nowcast_freight_segment_count` | SWFL Freight Segment Count (FDOT, Latest Year) | `freight_segment_count` | active |
| `logistics_nowcast_history_days_observed` | SWFL Freight Rolling-History Days Observed | `history_days_observed` | active |
| `logistics_nowcast_rolling_mean_activity_tons_year` | SWFL Freight Rolling-Mean Baseline (Tons/Year, FDOT History) | `rolling_mean_activity_tons_year` | active |
| `logistics_nowcast_rolling_stddev_activity_tons_year` | SWFL Freight Rolling-Stddev Baseline (Tons/Year, FDOT History) | `rolling_stddev_activity_tons_year` | active |
| `logistics_nowcast_shock_state` | SWFL Freight Shock State | `shock_state` | active |

### `macro-florida` (7 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `macro_fl_estab_count_construction` | Florida Construction Establishments (NAICS 23, Census CBP) | `fl_estab_count_construction` | active |
| `macro_fl_estab_count_food_service` | Florida Food Service & Accommodation Establishments (NAICS 72, Census CBP) | `fl_estab_count_food_service` | active |
| `macro_fl_estab_count_healthcare` | Florida Healthcare Establishments (NAICS 62, Census CBP) | `fl_estab_count_healthcare` | active |
| `macro_fl_estab_count_professional` | Florida Professional Services Establishments (NAICS 54, Census CBP) | `fl_estab_count_professional` | active |
| `macro_fl_estab_count_retail` | Florida Retail Establishments (NAICS 44-45, Census CBP) | `fl_estab_count_retail` | active |
| `macro_fl_labor_participation` | Florida Labor Force Participation Rate | `fl_labor_participation` | active |
| `macro_fl_unemployment` | Florida Unemployment Rate | `fl_unemployment` | active |

### `macro-us` (2 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `macro_cpi_yoy` | US CPI Year-over-Year | `cpi_yoy` | active |
| `macro_sofr_rate` | SOFR (Secured Overnight Financing Rate) | `sofr_rate` | active |

### `master` (51 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `cre_cap_rate_median` | Median Cap Rate (corpus) | `cap_rate_median` | active |
| `cre_vacancy_rate_median` | Median Vacancy Rate (corpus) | `vacancy_rate_median` | active |
| `env_flood_losses_swfl_baseline_annual_usd` | SWFL Non-Storm-Year Annual NFIP Paid Claims (Median) | `flood_losses_baseline`, `swfl_nonstorm_claims_baseline` | active |
| `env_flood_losses_swfl_post_ian_ratio` | SWFL Post-Ian Flood Recovery Ratio (Latest Year ÷ Baseline) | `swfl_post_ian_claims_ratio`, `post_ian_claims_ratio`, `swfl_flood_recovery_ratio` | active |
| `env_flood_losses_swfl_storm_year_count_since_2000` | SWFL Named-Storm-Year Count Since 2000 | `storm_year_count_swfl`, `swfl_storm_frequency` | active |
| `env_flood_losses_swfl_storm_year_total_usd` | SWFL Storm-Year NFIP Paid Claims (Cumulative) | `flood_losses_storm_total`, `swfl_storm_year_claims_usd` | active |
| `env_zip_barrier_island_score` | Per-ZIP SWFL Barrier-Island Classification Score | `env_zip_barrier_island_score` | active |
| `env_zip_flood_aal_pct_swfl_rank` | Per-ZIP NFIP AAL Percentile Rank Across SWFL ZIPs | `env_zip_flood_aal_pct_swfl_rank` | active |
| `env_zip_flood_aal_usd_per_insured_property` | Per-ZIP NFIP Average Annual Loss per Insured Property (USD/yr) | `env_zip_flood_aal_usd_per_insured_property` | active |
| `env_zip_flood_cap_rate_adj_bps` | Per-ZIP SWFL Flood Cap-Rate Adjustment (bps) | `env_zip_flood_cap_rate_adj_bps` | active |
| `env_zip_insurance_pct_typical_noi` | Per-ZIP SWFL Imputed Flood Insurance as Share of NOI | `env_zip_insurance_pct_typical_noi` | active |
| `fhfa_cape_coral_msa_yoy_pct` | Cape Coral-Fort Myers MSA HPI Year-over-Year Change (FHFA) | `fhfa_cape_coral_msa_yoy_pct` | active |
| `fhfa_fl_state_yoy_pct` | Florida Statewide HPI Year-over-Year Change (FHFA) | `fhfa_fl_state_yoy_pct` | active |
| `hosp_tdt_latest_monthly_collections` | Latest Monthly TDT Collections (Lee County) | `latest_monthly_collections_usd` | active |
| `hosp_tdt_post_ian_recovery_ratio` | Post-Hurricane-Ian Recovery Ratio | `post_ian_recovery_ratio` | active |
| `hosp_tdt_seasonal_position` | TDT Seasonal Position vs Historical Mean | `seasonal_position_vs_history` | active |
| `hosp_tdt_trailing_12mo_collections` | Trailing 12-Month TDT Collections (Lee County) | `trailing_12mo_collections_usd` | active |
| `hosp_tdt_yoy_delta` | TDT Year-over-Year Delta | `yoy_delta_pct` | active |
| `logistics_inbound_freight_tons_swfl` | SWFL Inbound Domestic Freight (Thousand Tons, Latest FAF5 Year) | `inbound_freight_tons_swfl` | active |
| `logistics_inbound_freight_value_swfl_musd` | SWFL Inbound Domestic Freight Value (Millions USD, Latest FAF5 Year) | `inbound_freight_value_swfl_musd` | active |
| `logistics_nowcast_avg_payload_tons_per_truck` | Average Payload Per Truck (FHWA Constant) | `avg_payload_tons_per_truck` | active |
| `logistics_nowcast_baseline_validity_flag` | SWFL Freight Baseline Validity Flag | `baseline_validity_flag` | active |
| `logistics_nowcast_consecutive_breach_days` | SWFL Freight Consecutive Breach Days | `consecutive_breach_days` | active |
| `logistics_nowcast_current_activity_tons_year` | SWFL Freight Current Activity (Tons/Year, FDOT Segment-Counts) | `current_activity_tons_year`, `current_flow_tons_year` | active |
| `logistics_nowcast_deviation_pct` | SWFL Freight Deviation (Percent vs Baseline) | `deviation_pct` | active |
| `logistics_nowcast_deviation_z` | SWFL Freight Deviation Z-Score | `deviation_z` | active |
| `logistics_nowcast_faf5_inbound_flow_tons_year` | SWFL FAF5 Inbound Freight Flow (Tons/Year, CONTEXT) | `faf5_inbound_flow_tons_year`, `baseline_flow_tons_year` | active |
| `logistics_nowcast_freight_segment_count` | SWFL Freight Segment Count (FDOT, Latest Year) | `freight_segment_count` | active |
| `logistics_nowcast_history_days_observed` | SWFL Freight Rolling-History Days Observed | `history_days_observed` | active |
| `logistics_nowcast_rolling_mean_activity_tons_year` | SWFL Freight Rolling-Mean Baseline (Tons/Year, FDOT History) | `rolling_mean_activity_tons_year` | active |
| `logistics_nowcast_rolling_stddev_activity_tons_year` | SWFL Freight Rolling-Stddev Baseline (Tons/Year, FDOT History) | `rolling_stddev_activity_tons_year` | active |
| `logistics_nowcast_shock_state` | SWFL Freight Shock State | `shock_state` | active |
| `macro_fl_estab_count_construction` | Florida Construction Establishments (NAICS 23, Census CBP) | `fl_estab_count_construction` | active |
| `macro_fl_estab_count_food_service` | Florida Food Service & Accommodation Establishments (NAICS 72, Census CBP) | `fl_estab_count_food_service` | active |
| `macro_fl_estab_count_healthcare` | Florida Healthcare Establishments (NAICS 62, Census CBP) | `fl_estab_count_healthcare` | active |
| `macro_fl_estab_count_professional` | Florida Professional Services Establishments (NAICS 54, Census CBP) | `fl_estab_count_professional` | active |
| `macro_fl_estab_count_retail` | Florida Retail Establishments (NAICS 44-45, Census CBP) | `fl_estab_count_retail` | active |
| `macro_fl_unemployment` | Florida Unemployment Rate | `fl_unemployment` | active |
| `macro_sofr_rate` | SOFR (Secured Overnight Financing Rate) | `sofr_rate` | active |
| `properties_lee_sales_velocity_per_1k` | Lee County Qualified Sales Velocity (Per 1,000 Parcels, Current Year) | `sales_velocity_per_1k` | active |
| `properties_lee_sales_velocity_zscore` | Lee County Sales-Velocity Z-Score (Current Year vs Trailing 3yr Baseline) | `sales_velocity_zscore` | active |
| `properties_lee_soh_gap_median_pct` | Lee County Save-Our-Homes Gap Median (% Just Value Suppressed) | `soh_gap_median_pct` | active |
| `properties_lee_total_parcels` | Lee County Total Parcels (Snapshot Row Count) | `total_parcels` | active |
| `sba_best_sector_survival` | Best-Sector SBA Survival Rate | `best_naics_survival` | active |
| `sba_overall_survival_rate` | SBA Franchise Survival Rate (Corpus) | `overall_survival_rate` | active |
| `sba_worst_sector_chargeoff` | Worst-Sector SBA Charge-off Rate | `worst_naics_chargeoff` | active |
| `traffic_aadt_swfl_5yr_cagr_pct` | SWFL AADT 5-Year CAGR (2021–2025) | `aadt_5yr_cagr`, `traffic_cagr_swfl` | active |
| `traffic_aadt_swfl_avg` | SWFL Length-Weighted Average AADT (Latest FDOT Year) | `aadt_swfl_avg`, `traffic_aadt_avg_swfl` | active |
| `traffic_aadt_swfl_yoy_pct` | SWFL AADT Year-over-Year Change (Latest vs Prior FDOT Year) | `aadt_yoy_pct`, `traffic_yoy_swfl` | active |
| `traffic_post_ian_recovery_index` | SWFL Coastal Counties Post-Ian Recovery Index (2025 ÷ 2022) | `post_ian_recovery`, `ian_recovery_index` | active |
| `traffic_truck_share_swfl_median_pct` | SWFL Median Truck Share (FDOT TFCTR, Latest Year) | `truck_share_median`, `freight_density_swfl` | active |

### `properties-lee-value` (6 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `fhfa_cape_coral_msa_yoy_pct` | Cape Coral-Fort Myers MSA HPI Year-over-Year Change (FHFA) | `fhfa_cape_coral_msa_yoy_pct` | active |
| `fhfa_fl_state_yoy_pct` | Florida Statewide HPI Year-over-Year Change (FHFA) | `fhfa_fl_state_yoy_pct` | active |
| `properties_lee_sales_velocity_per_1k` | Lee County Qualified Sales Velocity (Per 1,000 Parcels, Current Year) | `sales_velocity_per_1k` | active |
| `properties_lee_sales_velocity_zscore` | Lee County Sales-Velocity Z-Score (Current Year vs Trailing 3yr Baseline) | `sales_velocity_zscore` | active |
| `properties_lee_soh_gap_median_pct` | Lee County Save-Our-Homes Gap Median (% Just Value Suppressed) | `soh_gap_median_pct` | active |
| `properties_lee_total_parcels` | Lee County Total Parcels (Snapshot Row Count) | `total_parcels` | active |

### `sector-credit-swfl` (15 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `sba_best_sector_survival` | Best-Sector SBA Survival Rate | `best_naics_survival` | active |
| `sba_chargeoff_rate_sector_23` | Construction (NAICS 23) — SBA Charge-off Rate | `sector_23_chargeoff_rate` | active |
| `sba_chargeoff_rate_sector_42` | Wholesale Trade (NAICS 42) — SBA Charge-off Rate | `sector_42_chargeoff_rate` | active |
| `sba_chargeoff_rate_sector_44` | Retail Trade — Motor Vehicle & General Merchandise (NAICS 44) — SBA Charge-off Rate | `sector_44_chargeoff_rate` | active |
| `sba_chargeoff_rate_sector_45` | Retail Trade — Clothing, Sporting Goods & Non-store (NAICS 45) — SBA Charge-off Rate | `sector_45_chargeoff_rate` | active |
| `sba_chargeoff_rate_sector_48` | Transportation & Warehousing (NAICS 48) — SBA Charge-off Rate | `sector_48_chargeoff_rate` | active |
| `sba_chargeoff_rate_sector_52` | Finance & Insurance (NAICS 52) — SBA Charge-off Rate | `sector_52_chargeoff_rate` | active |
| `sba_chargeoff_rate_sector_53` | Real Estate, Rental & Leasing (NAICS 53) — SBA Charge-off Rate | `sector_53_chargeoff_rate` | active |
| `sba_chargeoff_rate_sector_54` | Professional, Scientific & Technical Services (NAICS 54) — SBA Charge-off Rate | `sector_54_chargeoff_rate` | active |
| `sba_chargeoff_rate_sector_56` | Administrative & Support Services (NAICS 56) — SBA Charge-off Rate | `sector_56_chargeoff_rate` | active |
| `sba_chargeoff_rate_sector_62` | Health Care & Social Assistance (NAICS 62) — SBA Charge-off Rate | `sector_62_chargeoff_rate` | active |
| `sba_chargeoff_rate_sector_71` | Arts, Entertainment & Recreation (NAICS 71) — SBA Charge-off Rate | `sector_71_chargeoff_rate` | active |
| `sba_chargeoff_rate_sector_72` | Accommodation & Food Services (NAICS 72) — SBA Charge-off Rate | `sector_72_chargeoff_rate` | active |
| `sba_chargeoff_rate_sector_81` | Other Services — Personal & Repair (NAICS 81) — SBA Charge-off Rate | `sector_81_chargeoff_rate` | active |
| `sba_worst_sector_chargeoff` | Worst-Sector SBA Charge-off Rate | `worst_naics_chargeoff` | active |

### `storm-history-swfl` (8 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `env_storm_counties_covered_swfl` | SWFL Counties Present in Storm History Corpus | `storm_counties_covered` | active |
| `env_storm_extreme_wind_events_10yr_swfl` | SWFL Hurricane-Force Wind Events (10-Year Window) | `storm_extreme_wind_events_10yr` | active |
| `env_storm_ingest_vintage_swfl` | SWFL Storm-History Ingest Vintage Range | `storm_ingest_vintage` | active |
| `env_storm_last_billion_dollar_event_date_swfl` | Most Recent SWFL Billion-Dollar Storm Event Date | `storm_last_billion_dollar_event_date` | active |
| `env_storm_last_billion_dollar_event_type_swfl` | Most Recent SWFL Billion-Dollar Storm Event Type | `storm_last_billion_dollar_event_type` | active |
| `env_storm_major_storm_count_30yr_swfl` | SWFL Major Storm Count (Full Vintage) | `storm_major_storm_count_30yr` | active |
| `env_storm_property_damage_events_10yr_swfl` | SWFL Property-Damage Events (10-Year Window) | `storm_property_damage_events_10yr` | active |
| `env_storm_total_storm_count_30yr_swfl` | SWFL Total Storm Event Count (Full Vintage) | `storm_total_storm_count_30yr` | active |

### `tourism-tdt` (5 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `hosp_tdt_latest_monthly_collections` | Latest Monthly TDT Collections (Lee County) | `latest_monthly_collections_usd` | active |
| `hosp_tdt_post_ian_recovery_ratio` | Post-Hurricane-Ian Recovery Ratio | `post_ian_recovery_ratio` | active |
| `hosp_tdt_seasonal_position` | TDT Seasonal Position vs Historical Mean | `seasonal_position_vs_history` | active |
| `hosp_tdt_trailing_12mo_collections` | Trailing 12-Month TDT Collections (Lee County) | `trailing_12mo_collections_usd` | active |
| `hosp_tdt_yoy_delta` | TDT Year-over-Year Delta | `yoy_delta_pct` | active |

### `traffic-swfl` (5 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `traffic_aadt_swfl_5yr_cagr_pct` | SWFL AADT 5-Year CAGR (2021–2025) | `aadt_5yr_cagr`, `traffic_cagr_swfl` | active |
| `traffic_aadt_swfl_avg` | SWFL Length-Weighted Average AADT (Latest FDOT Year) | `aadt_swfl_avg`, `traffic_aadt_avg_swfl` | active |
| `traffic_aadt_swfl_yoy_pct` | SWFL AADT Year-over-Year Change (Latest vs Prior FDOT Year) | `aadt_yoy_pct`, `traffic_yoy_swfl` | active |
| `traffic_post_ian_recovery_index` | SWFL Coastal Counties Post-Ian Recovery Index (2025 ÷ 2022) | `post_ian_recovery`, `ian_recovery_index` | active |
| `traffic_truck_share_swfl_median_pct` | SWFL Median Truck Share (FDOT TFCTR, Latest Year) | `truck_share_median`, `freight_density_swfl` | active |

_Concepts with `source_brains: ["all"]` (qualitative brain-output fields like `qual_confidence`, `qual_trust_tier`, `qual_sentiment_direction`) are emitted by every brain and intentionally omitted from this table._

## Constitution overrides (cascade)

Higher priority wins. Effect `force_signal_direction` tracks the originating signal's direction; `force_bearish` / `force_bullish` pin the read; `add_caveat` only appends a caveat. SKOS-aware rules (e.g. `hospitality-yoy-collapse`) declare trigger concepts by SKOS ID, resolve them to a raw-slug set at module-init via `resolveConceptSlugs` from `refinery/vocab/loader.mts`, and match `m.metric` against that set inside the predicate.

| Priority | Override ID | Effect | Domains |
| ---: | --- | --- | --- |
| 100 | `exogenous-critical-confirmed` | `force_signal_direction` | `real-estate` |
| 90 | `flood-barrier-mode-1` | `add_caveat` | `real-estate` |
| 80 | `naics-distress-veto` | `force_bearish` | `real-estate` |
| 70 | `rising-rates-dominance` | `force_bearish` | `finance` |
| 65 | `hospitality-recovery-collapse` | `force_bearish` | `hospitality` |
| 60 | `hospitality-yoy-collapse` | `force_bearish` | `hospitality` |

_Source: `refinery/constitution/{real-estate,finance,hospitality}.mts` — see those files for the predicate code and threshold values._

## Trust tiers (confidence weights)

Every `SourceConnector` declares one `trust_tier`. Stage 4's deterministic confidence formula averages the tier scores below across a pack's sources and multiplies by the TTL-freshness ratio (and upstream confidences). No LLM in the math path.

| Tier | Authority | Score |
| ---: | --- | ---: |
| 1 | Primary — federal, SEC, NOAA, FEMA | 1.0 |
| 2 | Verified editorial / shipped brain output | 0.8 |
| 3 | Secondary aggregator / industry report | 0.6 |
| 4 | Inferred / weakly attested | 0.4 |

_Formula: `refinery/lib/confidence.mts` — `confidence = avg(trust_tier_score) × freshness_ratio × avg(upstream_confidences)`._

## Data-quality checks

### Concepts with no source brain (2)

These concepts are registered in the vocab but no brain currently emits them. Usually intentional (stubs pre-registered for upcoming brains).

| Concept | Status | Scope hint |
| --- | --- | --- |
| `env_flood_risk_pct` | stub | Generic flood-risk percentage at unspecified spatial granularity. Currently a stub — no source brain emits it, and the SWFL flood-coverage signal is carried instead by the scope-specific concepts env… |
| `sba_naics_distress_baseline` | stub | Pre-registered for the naics-distress-veto override rule in refinery/constitution/real-estate.mts. Fires false until sector-credit-swfl exposes a baseline metric. Pair with sba_chargeoff_rate_sector_… |

### Unresolved `slug_index` entries (0)

_None — every `slug_index` entry points to a concept that exists._

### Concepts referencing a brain not in PACKS (0)

_None — every `source_brains` entry resolves to a registered pack._

---

**Notes**

- This file is generated; do not edit by hand. Edit `refinery/vocab/brain-vocabulary.json` or the per-pack `input_brains` arrays, then rerun the generator.
- SKOS pattern: each concept's stable ID (e.g. `env_lee_ve_zone_coverage_pct`) is the lookup key; `raw_slugs` are the legacy strings the engine still writes into brain `.md` files. `slug_index` inverts to make raw → concept resolution sync.
- DAG edge semantics live in `refinery/types/pack.mts` (`BrainEdgeType`). Edge weights in this ledger summarize the strongest edge type the brain carries on any of its inbound connections.
- Override priority ordering is enforced by `refinery/constitution/index.mts` after merging per-domain rule sets.
