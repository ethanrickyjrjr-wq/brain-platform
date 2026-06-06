"""Pull Collier County parcels from the FDOR Statewide Cadastral FeatureServer
and merge them into data_lake.collier_parcels (Tier 2).

Parcel-grain source giving Collier the two things the Redfin market brain can't:
the Save-Our-Homes gap (JV_HMSTD vs AV_HMSTD) and a true parcel count. Mirrors
the leepa loader (ArcGIS pagination + chunked dlt merge) but single-layer.
"""
from __future__ import annotations

import time

import requests

from ingest.lib.arcgis_paginator import arcgis_count
from ingest.lib.coercion import coerce_float as _coerce_float, coerce_int as _coerce_int
from ingest.lib.guards import assert_vs_canonical

from .constants import COLLIER_CADASTRAL_URL, COLLIER_CO_NO_WHERE, OUT_FIELDS, PAGE_SIZE

# Tier-2 column hints — PARCEL_ID is the parcel key (PK). Value fields drive the
# SOH gap; sale + zip + use-code fields are kept for future parcel-velocity and
# per-ZIP drill work (the Redfin brain has no parcel detail).
_TIER2_COLUMNS: dict = {
    "parcel_id": {"data_type": "text", "nullable": False, "primary_key": True},
    "jv":        {"data_type": "double", "nullable": True},  # just (market) value
    "jv_hmstd":  {"data_type": "double", "nullable": True},  # just value, homestead portion
    "av_hmstd":  {"data_type": "double", "nullable": True},  # assessed value, homestead portion (SOH-capped)
    "av_sd":     {"data_type": "double", "nullable": True},
    "av_nsd":    {"data_type": "double", "nullable": True},
    "tv_nsd":    {"data_type": "double", "nullable": True},
    "sale_yr1":  {"data_type": "bigint", "nullable": True},
    "sale_mo1":  {"data_type": "bigint", "nullable": True},
    "qual_cd1":  {"data_type": "text", "nullable": True},
    "vi_cd1":    {"data_type": "text", "nullable": True},
    "phy_zipcd": {"data_type": "text", "nullable": True},
    "dor_uc":    {"data_type": "text", "nullable": True},
    "pa_uc":     {"data_type": "text", "nullable": True},
}


def _normalize(attr_rows: list[dict]) -> list[dict]:
    """Map verbatim ArcGIS attribute keys -> snake_case, coerce, drop no-PARCEL_ID."""
    out: list[dict] = []
    for a in attr_rows:
        pid = a.get("PARCEL_ID")
        if not pid:
            continue
        out.append({
            "parcel_id": str(pid),
            "jv":        _coerce_float(a.get("JV")),
            "jv_hmstd":  _coerce_float(a.get("JV_HMSTD")),
            "av_hmstd":  _coerce_float(a.get("AV_HMSTD")),
            "av_sd":     _coerce_float(a.get("AV_SD")),
            "av_nsd":    _coerce_float(a.get("AV_NSD")),
            "tv_nsd":    _coerce_float(a.get("TV_NSD")),
            "sale_yr1":  _coerce_int(a.get("SALE_YR1")),
            "sale_mo1":  _coerce_int(a.get("SALE_MO1")),
            "qual_cd1":  (str(a["QUAL_CD1"]) if a.get("QUAL_CD1") not in (None, "") else None),
            "vi_cd1":    (str(a["VI_CD1"]) if a.get("VI_CD1") not in (None, "") else None),
            "phy_zipcd": (str(a["PHY_ZIPCD"]) if a.get("PHY_ZIPCD") not in (None, "") else None),
            "dor_uc":    (str(a["DOR_UC"]) if a.get("DOR_UC") not in (None, "") else None),
            "pa_uc":     (str(a["PA_UC"]) if a.get("PA_UC") not in (None, "") else None),
        })
    return out


def _make_resource(chunk: list[dict]):
    """Zero-arg dlt resource factory (closes over `chunk` to dodge dlt's
    mutable-default-arg spec error — same pattern as the leepa loader)."""
    import dlt

    @dlt.resource(
        table_name="collier_parcels",
        write_disposition="merge",
        primary_key="parcel_id",
        columns=_TIER2_COLUMNS,
    )
    def collier_parcel_rows():
        yield from chunk

    return collier_parcel_rows


def _promote_to_tier2(rows: list[dict], chunk_size: int = 5_000) -> None:
    """Chunked merge into data_lake.collier_parcels (364k rows — replace blows the
    Supabase pooler; merge + 5k chunks stays under the connection timeout)."""
    import secrets as _secrets

    import dlt

    total = len(rows)
    n_chunks = (total + chunk_size - 1) // chunk_size
    for i in range(0, total, chunk_size):
        chunk = rows[i : i + chunk_size]
        pipeline = dlt.pipeline(
            pipeline_name=f"collier_parcels_t2_{_secrets.token_hex(4)}",
            destination="postgres",
            dataset_name="data_lake",
        )
        load_info = pipeline.run(_make_resource(chunk)())
        load_info.raise_on_failed_jobs()
        print(f"  collier_parcels chunk {i // chunk_size + 1}/{n_chunks} ({len(chunk)} rows)")


def _iter_collier_attrs(page_size: int = PAGE_SIZE):
    """Keyset pagination by OBJECTID.

    The shared resultOffset paginator caps at 100,000 features on this hosted
    ArcGIS Online FeatureServer (verified: it returned exactly 100k of 364,827).
    Cursoring on OBJECTID (where OBJECTID > last, ordered ascending) sidesteps the
    offset ceiling and retrieves the full Collier set.
    """
    out_fields = OUT_FIELDS + ",OBJECTID"
    last_oid = -1
    while True:
        params = {
            "where": f"({COLLIER_CO_NO_WHERE}) AND OBJECTID>{last_oid}",
            "outFields": out_fields,
            "orderByFields": "OBJECTID ASC",
            "resultRecordCount": page_size,
            "returnGeometry": "false",
            "f": "json",
        }
        data = None
        for attempt in range(3):
            try:
                resp = requests.get(COLLIER_CADASTRAL_URL, params=params, timeout=120)
                if resp.status_code >= 500 and attempt < 2:
                    time.sleep(2**attempt)
                    continue
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2**attempt)

        features = data.get("features", []) if data else []
        if not features:
            break
        max_oid = last_oid
        for feat in features:
            attrs = feat.get("attributes", {})
            oid = attrs.get("OBJECTID")
            if isinstance(oid, int) and oid > max_oid:
                max_oid = oid
            yield attrs
        # No forward progress or short page → done (guards against an infinite loop).
        if len(features) < page_size or max_oid == last_oid:
            break
        last_oid = max_oid


def fetch_collier_parcels() -> list[dict]:
    """Fetch all Collier (CO_NO=21) parcels via OBJECTID keyset paging, normalized."""
    return _normalize(list(_iter_collier_attrs()))


def ingest_collier_parcels() -> int:
    """Pull Collier parcels from the FDOR cadastral and promote to Tier 2."""
    canonical = arcgis_count(COLLIER_CADASTRAL_URL, where=COLLIER_CO_NO_WHERE)
    rows = fetch_collier_parcels()
    if not rows:
        print("collier_parcels: 0 rows — aborting Tier 2 promotion")
        return 0
    assert_vs_canonical(len(rows), canonical, label="collier parcels")
    _promote_to_tier2(rows)
    print(f"collier_parcels: merged {len(rows)} parcels into data_lake.collier_parcels")
    return len(rows)
