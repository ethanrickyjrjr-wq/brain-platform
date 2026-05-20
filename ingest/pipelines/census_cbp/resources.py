import dlt
import requests
import os
from datetime import datetime, timezone

# Constants
CENSUS_CBP_BASE_URL = "https://api.census.gov/data/{year}/cbp"
CBP_YEARS = [2017, 2018, 2019, 2020, 2021, 2022]
FL_STATE_FIPS = "12"

@dlt.resource(name="census_cbp_fl", write_disposition="replace")
def census_cbp_fl():
    # Fix: Try dlt's secret manager first, then fallback to environment variables
    try:
        api_key = dlt.secrets["CENSUS_API_KEY"]
    except KeyError:
        api_key = os.environ.get("CENSUS_API_KEY", "")

    ingested_at = datetime.now(timezone.utc).isoformat()

    for year in CBP_YEARS:
        url = CENSUS_CBP_BASE_URL.format(year=year)
        
        # CBP uses NAICS 2017 codes across all vintages 2017-2022
        naics_var = "NAICS2017"
        naics_label_var = "NAICS2017_LABEL"
        fields = [naics_var, naics_label_var, "ESTAB", "EMP", "PAYANN", "NAME"]
        
        params = {"get": ",".join(fields), "for": "county:*", "in": f"state:{FL_STATE_FIPS}"}
        if api_key:
            params["key"] = api_key

        resp = requests.get(url, params=params, timeout=60)
        
        # Helpful error logging if Census still complains
        if resp.status_code != 200 or not resp.text.startswith('['):
            print(f"\n[CRASH AVOIDED] API ERROR for year {year}: {resp.text}\n")
            continue # Skip this year instead of crashing the whole pipeline
            
        try:
            data = resp.json()
        except ValueError:
            print(f"\nJSON Error for year {year}. Raw text: {resp.text}\n")
            continue

        headers = data[0]
        for row_arr in data[1:]:
            row = dict(zip(headers, row_arr))
            yield {
                "naics_code":          row.get(naics_var, ""),
                "naics_label":         row.get(naics_label_var, ""),
                "county_name":         row.get("NAME", ""),
                "establishment_count": int(row.get("ESTAB") or 0),
                "employment":          int(row.get("EMP") or 0),
                "annual_payroll":      int(row.get("PAYANN") or 0),
                "year":                year,
                "fips_state":          row.get("state", FL_STATE_FIPS),
                "fips_county":         row.get("county", ""),
                "ingested_at":         ingested_at,
            }
