import csv
import io
from datetime import datetime, timezone

import dlt
import requests

from .constants import BLS_QCEW_BASE_URL, AREA_FIPS


_BLS_QCEW_COLUMNS: dict = {
    "id":                {"data_type": "text",      "nullable": False, "primary_key": True},
    "area_fips":         {"data_type": "text",      "nullable": False},
    "own_code":          {"data_type": "text",      "nullable": False},
    "industry_code":     {"data_type": "text",      "nullable": False},
    "agglvl_code":       {"data_type": "text",      "nullable": True},
    "size_code":         {"data_type": "text",      "nullable": True},
    "year":              {"data_type": "bigint",    "nullable": False},
    "qtr":               {"data_type": "text",      "nullable": False},
    "area_title":        {"data_type": "text",      "nullable": True},
    "own_title":         {"data_type": "text",      "nullable": True},
    "industry_title":    {"data_type": "text",      "nullable": True},
    "qtrly_estabs":      {"data_type": "bigint",    "nullable": True},
    "month1_emplvl":     {"data_type": "bigint",    "nullable": True},
    "month2_emplvl":     {"data_type": "bigint",    "nullable": True},
    "month3_emplvl":     {"data_type": "bigint",    "nullable": True},
    "total_qtrly_wages": {"data_type": "bigint",    "nullable": True},
    "avg_wkly_wage":     {"data_type": "bigint",    "nullable": True},
    "_source_url":       {"data_type": "text",      "nullable": True},
    "_ingested_at":      {"data_type": "timestamp", "nullable": True},
}


def _make_id(row: dict) -> str:
    return "|".join([
        str(row.get("area_fips", "")),
        str(row.get("own_code", "")),
        str(row.get("industry_code", "")),
        str(row.get("size_code", "")),
        str(row.get("year", "")),
        str(row.get("qtr", "")),
    ])


def _coerce_int(v) -> int | None:
    if v in (None, "", " "):
        return None
    try:
        return int(str(v).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


@dlt.resource(
    name="bls_qcew",
    write_disposition="merge",
    primary_key="id",
    columns=_BLS_QCEW_COLUMNS,
)
def bls_qcew_resource(quarters: list[tuple[int, str]]):
    """
    Fetches BLS QCEW JSON area files for the 3 SWFL geographies across
    the requested quarters. Filters to industry_code="10" (all industries).
    Stores all 5 ownership codes so the TS connector can isolate
    private-sector (own_code=5) from government wages.
    """
    ingested_at = datetime.now(timezone.utc).isoformat()

    for year, qtr in quarters:
        for _geo_key, fips in AREA_FIPS.items():
            url = f"{BLS_QCEW_BASE_URL}/{year}/{qtr}/area/{fips}.csv"
            resp = requests.get(url, timeout=60)
            resp.raise_for_status()

            reader = csv.DictReader(io.StringIO(resp.text))
            for row in reader:
                if str(row.get("industry_code", "")).strip() != "10":
                    continue
                yield {
                    "id":                _make_id(row),
                    "area_fips":         str(row.get("area_fips", fips)),
                    "own_code":          str(row.get("own_code", "")),
                    "industry_code":     str(row.get("industry_code", "10")),
                    "agglvl_code":       str(row.get("agglvl_code", "")),
                    "size_code":         str(row.get("size_code", "0")),
                    "year":              int(row.get("year", year)),
                    "qtr":               str(row.get("qtr", qtr)),
                    "area_title":        row.get("area_title"),
                    "own_title":         row.get("own_title"),
                    "industry_title":    row.get("industry_title"),
                    "qtrly_estabs":      _coerce_int(row.get("qtrly_estabs")),
                    "month1_emplvl":     _coerce_int(row.get("month1_emplvl")),
                    "month2_emplvl":     _coerce_int(row.get("month2_emplvl")),
                    "month3_emplvl":     _coerce_int(row.get("month3_emplvl")),
                    "total_qtrly_wages": _coerce_int(row.get("total_qtrly_wages")),
                    "avg_wkly_wage":     _coerce_int(row.get("avg_wkly_wage")),
                    "_source_url":       url,
                    "_ingested_at":      ingested_at,
                }
