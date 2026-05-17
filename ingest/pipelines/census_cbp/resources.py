import os
from datetime import datetime, timezone

import dlt
import requests

from .constants import CENSUS_CBP_BASE_URL, CBP_YEARS, CBP_FIELDS, FL_STATE_FIPS

_CBP_COLUMNS = {
    "naics_code":          {"data_type": "text"},
    "naics_label":         {"data_type": "text"},
    "county_name":         {"data_type": "text"},
    "establishment_count": {"data_type": "bigint"},
    "employment":          {"data_type": "bigint"},
    "annual_payroll":      {"data_type": "bigint"},
    "year":                {"data_type": "bigint"},
    "fips_state":          {"data_type": "text"},
    "fips_county":         {"data_type": "text"},
    "ingested_at":         {"data_type": "timestamp"},
}


@dlt.resource(
    table_name="census_cbp",
    write_disposition="merge",
    primary_key=["naics_code", "year", "fips_state", "fips_county"],
    columns=_CBP_COLUMNS,
)
def census_cbp_fl():
    api_key = os.environ.get("CENSUS_API_KEY", "")
    ingested_at = datetime.now(timezone.utc).isoformat()

    for year in CBP_YEARS:
        url = CENSUS_CBP_BASE_URL.format(year=year)
        params = {"get": ",".join(CBP_FIELDS), "for": "county:*", "in": f"state:{FL_STATE_FIPS}"}
        if api_key:
            params["key"] = api_key

        resp = requests.get(url, params=params, timeout=60)
        resp.raise_for_status()

        data = resp.json()
        headers = data[0]
        for row_arr in data[1:]:
            row = dict(zip(headers, row_arr))
            yield {
                "naics_code":          row.get("NAICS2022", ""),
                "naics_label":         row.get("NAICS2022_LABEL", ""),
                "county_name":         row.get("NAME", ""),
                "establishment_count": int(row.get("ESTAB") or 0),
                "employment":          int(row.get("EMP") or 0),
                "annual_payroll":      int(row.get("PAYANN") or 0),
                "year":                year,
                "fips_state":          row.get("state", FL_STATE_FIPS),
                "fips_county":         row.get("county", ""),
                "ingested_at":         ingested_at,
            }
