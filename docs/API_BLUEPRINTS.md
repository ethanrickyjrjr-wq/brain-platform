# API Research Blueprints for Dynamic Brain Tree

**Note on Brains Supabase context:** All source fields and staging tables below target the Brains Supabase instance — not the legacy DB.

**Architectural Rule — Ingest Broad, Filter Local:**
The `dlt` pipelines described below MUST ingest data broadly (e.g., all of Florida or national context) into the A1 Data Lake. Do not prematurely truncate the raw ingest to just Lee/Collier counties at the pipeline level. SWFL-specific filtering (e.g., `county_fips = 12071` or `dms_dest = 129`) is handled downstream by the Master Brain when spinning up Atomic Brains. The examples below show the SWFL logic for downstream use, not for upstream truncation.

## Target 1 — Data USA API (Tesseract Cubes)

### Critical Corrections
*   `cbp_naics` -> Actual Tesseract Cube Name is `county_business_patterns`
*   `pums_migration` -> **DOES NOT EXIST.** The PUMS cubes (pums_1, pums_5) contain Birthplace and Nativity dimensions — useful for origin-country proxy but NOT county-to-county migration flows. For wealth-weighted migration, we must use IRS SOI county-to-county files (see substitution below).

### Cube 1: county_business_patterns (Business Density)
*   **Base URL:** `https://api.datausa.io/tesseract/`
*   **Auth:** None. No API key.
*   **Ingest Target:** Pull all FL counties. Drop the `&County=` filter in the raw ingest, or use `&State=04000US12` if supported.
*   **Downstream SWFL Filter:** `05000US12071` (Lee) | `05000US12021` (Collier)
*   **NAICS Drilldown:** Append `&drilldowns=County,NAICS` to get industry breakdown.

### Substitute for pums_migration: IRS SOI County-to-County Migration
*   **Source:** `https://www.irs.gov/statistics/soi-tax-stats-county-to-county-migration-data-files`
*   **Type:** Bulk CSV download via ZIP (dlt must use `requests` + `csv.DictReader`)
*   **Auth:** None.
*   **Ingest Target:** Ingest all inflows/outflows involving `statefips == "12"` (Florida).
*   **Downstream SWFL Filter:** `y2_countyfips` in `["071", "021"]`

## Target 2 — Federal Register API (/public-inspection)
*   **Base URL:** `https://www.federalregister.gov/api/v1/`
*   **Auth:** None.
*   **Rate Limits:** ~100 req/min is safe.
*   **Infrastructure Grants Query:**
    `GET https://www.federalregister.gov/api/v1/documents.json?per_page=100&conditions[term]=infrastructure+grant&conditions[type][]=Notice&conditions[publication_date][gte]=2025-01-01`
*   **AI Consortia Export Rules Query:**
    `GET https://www.federalregister.gov/api/v1/documents.json?per_page=50&conditions[term]=AI+export+rules&conditions[publication_date][gte]=2025-01-01`

## Target 3 — ITA Trade Data API
*   **Portal:** `https://developer.trade.gov/`
*   **Auth:** Free account required (Ocp-Apim-Subscription-Key in header). *Note: Old api.trade.gov/apps/store/ credentials are dead.*
*   **Trade Leads Query:** `GET https://api.trade.gov/v1/trade_leads/search.json?size=50&offset=0`
*   **CSL Query:** `GET https://api.trade.gov/v1/consolidated_screening_list/search.json?size=50&q=China&sources=SDN,DPL,EL`
*   **CSL Free Fallback:** The full CSL is downloadable without a key at `https://www.trade.gov/consolidated-screening-list` in CSV/JSON. Simpler for a `dlt` pipeline targeting periodic snapshots.

## Target 4 — FAF5 (Freight Analysis Framework)
*   **Verdict:** No REST API. Bulk CSV/ZIP download only (`https://faf.ornl.gov/faf5/`).
*   **FAF Zone for SWFL:** **Zone 129** (Remainder of Florida). *(Note: 124 is Tampa, 129 is Lee/Collier)*
*   **SCTG Targets:** 12 (Gravel/crushed stone), 32 (Base metals/rebar), 31 (Nonmetallic mineral products), 33 (Articles of base metal).
*   **Ingest Target:** Ingest all domestic flows where `dms_dest` OR `dms_orig` starts with `12` (All FL zones: 121, 122, 123, 124, 129).
*   **Downstream SWFL Filter:** `dms_dest = 129` and `trade_type = 1`

## Semantic Ledger Mapping Proposal (`brain-vocabulary.json`)

```json
{
  // IRS Migration → pums_migration brain
  "irs_migration_inflow_count": { "maps_to": "population_inflow_units", "source": "IRS SOI" },
  "irs_migration_agi_000s": { "maps_to": "household_wealth_proxy", "source": "IRS SOI" },

  // Data USA CBP → cbp_naics brain
  "cbp_employees": { "maps_to": "labor_market_depth", "source": "Census CBP" },
  "cbp_num_establishments": { "maps_to": "business_density", "source": "Census CBP" },

  // Federal Register → macro/policy brain
  "fedreg_doc_number": { "maps_to": "regulatory_event_id", "source": "Federal Register" },
  "fedreg_type": { "maps_to": "regulatory_action_type", "source": "Federal Register" },

  // ITA Trade Leads → foreign capital brain
  "ita_lead_country": { "maps_to": "foreign_capital_origin", "source": "ITA Trade Leads" },
  "ita_csl_entity_name": { "maps_to": "sanctions_entity", "source": "ITA CSL" },

  // FAF5 → logistics/commodity brain
  "faf_sctg2": { "maps_to": "commodity_class_sctg", "source": "FAF5 ORNL" },
  "faf_tons": { "maps_to": "freight_volume_ktons", "source": "FAF5 ORNL" }
}
```