# SFWMD DBHYDRO — dlt Pipeline Technical Spec

**Note on Brains Supabase context:** All source fields and staging tables target the Brains Supabase instance.

**Architectural Rule — Ingest Broad, Filter Local:**
The `dlt` pipeline MUST ingest data broadly (all Florida stations) into the A1 Data Lake. SWFL-specific filtering (e.g., `county = LEE`) is handled downstream by the Master Brain.

## 1. Access Method & Auth
*   **Path A — Legacy CSV (Recommended for initial build):**
    *   **Base URL:** `https://my.sfwmd.gov/dbhydroplsql/web_io.report_process`
    *   **Auth:** None. Anonymous HTTP GET.
    *   **Params:** `?v_period=uspec&v_start_date=20000101&v_end_date=20251231&v_report_type=format7&v_target_code=file_csv&v_run_mode=onLine&v_js_flag=Y&v_dbkey={slash_joined_keys}`
*   **Path B — New REST API (Future):** Requires OAuth 2.0 client credentials (email `datarequests@sfwmd.gov`).

## 2. Station Discovery (No Auth)
*   **Monitoring Stations:**
    `GET https://geoweb.sfwmd.gov/agsext2/rest/services/MonitoringLocations/DBHYDRO_SiteStation/MapServer/0/query?where=1=1&outFields=*&f=json`
*   **Groundwater Wells:**
    `GET https://geoweb.sfwmd.gov/agsext2/rest/services/MonitoringLocations/DBHYDRO_Wells/FeatureServer/query?where=1=1&outFields=*&f=json`
*   **Station Prefixes:** `S{NNN}` (Surface water), `G{NNN}` (Groundwater well), `S{NNN}_R` (Rainfall gauge).

## 3. Querying Time-Series
**Step 1: dbkey Lookup:**
`GET https://my.sfwmd.gov/dbhydroplsql/show_dbkey_info.show_dbkeys_matched?v_category=GW&v_data_type=WELL&v_frequency=DA&v_statistic_type=MEAN&v_recorder=PREF&v_agency=WMD&v_js_flag=Y&v_order_by=STATION&v_dbkey_list_flag=Y&display_quantity=100000`
*(Parse HTML `<table>` for integer dbkeys)*

**Step 2: Pull Data:** Pass slash-joined dbkeys to Path A URL. Use `v_report_type=format7` (one row per day).

## 4. Data Handling Rules
*   **Sentinels:** `-99999.0` MUST be converted to `NULL` before storage.
*   **Datum (CRITICAL):** Do not mix `NGVD29` and `NAVD88` untagged. Legacy CSV data units must be checked and stored in the `datum` column. Mixing them silently corrupts elevation signals by 1+ ft.
*   **Quality Codes:** `A` (Approved), `P` (Provisional), `R` (Revised). Flag estimated data (`E`).

## 5. Downstream SWFL Filters
*   **Counties:** `LEE`, `COLL`
*   **Basins:** `C43` / `CALOOSAHATCHEE` (Lee), `C111` / `BIG CYPRESS` (Collier)
*   **Key Structures:** `S77`, `S79`, `S80` (Caloosahatchee flow), `S155` (South Lee)

## 6. Tier 2 Schema (`data_lake.dbhydro_daily`)
Primary Key: `(dbkey, obs_date)`. Write disposition: `merge`.
Columns: `dbkey` (text), `station_id` (text), `station_name` (text), `data_type` (text), `category` (text), `obs_date` (date), `value` (double), `datum` (text), `quality_code` (text), `county` (text), `basin` (text), `latitude`/`longitude` (double).

## 7. Semantic Ledger Mapping
*   `env_gw_level_lee_median_ft` (Low = drought/sink risk; High = flood/septic threshold)
*   `env_sw_stage_caloosahatchee_ft` (Stage at S79)
*   `env_rainfall_swfl_annual_in`
*   `env_gw_highwater_exceedance_days` (>2 ft NAVD88 = septic/slab constraint)