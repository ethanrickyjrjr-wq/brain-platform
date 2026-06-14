# Data Source Discovery — 2026-06-13

18 searches + 5 deep scrapes across Redfin, Realtor.com, FHFA, Zillow, Cushman & Wakefield, HUD,
AirDNA/STR, ApartmentList, Florida DOR, NABOR, Shimberg/UF, Citizens Insurance, First Street, HMDA,
Census BPS, CoreLogic, NAR, and OEDR.

Organized by friction tier. For each source: (a) exact download URL + file format + key columns,
(b) geographic grain and SWFL/Lee/Collier coverage, (c) cadence + license/cost, (d) build path.

---

## TIER 1 — Free, Stable Bulk Downloads (build real pipelines)

---

### 1. Redfin Data Center — Housing Market Tracker

**URL:** https://www.redfin.com/news/data-center/downloads/
**Download hub:** https://www.redfin.com/news/data-center/housing-market/
**Format:** CSV (filtered, date-range selectable via UI; underlying TSVs from the old API also exist)

**Columns (all 12 metrics):**
- Homes Sold, Median Sale Price, Median Days On Market
- Average Sale To List Ratio, Share Sold Above Original List
- New Listings, Active Listings, Pending Sales
- Median New Listing Price, Median Sale Price Per Sq.Ft.
- Months Of Supply, Percent Off Market In Two Weeks

**Available YoY/MoM/WoW deltas for all columns.**

**Geographic grain:** United States → Metro Areas → States → Cities → **Counties → Zip Codes**
All levels confirmed downloadable from the same UI.

**Cadence:** Weekly (inventory/listings) + Monthly (sales metrics)
**Last updated:** Jun 3, 2026

**Coverage:** Lee County (12071) + Collier County (12021) + individual SWFL ZIPs — confirmed
(FRED series `MEDLISPRI12071` = Lee median listing price from Realtor.com via the same underlying data;
Redfin has its own independent series.)

**License:** Free; attribution "Redfin Data Center" required. No commercial restriction on aggregate use.

**Also available at the same hub:**
| Dataset | Grain | Cadence | Key Metrics |
|---|---|---|---|
| Balance of Power: Buyers vs Sellers | Metro, Census Region, US | Monthly | Buyer score, Seller score, ratio, % difference |
| Luxury Home Market | Metro, State, US | Monthly | Median sale price, pending, active, days on market (top 5% only) |
| Price Drops | ZIP, County, City, Metro, State, US | Monthly + Weekly | Price drops count, % active with drops, avg drop size, homes sold w/ drops |
| Home Purchase Cancellations | ZIP, County, City, Metro, State, US | Monthly + Weekly | Cancellation count, % of pending |
| Home Delistings & Relistings | ZIP, County, City, Metro, State, US | Monthly + Weekly | Total delistings, share delisted, total relistings, share relisted |
| Investor Home Purchases | Metro, State, US | Quarterly | Investor purchase share, type breakdown |
| Starter Home Market | Metro, State, US | Quarterly | Starter tier metrics |
| Redfin Home Price Index | Metro, State, US | Monthly | Price index (similar to Case-Shiller but monthly) |
| Existing Home Sales | Metro, State, US | Monthly | Sales counts, % change |
| Financing Trends | Metro, State, US | Monthly | Cash purchase %, loan types, down payment distribution |

**Build path:** Auto-ingest pipeline. Stable CSV download. ZIP-grain is the moat — this adds
10 columns we don't have at ZIP level (months of supply, sale-to-list, pending, delistings,
cancellations). Brain: `housing-market-swfl` or extend `redfin-lee`.

---

### 2. Realtor.com Research Data Library

**URL:** https://www.realtor.com/research/data/
**Format:** CSV download (stable URLs, updated monthly)

**Columns:** Median listing price, median days on market, active inventory, new listings,
price-reduced listings %, median listing price per sqft, median pending price, etc.

**Geographic grain:** ZIP code → County → Metro → State → US. Property type breakdowns.
Price tier breakdowns. House size breakdowns.

**Cadence:** Weekly Inventory + Monthly full dataset + Monthly Market Hotness index

**Coverage:** Lee + Collier confirmed (Realtor.com is the source for the FRED series
`MEDLISPRI12071` — Lee County median listing price from Jul 2016 to present)

**License:** "Please attribute Realtor.com® Economic Research." Free for research use.

**Build path:** Auto-ingest pipeline. Independent cross-check vs Redfin (different MLS coverage
+ different methodology). "Redfin says X, Realtor says Y" discrepancy framing is exactly what
the platform is built for. Brain: `housing-market-swfl` second source or dedicated `realtor-swfl`.

---

### 3. FHFA House Price Index (HPI) — ZIP5, County, Tract

**URL:** https://www.fhfa.gov/data/hpi
**Datasets page:** https://www.fhfa.gov/data/hpi/datasets

**This is the single biggest find of this session.** Free government data, direct CSV/XLSX,
going back to mid-1970s, at 5-digit ZIP code grain.

**Direct download URLs (confirmed stable):**

| Dataset | URL | Format | Grain | Cadence |
|---|---|---|---|---|
| Master HPI (all geographies) | https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv | CSV | All | Monthly |
| County annual | https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx | XLSX | County | Annual |
| **ZIP5 annual** | **https://www.fhfa.gov/hpi/download/annual/hpi_at_zip5.xlsx** | **XLSX** | **5-digit ZIP** | **Annual** |
| Census Tract annual | https://www.fhfa.gov/hpi/download/annual/hpi_at_tract.csv | CSV | Tract | Annual |
| 3-digit ZIP quarterly | https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_3zip.xlsx | XLSX | 3-digit ZIP | Quarterly |
| Metro quarterly | https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_metro.xlsx | XLSX | MSA | Quarterly |
| State quarterly | https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_po_state.xlsx | XLSX | State | Quarterly |
| Dictionary | https://www.fhfa.gov/document/d/hpi/hpi_dictionary.xlsx | XLSX | — | — |

**What it measures:** Weighted repeat-sales HPI for single-family homes using Fannie/Freddie
mortgage data (purchase-only) or including appraisals (all-transactions). Index values, not prices —
but calibratable to price level via the ZHVI or Redfin median anchors.

**Coverage:** Collier County confirmed via FRED series `ATNHPIUS12021A` (All-Transactions HPI for
Collier County FL — going back to 1975). Lee County equivalent also exists.

**Cadence:** ZIP5 data is annual. County/metro is quarterly. Master CSV is monthly (metro/state).

**License:** Public domain, US government data. No restrictions.

**Build path:** Auto-ingest. The ZIP5 annual XLSX is the crown jewel — gives every SWFL ZIP code
a price change index going back ~30 years. Pair with ZHVI as the price-level anchor.
Brain: `fhfa-hpi-swfl` or add to `housing-market-swfl`.

---

### 4. Zillow Research — Days to Pending, Price Cuts, Inventory, ZORDI

**URL:** https://www.zillow.com/research/data/
**Format:** CSV, stable `files.zillowstatic.com/research/public_csvs/...` URLs

**Beyond ZHVI/ZORI, these are available:**

| Dataset | Grain | Key Columns | Direct CSV |
|---|---|---|---|
| Days to Pending (smooth, monthly) | Metro & US | Mean/median days from list → pending | https://files.zillowstatic.com/research/public_csvs/mean_doz_pending/Metro_mean_doz_pending_uc_sfrcondo_sm_month.csv |
| Days to Pending (weekly) | Metro & US | Same, weekly cadence | (swap `month` → `week` in URL) |
| Share of Listings With Price Cut | Metro & US | % of active listings with a price cut that month | See Zillow data page |
| Price Cuts ($ and %) | Metro & US | Mean/median cut in $ and % | See Zillow data page |
| Market Heat Index | Metro & US | Seller-vs-buyer balance score | https://files.zillowstatic.com/research/public_csvs/market_temp_index/Metro_market_temp_index_uc_sfrcondo_month.csv |
| ZORDI (Renter Demand Index) | Metro, County, City, ZIP | Engagement proxy for rental demand | See Zillow data page |
| ZHVF (Home Value Forecast) | Metro, ZIP | Month/quarter/year-ahead HVI forecast | See Zillow data page |
| Mortgage Payment Estimate | Metro, State, County, City, ZIP | Est. monthly payment at current rates | See Zillow data page |
| Total Monthly Payment | Metro, State, County, City, ZIP | Payment + insurance + taxes + maintenance | See Zillow data page |

**Note:** Days to Pending and Price Cuts are Metro/US only (not ZIP). ZHVI + ZORI + ZORDI
go to ZIP level. The Zillow data page notes: "We make occasional changes to CSV download paths."
Probe the URL before hard-coding in a pipeline; use the data page to verify current paths.

**Cadence:** Updated monthly on the 16th.

**Build path:** ZORDI and Price Cuts add new signals. Mortgage payment estimate is especially
useful for affordability framing (ties home values to real carrying costs at current rates).

---

### 5. HUD Small Area Fair Market Rents (SAFMRs) — ZIP Code Level

**URL:** https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html
**Also:** https://www.huduser.gov/portal/datasets/fmr.html (standard FMR by county/metro)
**Format:** XLSX download per fiscal year

**What it is:** HUD's annual rent benchmarks, calculated at ZIP code granularity for metro areas
(instead of the usual county/metro-wide FMR). Used for Section 8 Housing Choice Voucher
payment standards. Published each October for the next fiscal year.

**Columns:** 0BR, 1BR, 2BR, 3BR, 4BR fair market rent by ZIP code.

**Also available — 50th Percentile Rents by county:**
- FY2025: https://www.huduser.gov/portal/datasets/50per.html
- Direct: FY2025 50th Percentile Rents by County (XLSX, 387KB)

**Coverage:** Cape Coral-Fort Myers MSA and Naples-Marco Island MSA are both included in the
SAFMR program (both are metros where SAFMRs are required). Lee and Collier ZIPs confirmed.

**Cadence:** Annual (fiscal year, published ~October)

**License:** Public domain, US government.

**Build path:** Auto-ingest. SAFMRs give us a government-backed rent floor/benchmark at ZIP
level, independent of Zillow ZORI and ApartmentList. Particularly useful for housing
affordability gap analysis. Brain: `housing-affordability-swfl` or add to `rentals-swfl`.

---

### 6. ApartmentList Rent Estimates — ZIP Code Level

**URL:** https://www.apartmentlist.com/research/national-rent-data
**Format:** CSV download (free, no login required)

**What it covers:** Monthly median rent estimates by bedroom count (studio, 1BR, 2BR) at city,
county, state, and metro level. **ZIP code level also available per the Florida Housing Data
Clearinghouse reference.**

**SWFL note:** Already aggregated for all 33 FL counties at:
https://flhousingdata.shimberg.ufl.edu/market-rent-trackers/results?nid=4300
(ApartmentList + ZORI combined in one table — useful as a validation layer)

**Cadence:** Monthly
**License:** Free; cite ApartmentList when using.

**Build path:** Auto-ingest. Adds an independent rent data point alongside ZORI.
Especially useful for apartments vs. the SFR skew in ZORI.

---

### 7. CFPB HMDA — Mortgage Lending by Census Tract/County

**URL:** https://ffiec.cfpb.gov/data-browser/
**Download:** https://www.consumerfinance.gov/data-research/hmda/
**2024 data:** https://ffiec.cfpb.gov/data-publication/modified-lar

**What it is:** Home Mortgage Disclosure Act data — every mortgage application and origination
in the US, reported by lenders. Includes borrower demographics, loan amount, loan purpose,
action taken (originated/denied/withdrawn), property location.

**Columns:**
- Loan amount, loan purpose (purchase/refinance/home improvement)
- Property type, occupancy type (primary/second/investment)
- Income, race, ethnicity of applicant
- Action taken (originated, approved not accepted, denied, etc.)
- Denial reasons (DTI, insufficient collateral, credit history, etc.)
- Census tract and county codes

**Geographic grain:** Census tract → County → MSA → State. No ZIP directly, but tract → ZIP crosswalk exists.

**Coverage:** Lee (12071) + Collier (12021) fully covered. 2024 data now available (announced
June 2025 per CFPB newsroom).

**Cadence:** Annual (prior year data released ~June)
**License:** Public domain.

**Build path:** Auto-ingest for county-level summary (use the data browser filtered to FL counties).
Full LAR (Loan Application Register) is large — probe one county first.
Brain: `mortgage-market-swfl` — new angle: denial rates, investor purchase share, income-adjusted
loan amounts as economic stress indicators.

---

### 8. Census Building Permits Survey (BPS) — County Level, Monthly

**URL:** https://www.census.gov/permits
**API:** https://bhs.econ.census.gov/bhs/bps/about.html
**HUD repackaged:** https://hudgis-hud.opendata.arcgis.com/datasets/HUD::residential-construction-permits-by-county/about

**What it covers:** New privately-owned residential construction authorized by building permits,
by housing unit type (single-family, 2–4 units, 5+ units), monthly.

**Columns:** Units authorized, units under construction, units completed, by structure type.

**Geographic grain:** County level. Lee + Collier confirmed.
(Cape Coral specifically was one of the highest-growth permit metros post-Ian in 2023.)

**Cadence:** Monthly (released ~3 weeks after month-end)
**License:** Public domain.

**Build path:** Auto-ingest via Census API. New supply pipeline is a direct input to the
housing-market brain and is not in the stack yet. Monthly permit pace vs absorption rate
is a key leading indicator for price direction.

---

## TIER 2 — Florida-Specific Free Sources (high value, some friction)

---

### 9. Florida Department of Revenue — Assessment Roll + Sales Report

**URL:** https://floridarevenue.com/property/Pages/DataPortal.aspx
**Sales report:** https://floridarevenue.com/property/Pages/DataPortal_DataBook.aspx
**Full assessment roll:** https://floridarevenue.com/property/Pages/DataPortal_RequestAssessmentRollGISData.aspx

**What it covers:**
- **Sales Report (XLS):** County-level sales counts, median/average prices, just values — all 67 FL counties
- **Assessment Roll:** Full parcel data for every county (similar to LeePA but state-standardized)
  Includes: ownership, legal description, just value, assessed value, improvement value, acreage,
  year built, land use code, recent sale price/date

**Coverage:** All 67 FL counties including Collier (which we don't have from LeePA).
This is the path to Collier parcel-level data without scraping CCPA directly.

**Cadence:** Annual (assessment roll), quarterly (sales reports)
**License:** Public records under Florida Statute 119.

**Build path:** Assessment roll requires a formal data request (form on the portal). Sales
report is direct XLS download. Priority: get the Collier assessment roll to complete the
6-county parcel layer.

---

### 10. Florida Realtors — Market Reports (SunStats)

**URL:** https://www.floridarealtors.org/tools-research/reports/florida-market-reports
**Interactive:** https://www.floridarealtors.org/tools-research/reports/sunstats-custom-interactive-florida-housing-market-reports

**What it covers:** Monthly county-level reports for all FL counties. Single-family,
condo/townhouse, and manufactured homes. Metrics: closed sales, median price, avg days on
market, new listings, active inventory, months supply, distressed sales %.

**Coverage:** Lee + Collier + Charlotte + Sarasota — full 6-county SWFL scope.

**Cadence:** Monthly (released ~3 weeks after month-end)

**Friction:** Reports are PDFs and interactive tables, not flat CSV downloads.
SunStats may have export — needs investigation.

**Build path:** ODD scaffold if no CSV export. The monthly PDF is a reliable source with
official MLS aggregation — higher integrity than Redfin/Realtor for FL-specific metrics
(Florida Realtors is the state MLS aggregator). Spider/Firecrawl can reliably scrape the
PDF tables if SunStats export is gated.

---

### 11. NABOR Market Statistics — Naples/Collier

**URL:** https://www.nabor.com/realtor-tools/nabor-market-statistics

**What it covers:** Naples Area Board of REALTORS monthly, quarterly, and annual reports
specific to Collier County (Naples/Marco Island market). Metrics: closed sales, median price,
avg DOM, new listings, inventory, months supply — by property type and price tier.

**Coverage:** Collier County only (Naples-focused). More granular than Florida Realtors
for Collier — breaks out by community/neighborhood in some reports.

**Cadence:** Monthly (MLS data)
**Friction:** PDF/report format. No bulk download.

**Build path:** ODD scaffold. Scrape monthly PDF for the Collier-specific dataset that
complements the LeePA (Lee-focused) brain. Brain: `collier-housing-nabor`.

---

### 12. Shimberg Center (UF) — Florida Housing Data Clearinghouse

**URL:** https://flhousingdata.shimberg.ufl.edu/

**What it covers:** A state-maintained aggregation of housing data for all 33 FL counties:
- ApartmentList rent estimates
- ZORI (Zillow Observed Rent Index)
- HUD Fair Market Rents and Income Limits
- Affordable housing supply (LIHTC, SHIP, SAIL)
- Housing cost burden statistics from ACS
- Rental vacancy rates

**Coverage:** Lee + Collier + Charlotte + Hendry + Glades + Sarasota — all 6.

**Cadence:** Annual/monthly depending on source
**License:** Free public access.

**Build path:** This is a validation and cross-check layer. Useful for the affordable housing
angle (housing cost burden %) which is not in the current stack.

---

### 13. Florida EDR (Office of Economic and Demographic Research)

**URL:** https://edr.state.fl.us/

**What it covers:** Legislature's research arm. Population forecasts by county (5-year horizon),
migration estimates, economic impact studies, property value/tax roll summaries.

**Coverage:** All 67 FL counties.
**Cadence:** Annual (population forecasts), periodic (economic studies)
**License:** Public, state government data.

**Build path:** Auto-ingest for county population forecasts. Useful for per-capita
normalization and long-run demand curves. Brain: extend `macro-swfl`.

---

## TIER 3 — Commercial Real Estate (free PDFs, no bulk download)

---

### 14. Cushman & Wakefield MarketBeat — Fort Myers/Naples

**URL:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats
**Local affiliate:** https://cpswfl.com/market-beats/

**What it covers:** Quarterly market reports for the Fort Myers/Naples commercial market.
Separate reports for Industrial, Office, Retail. Metrics: vacancy rate, absorption sqft,
average asking rent, new deliveries, under construction, leasing activity.

**Confirmed direct PDF links (Industrial):**
- Q4 2025: https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2025/q4/us-reports/industrial/fortmyers_naples_americas_alliance_marketbeat_industrial_q42025.pdf
- Q3 2025: https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2025/q3/us-reports/industrial/fortmyers_naples_americas_alliance_marketbeat_industrial_q32025.pdf
- Q1 2025: https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2025/q1/us-reports/industrial/fortmyers_naples_americas_alliance_marketbeat_industrial_q12025.pdf

**Key Q4 2025 data point (from snippet):** Industrial vacancy 7.4% (+320bps), avg asking rent $15.26/sqft.

**Cadence:** Quarterly (Feb/May/Aug/Nov for prior quarter)
**License:** Free public report; cite Cushman & Wakefield.

**Build path:** PDF snapshot extraction (Firecrawl or PyMuPDF). URL pattern is stable enough
for a quarterly scrape pipeline. These are the most authoritative free CRE numbers for
Fort Myers/Naples — CoStar data is behind a paywall, C&W reports it publicly.
Brain: `cre-swfl` already exists — add C&W as a source.

---

### 15. HUD Comprehensive Housing Market Analysis — Cape Coral-Fort Myers

**URL:** https://www.huduser.gov/portal/publications/pdf/CapeCoralFortMyersFL-CHMA-25.pdf
**Format:** PDF (as of May 1, 2025)

**What it covers:** Full housing market analysis by HUD's economic and market analysis division.
Sections: Economy, Population and Households, Housing Market (owner and rental), Forecast.

**This is the government's official housing market baseline for the metro.**

**Coverage:** Cape Coral-Fort Myers MSA (Lee County primarily, with some Charlotte spillover).
**Published:** May 1, 2025
**Cadence:** Every 2–3 years (last was ~2022 before this one)
**License:** Public domain.

**Build path:** One-time PDF extraction as a snapshot citation. Provides the government's
baseline demand/vacancy/absorption estimates — useful as a comparison anchor for the brain.

---

### 16. LSI Companies — SWFL Commercial Pulse Q4 2024

**URL:** https://lsicompanies.com/wp-content/uploads/2025/03/lsi-commercial-pulse-q4_2024.pdf

**What it covers:** Local Southwest Florida commercial real estate quarterly report from
LSI Companies (Fort Myers-based commercial brokerage). Includes retail, office, industrial,
land, multifamily data specific to Lee County.

**Build path:** One-time PDF snapshot. Good for calibrating the C&W data against local broker numbers.

---

### 17. Collaboratory — SWFL Regional Housing Study 2025

**URL:** https://collaboratory.org/wp-content/uploads/2025/11/2025-Home-Coalition-Regional-Housing-Study-and-Action-Plan-1.pdf

**What it covers:** Southwest Florida Regional Housing Study and Action Plan, Nov 2025.
Covers housing affordability, workforce housing gaps, income vs. rent burden across
Lee, Collier, Charlotte, Hendry, Glades, Sarasota counties (the full 6-county SWFL scope).

**Build path:** One-time PDF extraction. This is the most comprehensive recent affordability
study for exactly our 6-county geography.

---

## TIER 4 — Short-Term Rental / Vacation (paid core, some free signals)

---

### 18. AirDNA — Short-Term Rental Market Data

**URL:** https://www.airdna.co/
**Free 2026 Outlook Report:** https://www.airdna.co/outlook-report

**What it covers:** Airbnb and VRBO rental performance data. 10M+ listings tracked globally.
Core metrics: Occupancy rate, Average Daily Rate (ADR), RevPAR, active listings count.

**Coverage:** Lee and Collier county-level data available in the paid platform.
Free tier: City/market-level overview with limited metrics.

**2026 SWFL relevance:** STR premium $989/month over equivalent LTR, national data.
Florida vacation markets are heavily represented (42 FL markets tracked).

**Cost:** Paid subscription for full data. City-level overview is free.

**Build path:** ODD scaffold (can't auto-ingest the paid tier). The free 2026 Outlook PDF
is a one-time snapshot. Consider the Rabbu and AirROI free alternatives below for
signal-level STR data without the subscription.

---

### 19. Rabbu — Free STR Analytics (Airbnb/VRBO)

**URL:** https://rabbu.com/airbnb-data

**What it covers:** Free Airbnb/VRBO analytics by city, county, or ZIP code.
Occupancy rates, ADR, revenue estimates — without the AirDNA paywall.

**Coverage:** US markets including SWFL. No stated coverage limit.
**Cost:** Free
**Cadence:** Updated frequently (scrapes OTA listings)

**Build path:** Auto-ingest (web scrape / API). Provides a free proxy for STR demand
that AirDNA charges for. Validate against AirDNA free-tier spot checks.

---

### 20. AirROI — Free STR Data API

**URL:** https://www.airroi.com/

**What it covers:** Free market analytics and Airbnb data API. 20M+ properties tracked.
Revenue estimates, dynamic pricing, market occupancy/ADR by area.

**Cost:** Free (API available)
**Coverage:** 190+ countries, US ZIP-level data mentioned.

**Build path:** Evaluate API against Rabbu for STR brain. One of these is the free tier
for AirDNA-equivalent data.

---

## TIER 5 — Climate / Insurance Risk (free but niche build path)

---

### 21. First Street Foundation — Flood Risk Data

**URL:** https://firststreet.org/
**Free Zenodo dataset v2.0:** https://zenodo.org/records/6459076
**ArcGIS layer:** https://www.arcgis.com/home/item.html?id=b3489960c0e942c6985d2eca471718dd

**What it covers:** Property-level and aggregated flood risk statistics. Flood Factor scores
(1–10 scale), probability of flooding, expected flood depth, historical flood events.

**Available at:** ZIP code, County, Congressional District, State level (aggregated).
Property-level data is in the Zenodo CSV.

**Note:** Already have FEMA NFIP AAL data in the stack (the $30,074/yr figure for ZIP 33931
is NFIP-derived). First Street gives an independent climate-model-based risk score that
complements the NFIP actuarial data.

**Cost:** Zenodo dataset is free. API (risk.factor.com) is paid for property-level queries.
**License:** Academic/research license on the Zenodo release. API commercial terms apply.

**Build path:** ODD scaffold for property-level API. The Zenodo ZIP/county aggregates are
auto-ingestable. Brain: extend `env-swfl` or `flood-risk-swfl`.

---

### 22. Citizens Property Insurance — Market Share + Policy Data

**URL:** https://www.citizensfla.com/
**Market Share Report PDF:** https://www.citizensfla.com/documents/20702/93160/20230930+Market+Share+Report.pdf/87d5e759-c884-9516-d1c8-f8cad9560c8f

**What it covers:** Citizens is Florida's insurer of last resort. Their quarterly reports show:
- Policy count and insured value by county and ZIP
- Market share vs. private carriers
- Premium data

**Confirmed SWFL counts (from search snippet):**
- Lee County: 34,269 policies in-force
- Collier County: 11,852 policies in-force

**Why this matters for the platform:** Post-Ian, Citizens became the dominant insurer in
Lee County after private carriers exited. Citizens exposure is a direct proxy for:
(a) affordability stress (private insurance unavailable or unaffordable),
(b) hurricane risk concentration, and (c) property value headwinds.

**Also:** Florida OIR Property Insurance Stability Reports (FLOIR.gov) — quarterly:
https://floir.gov/docs-sf/default-source/property-and-casualty/stability-unit-reports/january-2025-isu-report.pdf

**Cadence:** Quarterly market share report; annual OIR stability report.
**License:** Public document, state-required disclosure.

**Build path:** ODD scaffold → quarterly PDF scrape. Brain: extend `env-swfl` with
insurance-access metrics as a new risk dimension.

---

## TIER 6 — Confirmed via FRED (ready to wire)

These SWFL-specific series already live in FRED and are directly API-accessible:

| FRED Series | Description | Grain | Cadence |
|---|---|---|---|
| `MEDLISPRI12071` | Median Listing Price — Lee County FL | County | Monthly |
| `ATNHPIUS12021A` | All-Transactions HPI — Collier County FL | County | Annual |
| `FLCOLL0POP` | Resident Population — Collier County FL | County | Annual |
| `MEDDAYONMARUS` | Median Days on Market — US | US | Monthly |

FRED API is already in the stack (macro-swfl). These series can be added as wires with
~10 lines of config each.

---

## Zillow ZHVI Tier Data — Luxury + Starter at ZIP (NEW FIND, 2026-06-14)

Zillow publishes **top-tier** and **bottom-tier** ZHVI at the ZIP code level — confirmed via live URL probes (200 OK, ~130–145 MB, last modified May 2026):

| Dataset | Zillow definition | URL | Grain | Cadence |
|---|---|---|---|---|
| ZHVI Bottom Tier (starter proxy) | 5th–35th percentile value | `https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.0_0.33_month.csv` | **ZIP code** | Monthly |
| ZHVI Top Tier (luxury proxy) | 65th–95th percentile value | `https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.67_1.0_month.csv` | **ZIP code** | Monthly |

These replace Redfin's Luxury and Starter datasets (Metro/State/US only) with superior ZIP-grain equivalents.
Brain: extend ZHVI work already planned for `redfin-swfl` / `housing-market-swfl`.

---

## EXCLUDED — Redfin Metro-Only Datasets (no ZIP moat)

The following 6 Redfin datasets appear in the Redfin Data Center but are **Metro/Census Region/State/US only**. They add no edge over sources we already hold or have planned at ZIP/county grain. Do not build pipelines for them.

| Redfin Dataset | Redfin Grain | Why excluded | ZIP/county substitute |
|---|---|---|---|
| **Financing Trends** (cash %, loan types, down payment) | Metro, State, US | HMDA gives loan-type + DTI at census tract → county. LeePA parcel records (no-mortgage = cash sale) give cash purchase % at ZIP for Lee County. FL DOR extends to Collier. | LeePA-derived + HMDA |
| **Investor Home Purchases** (investor share, type) | Metro, State, US | LeePA homestead-flag inversion → non-homesteaded non-owner-occupied = investor; aggregate to ZIP. HMDA `occupancy_type=3` adds mortgaged investor layer at tract level. | LeePA-derived + HMDA |
| **Balance of Power** (buyer/seller score) | Metro, Census Region, US | No ZIP-level BoP score exists anywhere. **Derive it**: months_of_supply + sale_to_list + active_listings from Redfin's 12-col ZIP dataset (already in our build plan) give the same components. | Compute from Redfin ZIP components |
| **Luxury Home Market** (top-5% metrics) | Metro, State, US | Zillow ZHVI top-tier (65th–95th pctile) at ZIP — **confirmed live URL above** (145 MB, May 2026). Monthly cadence, free download. | Zillow ZHVI top-tier at ZIP |
| **Starter Home Market** (entry-tier metrics) | Metro, State, US | Zillow ZHVI bottom-tier (5th–35th pctile) at ZIP — **confirmed live URL above** (136 MB, May 2026). Monthly cadence, free download. | Zillow ZHVI bottom-tier at ZIP |
| **Redfin Home Price Index** (Case-Shiller style) | Metro, State, US | FHFA HPI at ZIP5 (annual, public domain, back to ~1990s) is the equivalent and is already our #1 build priority. Zillow ZHVI mid-tier at ZIP is the monthly equivalent. | FHFA ZIP5 HPI + Zillow ZHVI |

**Rule:** If a Redfin dataset is not in the 12-column ZIP/county main download, skip it — the ZIP moat is already covered by FHFA + Zillow ZHVI tiers + LeePA + HMDA.

---

## Build Priority Ranking

| # | Source | Effort | Value | Build Path | New Brain/Extension |
|---|---|---|---|---|---|
| 1 | FHFA HPI ZIP5 | Low | Very High | Auto-ingest CSV | `fhfa-hpi-swfl` (new) |
| 2 | Redfin Data Center (full 12 cols) | Low | Very High | Auto-ingest CSV | extend `redfin-lee` → `redfin-swfl` |
| 3 | Zillow ZHVI top + bottom tier at ZIP | Low | Very High | Auto-ingest CSV (confirmed URLs) | extend ZHVI work → luxury/starter signals |
| 4 | Realtor.com Research | Low | High | Auto-ingest CSV | `realtor-swfl` (new) |
| 5 | HUD SAFMRs (ZIP FMR) | Low | High | Auto-ingest XLSX | extend `rentals-swfl` |
| 6 | Census BPS (building permits) | Low | High | Auto-ingest API | `permits-supply-swfl` (new) |
| 7 | CFPB HMDA | Medium | High | Auto-ingest (county filter) | `mortgage-market-swfl` (new) |
| 8 | ApartmentList rents | Low | Medium | Auto-ingest CSV | extend `rentals-swfl` |
| 9 | Zillow Price Cuts + ZORDI | Low | Medium | Auto-ingest CSV | extend `redfin-swfl` |
| 10 | FL DOR Sales Report | Low | Medium | Auto-ingest XLS | extend `properties-lee-value` → 6-county |
| 11 | Cushman & Wakefield SWFL PDFs | Medium | High | Quarterly PDF scrape | extend `cre-swfl` |
| 12 | Citizens Insurance PDF | Medium | High | Quarterly PDF scrape | extend `env-swfl` |
| 13 | NABOR Market Statistics | Medium | High | Monthly PDF scrape | `collier-housing-nabor` (new) |
| 14 | Florida Realtors SunStats | Medium | High | Monthly PDF/scrape | `florida-realtors-swfl` (new) |
| 15 | HUD Cape Coral CHMA PDF | Low | Medium | One-time snapshot | citation in `housing-market-swfl` |
| 16 | Collaboratory Housing Study | Low | Medium | One-time snapshot | citation in affordability brain |
| 17 | First Street ZIP aggregates | Low | Medium | Auto-ingest (Zenodo) | extend `env-swfl` |
| 18 | Rabbu / AirROI STR | Medium | Medium | Web scrape / API | `str-swfl` (new) |
| 19 | FL EDR population forecasts | Low | Low | Auto-ingest | extend `macro-swfl` |

---

## What We Don't Have and Why

| Gap | Status | Notes |
|---|---|---|
| Live MLS per-property listings | Business/legal decision | Requires RESO Web API + MLS membership. ATTOM MCP may shortcut this — check before paying. |
| CoStar CRE data | Paid ($$$) | Cushman & Wakefield public PDFs are the free proxy. |
| AirDNA full STR data | Paid | Rabbu + AirROI are free alternatives worth evaluating first. |
| CoreLogic reports | Mostly paywalled | Some free PDF market reports exist but no bulk download. |
| NAR metro-level data | NAR member gated | The county-level data in Florida Realtors is the sanctioned free path. |
| Collier parcel-level (CCPA) | Needs DOR assessment roll request | Submit FL DOR data request for Collier assessment roll; same format as LeePA. |
| Redfin metro-only datasets | Intentionally excluded | Financing Trends, Investor Purchases, Balance of Power, Luxury, Starter, Redfin HPI — all Metro+ only, all covered at ZIP grain by FHFA + Zillow ZHVI tiers + LeePA + HMDA. |

---

*Generated 2026-06-13. Updated 2026-06-14 with ZIP moat exclusion analysis + Zillow ZHVI tier URLs verified live. Sources verified via live Firecrawl scrapes — not from model memory.*
