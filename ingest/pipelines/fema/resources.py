from datetime import date

import dlt
import requests

from ingest.lib.arcgis_paginator import paginate_arcgis
from ingest.lib.geo_utils import FL_BBOX
from ingest.lib.guards import assert_min_rows, assert_vs_canonical, VolumeGuardError
from ingest.lib.storage_uploader import upload_csv_gz, upload_geojson_gz, write_tier1_pointer
from .constants import GEOMETRY_BUCKET, NFIP_CLAIMS_URL, TABULAR_BUCKET


# Tier 2 column hints for data_lake.fema_nfip_claims.
# Pin the 16 fields env-swfl actually reads. OpenFEMA FimaNfipClaims has ~70
# columns; everything outside this set is dropped (geometry, modifier dates,
# indicator flags, repetitive-loss markers). v2 can extend if needed.
# NOTE: v2 has no bare `floodZone` field — it exposes `ratedFloodZone` (zone the
# policy was rated under at loss time) and `floodZoneCurrent` (current FEMA zone).
# We capture both; flood_zone is the rated zone (the stable, claim-tied value).
_TEXT_COLS: tuple[str, ...] = (
    "id", "state", "county_code", "reported_city", "reported_zipcode",
    "flood_zone", "flood_zone_current",
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
    """Map a raw OpenFEMA FimaNfipClaims row to the Tier 2 row shape (16 columns).

    flood_zone reads `ratedFloodZone` (the zone the policy was rated under at the
    time of loss) and flood_zone_current reads `floodZoneCurrent`. OpenFEMA v2 has
    NO bare `floodZone` field — reading it silently nulled the whole column.
    """
    return {
        "id":                                raw.get("id"),
        "year_of_loss":                      _coerce_int(raw.get("yearOfLoss")),
        "date_of_loss":                      _coerce_date(raw.get("dateOfLoss")),
        "state":                             raw.get("state"),
        "county_code":                       raw.get("countyCode"),
        "reported_city":                     raw.get("reportedCity"),
        "reported_zipcode":                  raw.get("reportedZipCode"),
        "flood_zone":                        raw.get("ratedFloodZone"),
        "flood_zone_current":                raw.get("floodZoneCurrent"),
        "occupancy_type":                    _coerce_int(raw.get("occupancyType")),
        "number_of_floors_insured":          _coerce_int(raw.get("numberOfFloorsInTheInsuredBuilding")),
        "amount_paid_on_building_claim":     _coerce_float(raw.get("amountPaidOnBuildingClaim")),
        "amount_paid_on_contents_claim":     _coerce_float(raw.get("amountPaidOnContentsClaim")),
        "amount_paid_on_ico_claim":          _coerce_float(raw.get("amountPaidOnIncreasedCostOfComplianceClaim")),
        "building_property_value":           _coerce_float(raw.get("buildingPropertyValue")),
        "building_damage_amount":            _coerce_float(raw.get("buildingDamageAmount")),
    }


def _current_tier2_count() -> int | None:
    """Live row count of data_lake.fema_nfip_claims, for a dynamic volume floor.
    Vendor-First: derive the guard from reality, not a hardcoded number that drifts
    below the true count and lets a partial pull silently wipe rows. Returns None when
    the DB is unavailable (first run / no creds) so the guard no-ops, not false-fails."""
    import os
    try:
        import psycopg
    except ImportError:
        return None
    uri = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    if not uri:
        try:
            import re
            secrets = os.path.join(os.path.dirname(__file__), "..", "..", "..", ".dlt", "secrets.toml")
            txt = open(secrets, encoding="utf-8").read()

            def _v(k: str) -> str | None:
                m = re.search(r"^\s*" + k + r'\s*=\s*"?([^"\r\n]+?)"?\s*$', txt, re.M)
                return m.group(1) if m else None

            uri = f"postgresql://{_v('username')}:{_v('password')}@{_v('host')}:{_v('port')}/{_v('database')}"
        except Exception:
            return None
    try:
        with psycopg.connect(uri, connect_timeout=15) as conn:
            with conn.cursor() as cur:
                cur.execute("select count(*) from data_lake.fema_nfip_claims")
                return cur.fetchone()[0]
    except Exception:
        return None


def _promote_nfip_to_tier2(rows: list[dict]) -> None:
    """Write the normalized NFIP claims rows to data_lake.fema_nfip_claims (replace disposition).
    Volume floors (enough rows?) live in ingest_nfip_claims; here we guard data SHAPE."""
    # Normalize once so the OUTPUT column can be guarded BEFORE the destructive replace.
    normalized = [_normalize_nfip(r) for r in rows]

    # Tripwire (class fix): a silent vendor field-name break nulls a whole column while the
    # row count looks fine — exactly how reportedZipCode -> reportedZipcode stayed hidden for
    # weeks. Guard the pinned zip column pre-replace so a broken mapping can't wipe good data.
    nonnull_zip = sum(1 for r in normalized if (r.get("reported_zipcode") or "").strip())
    zip_rate = nonnull_zip / len(normalized) if normalized else 0.0
    print(f"  reported_zipcode non-null rate: {zip_rate:.1%} ({nonnull_zip:,}/{len(normalized):,})")
    if zip_rate < 0.5:
        raise VolumeGuardError(
            f"[volume-guard] fema_nfip_claims: reported_zipcode non-null {zip_rate:.1%} < 50% floor "
            f"— likely a vendor field-name break (verify the reportedZipCode mapping). Refusing to replace."
        )

    # Same tripwire for flood_zone (rated): OpenFEMA v2 dropped the bare `floodZone`
    # field for `ratedFloodZone` / `floodZoneCurrent`, so the old mapping silently
    # nulled the whole column — the second instance of the reportedZipCode break.
    # Hard-guard the rated zone pre-replace. flood_zone_current carries more
    # redaction, so log its rate for visibility but do NOT fail the load on it.
    nonnull_zone = sum(1 for r in normalized if (r.get("flood_zone") or "").strip())
    zone_rate = nonnull_zone / len(normalized) if normalized else 0.0
    nonnull_zone_cur = sum(1 for r in normalized if (r.get("flood_zone_current") or "").strip())
    zone_cur_rate = nonnull_zone_cur / len(normalized) if normalized else 0.0
    print(f"  flood_zone non-null rate: {zone_rate:.1%} ({nonnull_zone:,}/{len(normalized):,})")
    print(f"  flood_zone_current non-null rate: {zone_cur_rate:.1%} ({nonnull_zone_cur:,}/{len(normalized):,})")
    if zone_rate < 0.5:
        raise VolumeGuardError(
            f"[volume-guard] fema_nfip_claims: flood_zone non-null {zone_rate:.1%} < 50% floor "
            f"— likely a vendor field-name break (verify the ratedFloodZone mapping). Refusing to replace."
        )

    @dlt.resource(
        table_name="fema_nfip_claims",
        write_disposition="replace",
        columns=_TIER2_NFIP_COLUMNS,
    )
    def fema_nfip_rows():
        yield from normalized

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
    # $select ONLY the 16 fields _normalize_nfip reads (not all ~70 OpenFEMA
    # columns), at a large $top → the FL pull drops from ~50 min at $top=500 to
    # ~3 min and is far less prone to the chunked-stream drop that killed a wide
    # pull at skip~330k (2026-06-13). We cannot incrementally fetch (OpenFEMA
    # regenerates `id` every refresh — no stable key — so this is a full replace),
    # but we can fetch NARROW. Field names must match _normalize_nfip's raw.get()
    # keys exactly — a typo silently nulls that column (the floodZone class of bug);
    # the zip + flood_zone volume guards backstop the pinned ones.
    select = (
        "id,yearOfLoss,dateOfLoss,state,countyCode,reportedCity,reportedZipCode,"
        "ratedFloodZone,floodZoneCurrent,occupancyType,numberOfFloorsInTheInsuredBuilding,"
        "amountPaidOnBuildingClaim,amountPaidOnContentsClaim,"
        "amountPaidOnIncreasedCostOfComplianceClaim,buildingPropertyValue,"
        "buildingDamageAmount"
    )
    rows, skip, page_size = [], 0, 10000
    while True:
        resp = None
        for attempt in range(6):
            try:
                resp = requests.get(
                    NFIP_CLAIMS_URL,
                    params={"$skip": skip, "$top": page_size, "$format": "json",
                            "$filter": "state eq 'FL'", "$select": select},
                    timeout=240,
                )
                resp.raise_for_status()
                break
            except requests.HTTPError:
                if attempt == 5 or resp.status_code < 500:
                    raise
                wait = min(30 * 2 ** attempt, 300)
                print(f"  FEMA API {resp.status_code} at skip={skip}, retry {attempt+1}/5 in {wait}s...")
                time.sleep(wait)
            except (
                requests.ConnectionError,
                requests.Timeout,
                # FEMA's chunked stream drops mid-body on long pulls (observed at
                # skip~330k). It is NOT a subclass of ConnectionError, so without
                # this it kills the whole fetch one page short of the Tier-2 replace.
                requests.exceptions.ChunkedEncodingError,
            ):
                if attempt == 5:
                    raise
                wait = min(30 * 2 ** attempt, 300)
                print(f"  FEMA connection/stream error at skip={skip}, retry {attempt+1}/5 in {wait}s...")
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

    # Volume floor (Vendor-First): a partial pull (e.g. API 503 mid-page) must NOT replace a
    # full table. assert_min_rows is the absolute backstop; assert_vs_canonical compares against
    # the live row count so the floor tracks reality instead of a stale hardcoded constant.
    assert_min_rows(len(rows), 403_542, label="fema_nfip_claims")
    prior = _current_tier2_count()
    if prior:
        assert_vs_canonical(len(rows), prior, floor=0.95, label="fema_nfip_claims")

    # Tier 1 (cold archive): full raw CSV.gz + pointer row in data_lake._tier1_inventory.
    # Non-fatal: Tier 1 failures (S3 or dlt _tier1_inventory schema issues) must not
    # block Tier 2, which is the consumer-facing table env-swfl actually reads.
    object_path = f"fema/nfip_claims/{today}.csv.gz"
    try:
        upload_csv_gz(TABULAR_BUCKET, object_path, rows, list(rows[0].keys()))
        write_tier1_pointer(pipeline, "fema_nfip_claims", TABULAR_BUCKET, object_path, len(rows), NFIP_CLAIMS_URL)
        print(f"  Tier 1 pointer written: {len(rows):,} rows → {object_path}")
    except Exception as exc:
        print(f"  WARNING: Tier 1 write failed (non-fatal) — {exc}")

    # Tier 2 (hot consumer cache for env-swfl brain): normalized 15-column table in data_lake.fema_nfip_claims.
    print(f"  Promoting {len(rows):,} rows to Tier 2 (data_lake.fema_nfip_claims)...")
    _promote_nfip_to_tier2(rows)
    print(f"  Tier 2 load complete.")
