import type { BrainDomain } from "../types/pack.mts";

/**
 * Leaf-only catalog for the MCP server (Brain Factory Decision E, leaf).
 *
 * Zero runtime imports of pack modules — only the `BrainDomain` type. The
 * full `PER_PACK_REGISTRY` in `./index.mts` pulls a heavy transitive graph
 * (DuckDB, dlt, source connectors) that we don't want anywhere near the MCP
 * Vercel function. This file is the single source of truth for the MCP
 * capability inventory.
 *
 * Drift against `PER_PACK_REGISTRY` is caught by `./catalog.test.mts`,
 * which runs in CI on every PR (`.github/workflows/ci.yml`). Until
 * `refinery/scaffold.mts` learns to append here (Step 2 of the MCP v1 plan),
 * new packs require a hand-edit to this array.
 */

export interface BrainCatalogEntry {
  id: string;
  domain: BrainDomain;
  scope: string;
  ttl_seconds: number;
}

export const BRAIN_CATALOG: ReadonlyArray<BrainCatalogEntry> = [
  {
    id: "rentals-swfl",
    domain: "real-estate",
    scope:
      "SWFL ZIP-level residential rent index (Zillow ZORI), monthly — regional median direction, heating/cooling ZIPs, and per-ZIP YoY/MoM.",
    ttl_seconds: 86400 * 35,
  },
  {
    id: "permits-swfl",
    domain: "real-estate",
    scope:
      "SWFL building-permit issuance flow (Lee + Collier) - corridor-level z-scores, saturation index, per-county splits, and trend reads against a trailing 13-window (28d each) historical baseline.",
    ttl_seconds: 604800,
  },
  {
    id: "housing-swfl",
    domain: "real-estate",
    scope:
      "SWFL ZIP-level residential buy-side housing market (Redfin), monthly — median sale price, days on market, inventory, sale-to-list ratio, and market heat direction.",
    ttl_seconds: 86400 * 35,
  },
  {
    id: "active-listings-swfl",
    domain: "real-estate",
    scope:
      "Southwest Florida active residential listing inventory — count, median asking price, and average days on market at region, county, and ZIP grain. Source: realtor.com for-sale listings via RentCast + SteadyAPI; a licensed feed can swap in later. List-side only (no closed sales).",
    ttl_seconds: 2 * 24 * 60 * 60,
  },
  {
    // Scope DUPLICATED VERBATIM from priceDistributionSwfl.scope in price-distribution-swfl.mts.
    // Gate 5 (catalog.test.mts) checks catalog ⇆ PER_PACK_REGISTRY parity — edit both strings together.
    id: "price-distribution-swfl",
    domain: "real-estate",
    scope:
      "Southwest Florida active for-sale listing distribution by $50k price band, per county (Lee + Collier) — " +
      "the affordability shape of the market: share of inventory under $300k, $300k–$600k, $600k–$1M, and $1M+. " +
      "Source: realtor.com price-histogram aggregate (one call per county, binned at source). List-side only " +
      "(no closed sales); all math deterministic, no LLM synthesis.",
    ttl_seconds: 8 * 24 * 60 * 60,
  },
  {
    // Scope DUPLICATED VERBATIM from listingMomentumSwfl.scope in listing-momentum-swfl.mts.
    // Gate 5 (catalog.test.mts) checks catalog ⇆ PER_PACK_REGISTRY parity — edit both strings together.
    id: "listing-momentum-swfl",
    domain: "real-estate",
    scope:
      "Southwest Florida weekly for-sale listing momentum (Lee + Collier) — the leading list-side signals from " +
      "our own active-inventory sweep: share of active listings carrying a price cut, and share newly listed, at " +
      "region, county, and ZIP grain. Point-in-time shares off the realtor.com for-sale feed's own flags; no " +
      "closed sales. Direction neutral on any one week; the week-over-week drift reads the trend. Deterministic, no LLM.",
    ttl_seconds: 8 * 24 * 60 * 60,
  },
  {
    // Scope DUPLICATED VERBATIM from marketTemperatureSwfl.scope in market-temperature-swfl.mts.
    // Gate 5 (catalog.test.mts) checks catalog ⇆ PER_PACK_REGISTRY parity — edit both strings together.
    id: "market-temperature-swfl",
    domain: "real-estate",
    scope:
      "Southwest Florida per-ZIP market snapshot (Lee + Collier) from realtor.com's monthly ZIP aggregates. " +
      "Headline is the sold-to-rent gross-yield read (median home price ÷ annual rent) — the one field no free " +
      "source publishes. The full per-ZIP snapshot (median sold, list, rent, days-on-market, price/sqft, hotness, " +
      "list-to-sold, market strength) rides as cited context. Monthly cadence; deterministic, no LLM synthesis.",
    ttl_seconds: 35 * 24 * 60 * 60,
  },
  {
    id: "hurricane-tracks-fl",
    domain: "environmental",
    scope:
      "NOAA HURDAT2 best-track joined against OpenFEMA NFIP claims for the SWFL 6-county footprint (LEE+COLLIER+CHARLOTTE+GLADES+HENDRY+SARASOTA). Cross-tier brain: HURDAT2 Parquet in Tier 1 Storage + NFIP claims in Tier 2 Postgres, pre-joined in DuckDB SQL (NOT TypeScript memory). Surfaces landfall counts, Cat-3+ near-passes, per-storm NFIP exposure, most-recent landfall, and closest-pass distance. Pairs with storm-history-swfl (NOAA Storm Events catalog — different upstream, different framing).",
    ttl_seconds: 31536000,
  },
  {
    id: "properties-lee-value",
    domain: "real-estate",
    // Drift fix (2026-06-13): synced to the pack scope after the redfin-lee build
    // added the market-grain (Redfin) source to properties-lee-value.mts but left
    // this catalog entry on the old single-source text (catalog.test.mts was red).
    scope:
      "Lee County (FL) real-estate direction read — LeePA parcel-grain: sales-velocity z-score (current year vs trailing 3yr) + Save-Our-Homes gap median. Redfin county tracker (market-grain): homes-sold z-score + median sale price YoY + months of supply from data_lake.redfin_lee_market. Two sources, two grains; county-grain peer to properties-collier-value.",
    ttl_seconds: 2592000,
  },
  {
    id: "properties-collier-value",
    domain: "real-estate",
    scope:
      "Collier County (FL) real-estate read — homes-sold velocity z-score (current year vs trailing 3yr) + median sale price YoY + months of supply from the Redfin Data Center county tracker, plus parcel count + Save-Our-Homes gap median from the FDOR Statewide Cadastral (parcel-grain, CO_NO=21). County-grain peer to properties-lee-value.",
    ttl_seconds: 2592000,
  },
  {
    id: "traffic-swfl",
    domain: "logistics",
    scope:
      "FDOT AADT corridor traffic for SWFL (Lee + Collier) — latest-year length-weighted average, cohort-matched YoY, 5-year CAGR, median truck factor, plus a 3-county post-Ian recovery index.",
    ttl_seconds: 2592000,
  },
  {
    id: "cre-swfl",
    domain: "real-estate",
    scope:
      "SWFL commercial real estate corridors — verified corridor intelligence (profiles, character, active flags)",
    ttl_seconds: 604800,
  },
  {
    id: "env-swfl",
    domain: "environmental",
    scope:
      "Southwest Florida flood-hazard exposure (modeled NFHL polygons), realized loss (NFIP paid claims), observed Caloosahatchee surface stage (USGS daily value, parameterCd 00065), and annual rainfall (NOAA GHCN-Daily, Lee+Collier station average) across the 6 SWFL counties (Lee, Collier, Charlotte, Glades, Hendry, Sarasota). Modeled side = area-weighted FEMA NFHL aggregates with coastal V/VE breakouts for barrier-island / flood-barrier-mode-1 consumers. Realized side = storm-vs-baseline aggregates of historical NFIP paid claims with hardcoded SWFL hurricane list. Observed side = USGS surface-stage metric for HUC 03090205 (Caloosahatchee) + GHCN-Daily annual rainfall average across 4 Lee+Collier anchor stations.",
    ttl_seconds: 2592000,
  },
  {
    id: "tourism-tdt",
    domain: "hospitality",
    scope:
      "SWFL (Lee + Collier) hospitality pulse — monthly Tourist Development Tax collections from the Florida Department of Revenue Form 3, with seasonal, year-over-year, and post-Hurricane-Ian recovery context for accommodation / food-service operators.",
    ttl_seconds: 604800,
  },
  {
    id: "sector-credit-swfl",
    domain: "finance",
    scope:
      "SBA 7(a)/504 sector credit risk — resolved-loan charge-off rates by 2-digit NAICS sector across Lee & Collier counties, FL, paired with named-brand outcomes and current macro funding backdrop.",
    ttl_seconds: 604800,
  },
  {
    id: "macro-us",
    domain: "macro",
    scope:
      "National macro context — SOFR funding rate and US CPI YoY. Root of the three-tier macro denominator chain (macro-us → macro-florida → macro-swfl).",
    ttl_seconds: 2592000,
  },
  {
    id: "macro-florida",
    domain: "macro",
    scope:
      "Florida state-level macro context — labor market (FLUR, FL LFPR) and business sector counts (Census CBP). Mid-tier of the three-tier macro denominator chain (macro-us → macro-florida → macro-swfl). Future branches: IRS SOI.",
    ttl_seconds: 2592000,
  },
  {
    id: "macro-swfl",
    domain: "macro",
    scope:
      "Regional macro context for Southwest Florida — leaf tier of the three-tier macro chain (macro-us → macro-florida → macro-swfl). Own sources: BLS LAUS monthly unemployment for Lee + Collier counties; BLS QCEW quarterly private-sector wages + employment for Lee + Collier. Upstream: macro-florida for FL state baseline and confidence propagation.",
    ttl_seconds: 2592000,
  },
  {
    id: "logistics-swfl",
    domain: "logistics",
    scope:
      "Inbound domestic freight flows landing in the SWFL FAF zone (129, Remainder of Florida) for the latest historical FAF5 year — origin zones, commodity classes, total tonnage + value.",
    ttl_seconds: 2592000,
  },
  {
    id: "logistics-swfl-nowcast",
    domain: "logistics",
    scope:
      "Current-state freight-activity nowcast for SWFL — derives a daily activity proxy from FDOT AADT × tfctr × payload, compares against the brain's OWN rolling history (Path B), and classifies shock_state + baseline_validity_flag. FAF5 inbound-flow is preserved as audited CONTEXT.",
    ttl_seconds: 2592000,
  },
  {
    id: "storm-history-swfl",
    domain: "environmental",
    scope:
      "NOAA Storm Events history for Southwest Florida (LEE + COLLIER + CHARLOTTE), 1996-2025 modern-schema vintage. Surfaces SWFL-wide event counts (total / major / 10yr property-damage / 10yr distinct tropical cyclones) and the most recent billion-dollar event for risk-history framing. Pairs with env-swfl (modeled NFHL exposure) — exposure says WHERE flood risk lives, storm-history says WHAT has hit historically.",
    ttl_seconds: 31536000,
  },
  {
    id: "master",
    domain: "real-estate",
    scope:
      "SWFL Intelligence Lake — master synthesizer over the verified Franchise Outcomes, CRE Corridors, Macro SWFL, and Sector-Credit SWFL upstream brains (Lee & Collier counties, FL).",
    ttl_seconds: 604800,
  },
  {
    id: "fgcu-reri",
    domain: "macro",
    scope: "Southwest Florida — FGCU RERI monthly regional economic indicators",
    ttl_seconds: 86400 * 30,
  },
  {
    id: "safety-swfl",
    domain: "real-estate",
    scope:
      "SWFL (Lee + Collier) property crime rate from FBI Crime Data Explorer NIBRS — " +
      "property offenses (burglary, larceny-theft, motor vehicle theft) per 1,000 residents, " +
      "coverage-matched to reporting agencies. Annual grain, quarterly ingest cadence; " +
      "data lags ~6–9 months.",
    ttl_seconds: 7_776_000,
  },
  {
    id: "econ-dev-swfl",
    domain: "macro",
    scope:
      "Southwest Florida economic development project announcements — weekly scrape of SWFL Inc. (Lee County EDO) news feed. Tracks project count, disclosed investment, and announced job creation for Lee + Collier + Charlotte counties.",
    ttl_seconds: 604800,
  },
  {
    id: "rsw-airport",
    domain: "hospitality",
    scope:
      "Southwest Florida airport throughput — RSW (Southwest Florida International, Fort Myers / Cape Coral) monthly total passengers, arrivals (deplanements), departures (enplanements), aircraft operations, and air freight from the Lee County Port Authority. Direction tracks the trailing-12-month total-passengers YoY.",
    ttl_seconds: 86400 * 30,
  },
  {
    id: "city-pulse-swfl",
    domain: "macro",
    scope:
      "SWFL (Lee + Collier) daily current-events pulse — dated business openings/closings, transactions, construction, and disaster signals for 7 cities, each cited to a primary source.",
    ttl_seconds: 86400,
  },
  {
    id: "corridor-pulse-swfl",
    domain: "real-estate",
    scope:
      "SWFL (Lee + Collier) weekly corridor current-events pulse — dated commercial-real-estate transactions, construction, leasing, and openings/closings on the CRE corridors, each cited to a primary source.",
    ttl_seconds: 604800,
  },
  {
    id: "labor-demand-swfl",
    domain: "macro",
    scope:
      "Southwest Florida workforce composition and wage benchmarks — BLS OEWS major occupation groups for Cape Coral-Fort Myers MSA (Lee Co.) and Naples-Marco Island MSA (Collier Co.). Annual May survey data.",
    ttl_seconds: 90 * 24 * 60 * 60,
  },
  {
    id: "news-swfl",
    domain: "macro",
    scope:
      "FL DBPR enforcement pulse for SWFL — weekly scrape of press releases (announced sweeps) and public notices (confirmed individual actions). Tracks regulatory enforcement across construction, ABT/hospitality, and real estate for Lee, Collier, Charlotte, Sarasota, and Hendry counties.",
    ttl_seconds: 604800,
  },
  {
    id: "licenses-swfl",
    domain: "real-estate",
    scope:
      "SWFL contractor licensing health — FL DBPR Construction Board (06) + Electrical Board (08) license counts, lapse rate, and applicant pipeline for Lee + Collier counties.",
    ttl_seconds: 30 * 24 * 60 * 60,
  },
  {
    id: "condo-sirs-swfl",
    domain: "regulatory",
    scope:
      "SWFL condominium and cooperative associations that have confirmed Structural Integrity Reserve Study (SIRS) submission to DBPR. Lee + Collier counties. Source: DBPR SIRS Reporting Database (two Qlik apps: pre-July 2025 and July 2025+ submissions). Monthly scrape. Positive signal only — presence = confirmed filing; absence has no meaning without a baseline registry of all SWFL 3-story+ condominiums.",
    ttl_seconds: 30 * 24 * 60 * 60,
  },
  {
    id: "permits-commercial-swfl",
    domain: "real-estate",
    scope:
      "SWFL commercial building permits — annual issued-permit dataset from the Maxwell, Hendry & Simmons Data Book (calendar year 2025), aggregated by submarket and site ZIP into permit count, declared value, and building square footage for commercial-real-estate operators.",
    ttl_seconds: 31536000,
  },
  {
    id: "seller-stress-swfl",
    domain: "real-estate",
    scope:
      "SWFL seller stress composite score (0-100) per ZIP vs the 2019–2021 pre-shock baseline, derived from three Redfin Data Center Tier-1 Parquets: price_drops, contract_cancellations, and delistings_relistings. Signals: delistings rate (leading), price drop breadth (coincident), cancellation rate (lagging), avg drop depth (lagging), relisting rate (coincident). Covers 126 SWFL ZIPs, Apr 2019–present, monthly rolling-3-month periods. All math deterministic; no LLM synthesis.",
    ttl_seconds: 30 * 24 * 60 * 60,
  },
  {
    // Scope DUPLICATED VERBATIM from marketHeatSwfl.scope in market-heat-swfl.mts.
    // Gate 5 (catalog.test.mts) checks catalog ⇆ PER_PACK_REGISTRY parity on
    // id/domain/scope/ttl — edit both strings together.
    id: "market-heat-swfl",
    domain: "real-estate",
    scope:
      "SWFL market-heat directional call per ZIP from realtor.com's free public-S3 market aggregates (Core Inventory + Market Hotness, monthly, ZIP grain). The vote is driven by absolute year-over-year time-series — active-listing count (falling = bullish), median days-on-market (falling = bullish), and pending ratio (rising = bullish) — so market tightening reads bullish. Market Hotness is used as a RELATIVE cross-sectional descriptor only, never the vote driver. List-side only: no closed/sold prices. All math deterministic; no LLM synthesis.",
    ttl_seconds: 35 * 24 * 60 * 60,
  },
  {
    // Scope DUPLICATED VERBATIM from franchiseOutcomes.scope in franchise-outcomes.mts.
    // Gate 5 (catalog.test.mts) checks catalog ⇆ PER_PACK_REGISTRY parity on
    // id/domain/scope/ttl — edit both strings together.
    id: "franchise-outcomes",
    domain: "finance",
    scope:
      "SBA 7(a) FOIA named-brand franchise loan outcomes — Lee & Collier counties, FL. " +
      "Per-brand survival rates over resolved loans; corpus-level direction signal for the SWFL franchise credit environment.",
    ttl_seconds: 7776000,
  },
  {
    // Scope DUPLICATED VERBATIM from FRESHNESS_PULSE_SCOPE in freshness-pulse.mts.
    // Gate 5 (catalog.test.mts) checks catalog ⇆ PER_PACK_REGISTRY parity on
    // id/domain/scope/ttl — edit both strings together.
    id: "freshness-pulse",
    domain: "real-estate",
    scope:
      "SWFL daily sourced freshness snapshot — today's cited median sale price (Cape Coral / Fort Myers / Naples) and 30-year fixed mortgage rate, each provenance-gated to a real source URL, with ZIP-grain Baseline-Delta projections ([INFERENCE]).",
    ttl_seconds: 86400,
  },
];
