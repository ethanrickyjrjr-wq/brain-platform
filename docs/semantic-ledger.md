# Semantic Ledger

_The data on the data — auto-generated read-only view of the SKOS vocabulary, DAG, and constitution overrides that drive the SWFL Intelligence Lake._

**Generated:** 2026-05-17T04:32:41.230Z (commit `d4e710f`)
**Vocab schema:** 1.0.0 · created 2026-05-16 · next review 2026-08-15
**Audit doc:** `docs/vocab-audit.md`

## TL;DR

- **45** SKOS concepts across **6** categories (43 active, 2 stub).
- **43** raw slugs registered in `slug_index`.
- **8** distinct source brains referenced (live + planned).
- **7** packs in the runtime registry.

## Regenerate

```
bun refinery/tools/semantic-ledger.mts
```

## Categories

| Category | Concepts | Active | Stub |
| --- | ---: | ---: | ---: |
| `credit-risk` | 17 | 16 | 1 |
| `environmental` | 8 | 7 | 1 |
| `hospitality` | 5 | 5 | 0 |
| `macro` | 4 | 4 | 0 |
| `qualitative` | 5 | 5 | 0 |
| `real-estate` | 6 | 6 | 0 |

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

### `environmental` (8)

| Concept ID | prefLabel | Raw slugs | Type | Unit | Range / Allowed | Source brains | Domains | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `env_collier_sfha_coverage_pct` | Collier County Area-Weighted SFHA Coverage | `collier_county_sfha_pct_area_weighted` | ratio | ratio (0–1) | 0 – 1 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_collier_ve_zone_coverage_pct` | Collier County Area-Weighted Coastal V/VE Coverage | `collier_county_ve_zone_pct_area_weighted` | ratio | ratio (0–1) | 0 – 1 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_flood_risk_pct` | Flood Risk Percentage | `flood_risk_pct` | percentage | % | 0 – 100 | _none_ | `environmental`, `real-estate` | ⚠️ stub |
| `env_lee_sfha_coverage_pct` | Lee County Area-Weighted SFHA Coverage | `lee_county_sfha_pct_area_weighted` | ratio | ratio (0–1) | 0 – 1 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_lee_ve_zone_coverage_pct` | Lee County Area-Weighted Coastal V/VE Coverage | `lee_county_ve_zone_pct_area_weighted` | ratio | ratio (0–1) | 0 – 1 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_swfl_sfha_coverage_pct` | SWFL Area-Weighted SFHA Coverage | `swfl_sfha_pct_area_weighted` | ratio | ratio (0–1) | 0 – 1 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_swfl_ve_zone_coverage_pct` | SWFL Area-Weighted Coastal V/VE Coverage | `swfl_ve_zone_pct_area_weighted` | ratio | ratio (0–1) | 0 – 1 | `env-swfl` | `environmental`, `real-estate` | ✅ active |
| `env_swfl_ve_zone_polygon_count` | SWFL Coastal V/VE Polygon Count | `swfl_ve_zone_polygon_count` | integer | polygons | _unbounded_ | `env-swfl` | `environmental`, `real-estate` | ✅ active |

<details><summary>Scope notes</summary>

- **`env_collier_sfha_coverage_pct`** — Collier County (FIPS 12021) area-weighted SFHA coverage — the Naples / Marco Island / Everglades-fringe footprint. Pair with env_collier_ve_zone_coverage_pct for coastal-vs-inland structural read.
- **`env_collier_ve_zone_coverage_pct`** — Collier County (FIPS 12021) area-weighted V/VE coastal high-hazard coverage. Flood-veto-eligible subset for Collier — keyed by the same barrier-island logic as Lee but with Naples/Marco Island as the operator-visible context.
- **`env_flood_risk_pct`** — Pre-registered for the flood-veto override rule in refinery/constitution/real-estate.mts (priority 90). NOT emitted by env-swfl directly — env-swfl emits scope-specific concepts (env_swfl_sfha_coverage_pct, env_lee_sfha_coverage_pct, env_collier_sfha_coverage_pct). Constitution should be updated in a follow-up to point the flood-veto trigger at the V/VE coverage concepts; this stub remains as the legacy hook.
- **`env_lee_sfha_coverage_pct`** — Lee County (FIPS 12071) area-weighted SFHA coverage — the Fort Myers / Fort Myers Beach / Sanibel / Captiva footprint. The §6.4 FMB lease question keys on this and env_lee_ve_zone_coverage_pct.
- **`env_lee_ve_zone_coverage_pct`** — Lee County (FIPS 12071) area-weighted V/VE coastal high-hazard coverage. This is the flood-veto-eligible subset for Lee. Above-baseline values are the primary signal that barrier-island coordinates in Lee should be paired with property-level lookups before any lease/acquisition decision.
- **`env_swfl_sfha_coverage_pct`** — Area-weighted share of mapped SWFL footprint (6 counties) classified as a FEMA Special Flood Hazard Area per 44 CFR §59.1. Computed in env-swfl via sum(Shape__Area) over SFHA-classified zones ÷ sum(Shape__Area) over all returned zones. Areas are square decimal degrees (WGS84); only the RATIO is meaningful — absolute areas never propagate.
- **`env_swfl_ve_zone_coverage_pct`** — Area-weighted share of mapped SWFL footprint classified as FEMA coastal high-hazard (V, VE, V1–V30, V99). This is the barrier-island / flood-veto-eligible subset of SFHA; pair with env_swfl_sfha_coverage_pct for full structural-flood context.
- **`env_swfl_ve_zone_polygon_count`** — Count of distinct FEMA V/VE-classified polygons across the SWFL 6-county footprint. A polygon count, not an area; structural read on coastal-high-hazard fragmentation. Pair with env_swfl_ve_zone_coverage_pct for relative scale.

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

### `macro` (4)

| Concept ID | prefLabel | Raw slugs | Type | Unit | Range / Allowed | Source brains | Domains | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `macro_cpi_yoy` | US CPI Year-over-Year | `cpi_yoy` | percentage | % | -5 – 25 | `macro-swfl` | `macro` | ✅ active |
| `macro_fl_labor_participation` | Florida Labor Force Participation Rate | `fl_labor_participation` | percentage | % | 40 – 80 | `macro-swfl` | `macro`, `demographics` | ✅ active |
| `macro_fl_unemployment` | Florida Unemployment Rate | `fl_unemployment` | percentage | % | 0 – 25 | `macro-swfl`, `master` | `macro`, `demographics` | ✅ active |
| `macro_sofr_rate` | SOFR (Secured Overnight Financing Rate) | `sofr_rate` | percentage | % | 0 – 20 | `macro-swfl`, `master` | `macro`, `finance` | ✅ active |

<details><summary>Scope notes</summary>

- **`macro_cpi_yoy`** — Fed's 2% target is the reference anchor. Shelter remains the sticky component through 2026.
- **`macro_fl_labor_participation`** — Climbs against retirement-state demographic gravity. A positive signal on Florida's working-age engagement.
- **`macro_fl_unemployment`** — Primary labor-tightness read for SWFL operators. Tourism and construction absorb new entrants when this stays low.
- **`macro_sofr_rate`** — Floor for floating-rate CRE debt. Rising SOFR triggers rising-rates-dominance override in refinery/constitution/finance.mts when magnitude > 0.6.

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

### `real-estate` (6)

| Concept ID | prefLabel | Raw slugs | Type | Unit | Range / Allowed | Source brains | Domains | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cre_cap_rate` | Cap Rate (per corridor) | `cap_rate` | percentage | % | 0 – 20 | `cre-swfl` | `real-estate` | ✅ active |
| `cre_cap_rate_median` | Median Cap Rate (corpus) | `cap_rate_median` | percentage | % | 0 – 20 | `cre-swfl`, `master` | `real-estate` | ✅ active |
| `cre_corridor_evolution` | Corridor Evolution Stage | `evolution` | enum | — | `growing` / `stable` / `repositioning` / `declining` | `cre-swfl` | `real-estate` | ✅ active |
| `cre_seasonal_index` | Seasonal Index | `seasonal_index` | index | 0–1 scale | 0 – 1 | `cre-swfl` | `real-estate` | ✅ active |
| `cre_vacancy_rate` | Vacancy Rate (per corridor) | `vacancy_rate` | percentage | % | 0 – 100 | `cre-swfl` | `real-estate` | ✅ active |
| `cre_vacancy_rate_median` | Median Vacancy Rate (corpus) | `vacancy_rate_median` | percentage | % | 0 – 100 | `cre-swfl`, `master` | `real-estate` | ✅ active |

<details><summary>Scope notes</summary>

- **`cre_cap_rate`** — Point-in-time corridor-level cap rate. Trajectory (falling/stable/rising) signals landlord vs tenant market direction.
- **`cre_cap_rate_median`** — Median across all corridors with reported metrics in the current period. A falling median is the primary bullish signal in the cre-swfl pack.
- **`cre_corridor_evolution`** — Qualitative lifecycle stage of a corridor. Ordered by operator-friendliness descending; see cre_corridor_evolution_stages in ordered_collections.
- **`cre_seasonal_index`** — 0 = no seasonality, 1 = extreme seasonality. Corridor-level only; not aggregated to corpus median.

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
| `macro-swfl` | `finance` | _leaf_ | — |
| `master` | `real-estate` | `franchise-outcomes` (**input**), `cre-swfl` (**input**), `macro-swfl` (**input**), `sector-credit-swfl` (**input**), `tourism-tdt` (**input**), `env-swfl` (**veto**) | 1× veto |
| `sector-credit-swfl` | `finance` | `franchise-outcomes` (**input**), `macro-swfl` (**input**) | all input |
| `tourism-tdt` | `hospitality` | _leaf_ | — |

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

### `env-swfl` (7 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `env_collier_sfha_coverage_pct` | Collier County Area-Weighted SFHA Coverage | `collier_county_sfha_pct_area_weighted` | active |
| `env_collier_ve_zone_coverage_pct` | Collier County Area-Weighted Coastal V/VE Coverage | `collier_county_ve_zone_pct_area_weighted` | active |
| `env_lee_sfha_coverage_pct` | Lee County Area-Weighted SFHA Coverage | `lee_county_sfha_pct_area_weighted` | active |
| `env_lee_ve_zone_coverage_pct` | Lee County Area-Weighted Coastal V/VE Coverage | `lee_county_ve_zone_pct_area_weighted` | active |
| `env_swfl_sfha_coverage_pct` | SWFL Area-Weighted SFHA Coverage | `swfl_sfha_pct_area_weighted` | active |
| `env_swfl_ve_zone_coverage_pct` | SWFL Area-Weighted Coastal V/VE Coverage | `swfl_ve_zone_pct_area_weighted` | active |
| `env_swfl_ve_zone_polygon_count` | SWFL Coastal V/VE Polygon Count | `swfl_ve_zone_polygon_count` | active |

### `franchise-outcomes` (1 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `sba_overall_survival_rate` | SBA Franchise Survival Rate (Corpus) | `overall_survival_rate` | active |

### `macro-swfl` (4 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `macro_cpi_yoy` | US CPI Year-over-Year | `cpi_yoy` | active |
| `macro_fl_labor_participation` | Florida Labor Force Participation Rate | `fl_labor_participation` | active |
| `macro_fl_unemployment` | Florida Unemployment Rate | `fl_unemployment` | active |
| `macro_sofr_rate` | SOFR (Secured Overnight Financing Rate) | `sofr_rate` | active |

### `master` (12 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `cre_cap_rate_median` | Median Cap Rate (corpus) | `cap_rate_median` | active |
| `cre_vacancy_rate_median` | Median Vacancy Rate (corpus) | `vacancy_rate_median` | active |
| `hosp_tdt_latest_monthly_collections` | Latest Monthly TDT Collections (Lee County) | `latest_monthly_collections_usd` | active |
| `hosp_tdt_post_ian_recovery_ratio` | Post-Hurricane-Ian Recovery Ratio | `post_ian_recovery_ratio` | active |
| `hosp_tdt_seasonal_position` | TDT Seasonal Position vs Historical Mean | `seasonal_position_vs_history` | active |
| `hosp_tdt_trailing_12mo_collections` | Trailing 12-Month TDT Collections (Lee County) | `trailing_12mo_collections_usd` | active |
| `hosp_tdt_yoy_delta` | TDT Year-over-Year Delta | `yoy_delta_pct` | active |
| `macro_fl_unemployment` | Florida Unemployment Rate | `fl_unemployment` | active |
| `macro_sofr_rate` | SOFR (Secured Overnight Financing Rate) | `sofr_rate` | active |
| `sba_best_sector_survival` | Best-Sector SBA Survival Rate | `best_naics_survival` | active |
| `sba_overall_survival_rate` | SBA Franchise Survival Rate (Corpus) | `overall_survival_rate` | active |
| `sba_worst_sector_chargeoff` | Worst-Sector SBA Charge-off Rate | `worst_naics_chargeoff` | active |

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

### `tourism-tdt` (5 concepts)

| Concept | prefLabel | Raw slugs | Status |
| --- | --- | --- | --- |
| `hosp_tdt_latest_monthly_collections` | Latest Monthly TDT Collections (Lee County) | `latest_monthly_collections_usd` | active |
| `hosp_tdt_post_ian_recovery_ratio` | Post-Hurricane-Ian Recovery Ratio | `post_ian_recovery_ratio` | active |
| `hosp_tdt_seasonal_position` | TDT Seasonal Position vs Historical Mean | `seasonal_position_vs_history` | active |
| `hosp_tdt_trailing_12mo_collections` | Trailing 12-Month TDT Collections (Lee County) | `trailing_12mo_collections_usd` | active |
| `hosp_tdt_yoy_delta` | TDT Year-over-Year Delta | `yoy_delta_pct` | active |

_Concepts with `source_brains: ["all"]` (qualitative brain-output fields like `qual_confidence`, `qual_trust_tier`, `qual_sentiment_direction`) are emitted by every brain and intentionally omitted from this table._

## Constitution overrides (cascade)

Higher priority wins. Effect `force_signal_direction` tracks the originating signal's direction; `force_bearish` / `force_bullish` pin the read; `add_caveat` only appends a caveat. SKOS-aware rules (e.g. `flood-veto`) declare trigger concepts by SKOS ID and resolve to raw slugs at module-init via `refinery/vocab/loader.mts`.

| Priority | Override ID | Effect | Domains |
| ---: | --- | --- | --- |
| 100 | `exogenous-critical-confirmed` | `force_signal_direction` | `real-estate` |
| 90 | `flood-veto` | `force_bearish` | `real-estate` |
| 80 | `naics-distress-veto` | `force_bearish` | `real-estate` |
| 70 | `rising-rates-dominance` | `force_bearish` | `finance` |

_Source: `refinery/constitution/{real-estate,finance}.mts` — see those files for the predicate code and threshold values._

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
| `env_flood_risk_pct` | stub | Pre-registered for the flood-veto override rule in refinery/constitution/real-estate.mts (priority 90). NOT emitted by env-swfl directly — env-swfl emits scope-specific concepts (env_swfl_sfha_covera… |
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
