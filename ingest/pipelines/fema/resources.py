from datetime import date

import dlt
import requests

from ingest.lib.arcgis_paginator import paginate_arcgis
from ingest.lib.geo_utils import FL_BBOX
from ingest.lib.storage_uploader import upload_csv_gz, upload_geojson_gz, write_tier1_pointer
from .constants import GEOMETRY_BUCKET, NFIP_CLAIMS_URL, TABULAR_BUCKET


# Tier 2 column hints for data_lake.fema_nfip_claims.
# Pin the 15 fields env-swfl actually reads. OpenFEMA FimaNfipClaims has ~50
# columns; everything outside this set is dropped (geometry, modifier dates,
# indicator flags, repetitive-loss markers). v2 can extend if needed.
_TEXT_COLS: tuple[str, ...] = (
    "id", "state", "county_code", "reported_city", "reported_zipcode", "flood_zone",
)
_INT_COLS: tuple[str, ...] = (
    "year_of_loss", "occupancy_type", "number_of_floors_insured",
)
_DOUBLE_COLS: tuple[str, ...] = (
    "amount_paid_on_building_claim",
    "amount_paid_on_contents_claim",
    "amount_paid_on_ico_claim",
    "building_property_value",
    "building_damage_amount",
)
_DATE_COLS: tuple[str, ...] = ("date_of_loss",)

_TIER2_NFIP_COLUMNS: dict = {
    "id": {"data_type": "text", "nullable": False, "primary_key": True},
    **{c: {"data_type": "bigint", "nullable": True} for c in _INT_COLS},
    **{c: {"data_type": "double", "nullable": True} for c in _DOUBLE_COLS},
    **{c: {"data_type": "date",   "nullable": True} for c in _DATE_COLS},
    **{c: {"data_type": "text",   "nullable": True} for c in _TEXT_COLS if c != "id"},
}


def _coerce_int(v):
    if v in (None, ""):
        return None
    return int(v)


def _coerce_float(v):
    if v in (None, ""):
        return None
    return float(v)


def _coerce_date(v):
    """OpenFEMA emits ISO-8601 with a T-separator and Z suffix; postgres `date` wants YYYY-MM-DD."""
    if v in (None, ""):
        return None
    s = str(v)
    return s.split("T")[0] if "T" in s else s[:10]


def _normalize_nfip(raw: dict) -> dict:
    """Map a raw OpenFEMA FimaNfipClaims row to the Tier 2 row shape (15 columns)."""
    return {
        "id":                                raw.get("id"),
        "year_of_loss":                      _coerce_int(raw.get("yearOfLoss")),
        "date_of_loss":                      _coerce_date(raw.get("dateOfLoss")),
        "state":                             raw.get("state"),
        "county_code":                       raw.get("countyCode"),
        "reported_city":                     raw.get("reportedCity"),
        "reported_zipcode":                  raw.get("reportedZipcode"),
        "flood_zone":                        raw.get("floodZone"),
        "occupancy_type":                    _coerce_int(raw.get("occupancyType")),
        "number_of_floors_insured":          _coerce_int(raw.get("numberOfFloorsInsured")),
        "amount_paid_on_building_claim":     _coerce_float(raw.get("amountPaidOnBuildingClaim")),
        "amount_paid_on_contents_claim":     _coerce_float(raw.get("amountPaidOnContentsClaim")),
        "amount_paid_on_ico_claim":          _coerce_float(raw.get("amountPaidOnIncreasedCostOfComplianceClaim")),
        "building_property_value":           _coerce_float(raw.get("buildingPropertyValue")),
        "building_damage_amount":            _coerce_float(raw.get("buildingDamageAmount")),
    }


def _promote_nfip_to_tier2(rows: list[dict]) -> None:
    """Write the normalized NFIP claims rows to data_lake.fema_nfip_claims (replace disposition)."""
    @dlt.resource(
        table_name="fema_nfip_claims",
        write_disposition="replace",
        columns=_TIER2_NFIP_COLUMNS,
    )
    def fema_nfip_rows():
        for row in rows:
            yield _normalize_nfip(row)

    tier2_pipeline = dlt.pipeline(
        pipeline_name="fema_nfip_tier2",
        destination="postgres",
        dataset_name="data_lake",
    )
    load_info = tier2_pipeline.run(fema_nfip_rows())
    # Mirror fdot: without this, dlt swallows per-job failures into LoadInfo and the
    # process exits 0 with a half-empty table — Tier 1 succeeded, Tier 2 silently broke.
    load_info.raise_on_failed_jobs()


def _fetch_all_nfip_claims() -> list[dict]:
    """Paginate OpenFEMA FimaNfipClaims for Florida only. Retries 5xx on each page.
    Full national dataset is 2M+ rows and the API 503s above ~900k offset; FL-only
    (~200-400k rows) stays well within that threshold.
    Inter-page sleep + exponential backoff prevents rate-limit 503s mid-fetch."""
    import time
    rows, skip, page_size = [], 0, 500
    while True:
        resp = None
        for attempt in range(6):
            try:
                resp = requests.get(
                    NFIP_CLAIMS_URL,
                    params={"$skip": skip, "$top": page_size, "$format": "json",
                            "$filter": "state eq 'FL'"},
                    timeout=120,
                )
                resp.raise_for_status()
                break
            except requests.HTTPError:
                if attempt == 5 or resp.status_code < 500:
                    raise
                wait = min(30 * 2 ** attempt, 300)
                print(f"  FEMA API {resp.status_code} at skip={skip}, retry {attempt+1}/5 in {wait}s...")
                time.sleep(wait)
            except requests.ConnectionError:
                if attempt == 5:
                    raise
                wait = min(30 * 2 ** attempt, 300)
                print(f"  FEMA connection error at skip={skip}, retry {attempt+1}/5 in {wait}s...")
                time.sleep(wait)
        data = resp.json()
        batch = data.get("value") or data.get("FimaNfipClaims", [])
        if not batch:
            break
        rows.extend(batch)
        if skip % 10000 == 0:
            print(f"  FEMA NFIP: fetched {len(rows):,} rows (skip={skip})...")
        if len(batch) < page_size:
            break
        skip += len(batch)
        time.sleep(1.5)
    return rows


def ingest_nfhl_layer(pipeline, layer: dict) -> None:
    today = date.today().isoformat()
    name = layer["name"]
    features = list(paginate_arcgis(layer["url"], bbox=FL_BBOX))
    object_path = f"fema/{name}/{today}.geojson.gz"
    upload_geojson_gz(GEOMETRY_BUCKET, object_path, features)
    write_tier1_pointer(pipeline, f"fema_{name}", GEOMETRY_BUCKET, object_path, len(features), layer["url"])


def ingest_nfip_claims(pipeline) -> None:
    today = date.today().isoformat()
    rows = _fetch_all_nfip_claims()
    if not rows:
        return

    # Tier 1 (cold archive): full raw CSV.gz + pointer row in data_lake._tier1_inventory.
    object_path = f"fema/nfip_claims/{today}.csv.gz"
    upload_csv_gz(TABULAR_BUCKET, object_path, rows, list(rows[0].keys()))
    write_tier1_pointer(pipeline, "fema_nfip_claims", TABULAR_BUCKET, object_path, len(rows), NFIP_CLAIMS_URL)

    # Tier 2 (hot consumer cache for env-swfl brain): normalized 15-column table in data_lake.fema_nfip_claims.
    _promote_nfip_to_tier2(rows)
