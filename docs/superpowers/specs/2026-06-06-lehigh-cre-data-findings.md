# Lehigh Acres CRE Data Source Findings

**Date:** 2026-06-07
**Author:** Claude (automated research session)
**Task reference:** CRE data sourcing for `lehigh-cre` brain pack — Lee Blvd / Joel Blvd corridors, ZIP 33936

---

## Summary Verdict

**⚠️ CORRECTED 2026-06-07 (after direct PDF scrape):** The initial research agent failed to pull the retail PDF. After scraping directly: **Lehigh Acres IS a named submarket in all four C&W MarketBeat asset classes — industrial, office, retail, and medical office.** Retail vacancy is 0.2% (tightest in Lee County) with a $35.08/SF NNN asking rent. Only cap rate and Joel Blvd corridor-specific metrics remain narrative-only.

---

## Sources Table

| Source                               | Coverage                                                             | Available Metrics                                                                | Frequency                 | Recency           | Notes                                                                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C&W MarketBeat — Industrial**      | **Named submarket** (Lehigh Acres row in Lee County table)           | Vacancy %, net absorption SF, asking rent PSF (OS/WD split)                      | Quarterly                 | Q1 2026           | No cap rate. Paywall-free PDFs.                                                                                                                                                                        |
| **C&W MarketBeat — Office**          | **Named submarket** (Lehigh Acres row in Lee County table)           | Vacancy %, net absorption SF                                                     | Quarterly                 | Q1 2026           | No asking rent (182,043 SF inventory — too thin). No cap rate.                                                                                                                                         |
| **C&W MarketBeat — Retail**          | **Named submarket** (Lehigh Acres row in Lee County table)           | Vacancy %, net absorption SF, NNN asking rent PSF                                | Quarterly                 | Q4 2025           | ✅ Retail IS covered. 0.2% vacancy, $35.08/SF NNN. No cap rate published.                                                                                                                              |
| **C&W MarketBeat — Medical Office**  | **Named submarket** ("Lehigh" row in Lee County table)               | Inventory SF, net absorption SF, asking rent PSF                                 | Quarterly                 | Q1 2026           | 367,473 SF, $31.32/SF. Vacancy/direct-vacant suppressed (too thin to publish).                                                                                                                         |
| **Colliers Fort Myers**              | **Not named** — Lee County aggregate                                 | Vacancy %, net absorption, leasing activity at county level                      | Quarterly                 | Q3 2025 / Q4 2024 | No Lehigh Acres breakout in scraped content. Covers Fort Myers MSA / Lee County whole.                                                                                                                 |
| **LSI Companies (Commercial Pulse)** | **Not named** — county-level via CoStar                              | Cap rate trends (CoStar-modeled), sale price PSF by county                       | Quarterly                 | Q1 2025           | CoStar data resold at Lee County grain only. Lehigh Acres appears only in residential permit context. No Lehigh Acres CRE submarket.                                                                   |
| **Mayhugh Commercial Advisors**      | **Not named** — Lee County aggregate                                 | Vacancy %, rent PSF, cap rate (CoStar-modeled), absorption at county level       | Quarterly                 | Q1 2025           | Charlotte/Lee/Collier county breakouts only. No submarket below county level.                                                                                                                          |
| **LoopNet**                          | **Individual listings present** — not a submarket feed               | Cap rate on NNN listings (e.g., 4.00%–6.61% range cited for Lehigh Acres retail) | On-demand listings        | Current           | Requires login for most detail. Aggregate cap rate ranges are auto-generated by LoopNet from thin listing data — not statistically meaningful. Sparse: ~46 for-sale listings total, ~3 NNN properties. |
| **Crexi**                            | **Individual listings present**                                      | Listing-level only                                                               | On-demand                 | Current           | Retail, office, mixed-use listings on Lee Blvd visible. No submarket analytics.                                                                                                                        |
| **Lee & Associates**                 | **Fort Myers/Lehigh Acres MSA** (single row in their national table) | Industrial absorption SF, deal mentions                                          | Quarterly national report | Q4 2024           | Combines Fort Myers + Lehigh Acres into one industrial row. No Lehigh-specific breakout. No cap rate or retail data.                                                                                   |
| **Ian Black Real Estate**            | **Not found**                                                        | None                                                                             | N/A                       | N/A               | Blog active; no Lehigh Acres submarket report found. Primarily covers Sarasota/Manatee.                                                                                                                |
| **CBRE Fort Myers**                  | **Not found as report**                                              | None at Lehigh Acres level                                                       | N/A                       | N/A               | CBRE has a Fort Myers industrial presence (Derek Bornhorst listed); no public SWFL market report found for Fort Myers/Lehigh Acres.                                                                    |
| **Marcus & Millichap SWFL**          | **Not found**                                                        | None                                                                             | N/A                       | N/A               | Lehigh Acres appears in listings/social media context (rezoning news), not in market reports.                                                                                                          |
| **LeePA implied cap rate**           | **Not feasible**                                                     | None                                                                             | N/A                       | N/A               | LeePA publishes sale prices, not NOI or income value. Cap rate = NOI / price; NOI is not in public record. Not computable from LeePA alone.                                                            |

---

## Section-by-Section Findings

### 1. Cushman & Wakefield MarketBeat

**Finding: Lehigh Acres IS a named submarket — for industrial and office only.**

C&W publishes Southwest Florida MarketBeat reports quarterly under the "Americas Alliance" franchise operated locally by Commercial Property Southwest Florida (cpswfl.com). Lehigh Acres appears as a distinct named row in the submarket statistics table for both the industrial and office reports. These are publicly accessible PDF documents.

**Industrial Q1 2026 — Lehigh Acres submarket row (verified from PDF):**

- Inventory: 1,338,754 SF
- Vacant SF: 45,768
- Vacancy Rate: **3.4%**
- Current Qtr Net Absorption: -13,997 SF
- YTD Net Absorption: -13,997 SF
- Under Construction: 13,293 SF
- Completions: 0
- Weighted Avg Net Rent (MF): `---` (no data)
- Weighted Avg Net Rent (OS): **$14.86/SF**
- Weighted Avg Net Rent (WD): **$13.22/SF**

Historical industrial data confirmed: Q4 2024 (vacancy 5.6%, rent WD $9.79), Q1 2025 (vacancy 6.0%, rent WD $10.62), Q3 2025 (vacancy 2.5%), Q1 2026 (vacancy 3.4%).

**Office Q4 2025 — Lehigh Acres submarket row (verified from PDF):**

- Inventory: 182,043 SF
- Overall Vacancy Rate: **1.1%** (extremely tight)
- Net Absorption: -2,006 SF
- Avg Asking Rent: `---` (suppressed — market too thin to publish)
- Leasing Activity: `---` (suppressed)

The office submarket (182K SF total) is too small for a statistically published rent figure — C&W marks it `---`.

**Retail:** A C&W Southwest Florida Retail MarketBeat exists (Q4 2024 referenced on cpswfl.com), but the scraped data did not confirm a Lehigh Acres submarket row in the retail report. Given that the office market only has 182K SF and the retail market in Lehigh Acres is primarily strip/general retail scattered along Lee Blvd, it is unlikely that a retail row exists with published metrics.

**Cap rate:** Not published in any C&W MarketBeat for any SWFL submarket. MarketBeat tracks vacancy/absorption/rent, not investment yields.

**Sources:**

- Industrial Q1 2026: https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q1/us-reports/industrial/fortmyers_naples_americas_alliance_marketbeat_industrial_q12026.pdf
- Office Q4 2025: https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2025/q4/us-reports/office/fort-myers_naples_americas_alliance_marketbeat_office_q42025.pdf
- Industrial Q1 2025: https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2025/q1/us-reports/industrial/fortmyers_naples_americas_alliance_marketbeat_industrial_q12025.pdf
- Industrial Q4 2024: https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2024/q4/us-reports/inustrial/fortmyers_naples_americas_alliance_marketbeat_industrial_q42024.pdf
- MarketBeat hub: https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

---

### 2. Colliers Fort Myers

**Finding: No Lehigh Acres submarket — Lee County aggregate only.**

Colliers International publishes Southwest Florida quarterly market reports for office, retail, and industrial from their Fort Myers office. These are available at colliers.com/en/research/ft-myers/. Reports confirmed: industrial Q4 2024, office Q4 2024, office Q3 2025, retail Q3 2025, office Q4 2025.

The scraped content from colliers.com report pages rendered navigation frames rather than data tables. However, the search result snippets confirm the scope: reports reference "Cape Coral-Fort Myers" MSA and Lee County level metrics. No Lehigh Acres submarket row was found in any Colliers Fort Myers report.

Colliers' market scope appears to be the Fort Myers metro (Lee County) as a whole, without the submarket-level breakout that C&W provides. Their data vendor is CoStar.

**Sources:**

- https://www.colliers.com/en/research/ft-myers/southwest-fl-industrial-market-report-q4-2024
- https://www.colliers.com/en/research/ft-myers/southwest-fl-office-market-report-q4-2024
- https://www.colliers.com/en/research/ft-myers/southwest-florida-retail-market-report-2025-q3
- https://www.colliers.com/en/united-states/cities/ft-myers

---

### 3. LSI Companies

**Finding: Lehigh Acres appears in residential context only — no CRE submarket data.**

LSI Companies (lsicompanies.com) publishes two reports: "Market Trends" (macro SWFL economic overview) and "Commercial Pulse" (CRE focus). Both are quarterly, free PDF downloads. They are a credible SWFL-specific source that the local CRE community follows.

LSI mentions Lehigh Acres prominently in their reports — but exclusively in the residential permit context. Q4 2024: "Lehigh Acres (4,100 permits YoY) reaching record levels." Q1 2025: "Lehigh Acres once again leading the way with over 20% of these permits, targeted for delivery of affordable housing." No cap rate data confirmed for Lehigh Acres: the Q1 2025 LSI report search snippet explicitly states "No Cap Rate data" in one context, though this referred to LSI's own CoStar-modeled charts (which show county-level only).

The Commercial Pulse's CoStar-powered CRE analytics sections cover: Lee County Office, Collier County Office, Charlotte County Office, Lee County Retail, Collier County Retail, Charlotte County Retail, Lee County Industrial, Collier County Industrial, Charlotte County Industrial. No submarket breakout below county level.

LSI's Commercial Permit Activity section lists Lee County Unincorporated permits — this would include Lehigh Acres (which is unincorporated Lee County) — but only as permit-value/project-type data, not operating metrics.

**Sources:**

- Q4 2024 Commercial Pulse: https://lsicompanies.com/wp-content/uploads/2025/03/lsi-commercial-pulse-q4_2024.pdf
- Q1 2025 Commercial Pulse: https://lsicompanies.com/wp-content/uploads/2025/05/lsi-commercial-pulse-q1-2025.pdf
- LSI Companies market research page: https://lsicompanies.com/services/market-research-reporting/

---

### 4. LoopNet / CoStar

**Finding: Listings present but too sparse for market-level metrics. Published cap rate ranges are generated estimates, not transaction data.**

LoopNet shows ~46 commercial for-sale listings in Lehigh Acres FL and ~3 NNN properties. Confirmed listings on Lee Blvd include:

- 2722 Lee Blvd — Chipotle NNN at 4.00% cap rate, 5,614 SF retail
- 5546 Lee Blvd — retail lease listing
- 3507 Lee Blvd — office lease

LoopNet's category pages for Lehigh Acres publish aggregate language like "cap rates for retail properties in Lehigh Acres, FL typically range between 4.00% and 6.61%" and "average cap rate for office properties is typically 7.00%." These are LoopNet-generated algorithmic estimates derived from current asking prices and CoStar modeled income — they are not transaction-derived cap rates and are not suitable as cited market data. Volume is too sparse (3 NNN listings) to be statistically meaningful.

Detailed listing data (actual NOI, lease terms, financials) requires LoopNet login and CoStar subscription.

**Sources:**

- NNN listings search: https://www.loopnet.com/search/listings/nnn-properties/lehigh-acres-fl/for-sale/
- For-sale search: https://www.loopnet.com/search/commercial-real-estate/lehigh-acres-fl/for-sale/
- 2722 Lee Blvd Chipotle listing: https://www.loopnet.com/Listing/2722-Lee-Blvd-Lehigh-Acres-FL/35605274/
- 5546 Lee Blvd lease: https://www.loopnet.com/Listing/5546-Lee-Blvd-Lehigh-Acres-FL/38727815/

---

### 5. Crexi

**Finding: Listings present, no submarket analytics.**

Crexi shows commercial listings in Lehigh Acres including retail, office, mixed-use, and lease properties on Lee Blvd. The platform does not publish submarket-level market reports or analytics for Lehigh Acres — it is a listings marketplace only. Data quality on individual listings is not auditable without account access.

**Sources:**

- https://www.crexi.com/properties/FL/Lehigh_Acres
- https://www.crexi.com/properties/FL/Lehigh_Acres/Retail
- https://www.crexi.com/lease/properties/FL/Lehigh_Acres

---

### 6. LeePA Implied Cap Rate

**Finding: Not feasible — LeePA does not publish income data.**

The Lee County Property Appraiser (LeePA) publishes sale price records for commercial parcels. However, cap rate computation requires NOI (net operating income), which is not a public record in Florida. LeePA publishes assessed "just value" and sale prices but not rental income or expense data. There is no path from LeePA data alone to an implied cap rate without a separate income source (appraisal, rent roll, or CoStar subscription data). This approach is a dead end.

For reference: LSI Companies noted that properties near the Lee Blvd / Lehigh Acres corridor do transact — the search results surfaced an LSI-brokered sale at 5600 Lee Blvd (10± acres commercial) — but the NOI supporting the sale price is not in the public record.

**Sources:**

- LSI sale at 5600 Lee Blvd: https://lsicompanies.com/lsi-companies-inc-brokers-a-10%C2%B1-acre-commercial-property-in-lehigh-acres-fl/

---

### 7. Other SWFL Brokers

**Ian Black Real Estate:** Active SWFL CRE broker with a blog (ian-black.com/blog). No Lehigh Acres market report found. Their footprint appears primarily Sarasota/Manatee-centric.

**CBRE Fort Myers:** Derek Bornhorst (Senior VP, Industrial & Logistics) operates from Fort Myers. No publicly accessible Fort Myers/Lehigh Acres market report found on cbre.com. CBRE publishes national and major-market reports; Fort Myers/Lehigh Acres does not appear to have a dedicated CBRE submarket report in the public domain.

**Marcus & Millichap SWFL:** Lehigh Acres appears in their social media in a residential rezoning context ("Big things are happening in Lehigh Acres"). No SWFL CRE market report covering Lehigh Acres as a submarket was found.

**Mayhugh Commercial Advisors:** Fort Myers-based boutique with quarterly SWFL reports for industrial, retail, and office. Uses CoStar data. Coverage scope: Charlotte County, Lee County, Collier County at the county level only — no submarket breakout. For reference, their Lee County retail Q1 2025 data (CoStar-sourced):

- Lee County retail inventory: 50 million SF
- Availability rate: 3.6%
- Avg asking rent: ~$23/SF (range up to $28/SF in prime submarkets like The Islands)
- Vacancy: 3.0%
  These are Lee County-wide figures, not Lehigh Acres-specific.

**Lee & Associates Naples–Fort Myers:** Publishes quarterly national reports with a Fort Myers market section. Q4 2024 report shows a combined "Fort Myers/Lehigh Acres, FL" industrial row (81,650 SF deal referenced), indicating they aggregate the two rather than separate them. No standalone Lehigh Acres breakout.

**Sources:**

- Ian Black blog: https://www.ian-black.com/blog
- CBRE insights: https://www.cbre.com/insights
- Marcus & Millichap SWFL: https://www.marcusmillichap.com/news-events
- Mayhugh retail Q1 2025: https://mayhughcommercial.com/wp-content/uploads/2025/04/Mayhugh_Market-Report_Q1-2025_Retail_v1.pdf
- Mayhugh industrial Q1 2025: https://mayhughcommercial.com/wp-content/uploads/2025/04/Mayhugh_Market-Report_Q1-2025_Industrial_v1.pdf
- Lee & Associates Q4 2024: https://www.lee-associates.com/wp-content/uploads/2025/01/2024.Q4-North-America-Market-Report.pdf

---

## Conclusion for Pack Design

> ⚠️ **Corrected after direct PDF scrape.** The initial research agent did not pull the retail PDF. Retail IS covered.

### What CAN be populated (with source citations):

| Metric                              | Value                             | Source                                | Grain                      |
| ----------------------------------- | --------------------------------- | ------------------------------------- | -------------------------- |
| Industrial vacancy rate             | 3.4%                              | C&W MarketBeat Industrial Q1 2026     | Lehigh Acres submarket     |
| Industrial net absorption           | -13,997 SF (Q1 2026 YTD)          | C&W MarketBeat Industrial Q1 2026     | Lehigh Acres submarket     |
| Industrial asking rent (OS)         | $14.86/SF NNN                     | C&W MarketBeat Industrial Q1 2026     | Lehigh Acres submarket     |
| Industrial asking rent (WD)         | $13.22/SF NNN                     | C&W MarketBeat Industrial Q1 2026     | Lehigh Acres submarket     |
| Industrial inventory                | 1,338,754 SF                      | C&W MarketBeat Industrial Q1 2026     | Lehigh Acres submarket     |
| Industrial under construction       | 13,293 SF                         | C&W MarketBeat Industrial Q1 2026     | Lehigh Acres submarket     |
| Office vacancy rate                 | 1.1%                              | C&W MarketBeat Office Q1 2026         | Lehigh Acres submarket     |
| Office inventory                    | 182,043 SF                        | C&W MarketBeat Office Q1 2026         | Lehigh Acres submarket     |
| **Retail vacancy rate**             | **0.2%** (tightest in Lee County) | **C&W MarketBeat Retail Q4 2025**     | **Lehigh Acres submarket** |
| **Retail NNN asking rent**          | **$35.08/SF**                     | **C&W MarketBeat Retail Q4 2025**     | **Lehigh Acres submarket** |
| Retail inventory                    | 1,799,903 SF                      | C&W MarketBeat Retail Q4 2025         | Lehigh Acres submarket     |
| Retail net absorption (YTD Q4 2025) | +24,493 SF                        | C&W MarketBeat Retail Q4 2025         | Lehigh Acres submarket     |
| Medical office asking rent          | $31.32/SF                         | C&W MarketBeat Medical Office Q1 2026 | Lehigh (Lee County)        |
| Medical office inventory            | 367,473 SF                        | C&W MarketBeat Medical Office Q1 2026 | Lehigh (Lee County)        |

### What CANNOT be populated (must go narrative-only):

| Metric                                 | Why                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cap rate (any asset class)             | Not published by any source for Lehigh Acres. C&W MarketBeat does not report cap rates. Overall Lee County retail cap rate averaged 6.7% per the Q4 2025 report — county-wide, not submarket-specific. LoopNet's range (4.0%–6.61%) is algorithmic, not transaction-derived. |
| Any Joel Blvd corridor-specific metric | No source tracks Joel Blvd as a distinct corridor. Subsumed into Lehigh Acres submarket (C&W) or Lee County aggregate (all others).                                                                                                                                          |

### Recommended pack design stance:

1. **Populate all four asset classes** from C&W MarketBeat: industrial, office, retail, medical office — all named submarket grain, quarterly cadence, free PDFs.
2. **Retail leads** — 0.2% vacancy and $35.08/SF NNN is a strong bullish signal for Lee Blvd retail density; pair with the "tight supply + limited new development" narrative from C&W's own commentary.
3. **Office: state vacancy (1.1%), suppress rent** — C&W suppresses it (market too thin at 182K SF).
4. **Cap rate: narrative-only.** Lee County retail averaged 6.7% per C&W Q4 2025. Single confirmed Lee Blvd transaction: Chipotle at 2722 Lee Blvd at 4.00% (tenant-credit outlier, not a market average).
5. **Caveat:** "Cap rate and Joel Blvd corridor-level metrics are not published by any broker. All other metrics sourced from Cushman & Wakefield MarketBeat at the Lehigh Acres submarket grain."

**Revised verdict:** Lehigh Acres has substantially better data coverage than initially assessed. C&W MarketBeat covers all major asset classes as a named submarket. The only true gap is cap rate (no broker publishes it at this grain) and sub-corridor specificity (Joel Blvd has no standalone coverage).
