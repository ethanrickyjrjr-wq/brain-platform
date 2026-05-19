from datetime import date, datetime, timezone

import dlt

from ingest.lib.arcgis_paginator import (
    arcgis_count,
    paginate_arcgis,
    paginate_arcgis_tabular,
)
from ingest.lib.storage_uploader import upload_csv_gz, upload_geojson_gz, write_tier1_pointer
from .constants import (
    LEEPA_JUST_VALUE_URL,
    LEEPA_LAST_SALE_URL,
    LEEPA_PARCELS_URL,
    LEEPA_USE_CODES_URL,
    TABULAR_BUCKET,
)


def ingest_leepa_parcels(pipeline) -> None:
    today = date.today().isoformat()
    features = list(paginate_arcgis(LEEPA_PARCELS_URL))
    object_path = f"leepa/parcels/{today}.geojson.gz"
    upload_geojson_gz(TABULAR_BUCKET, object_path, features)
    write_tier1_pointer(pipeline, "leepa_parcels", TABULAR_BUCKET, object_path, len(features), LEEPA_PARCELS_URL)


# Tier 2 column hints — pin the 15-column joined parcel row to explicit dlt types so the
# Postgres table schema is stable across re-ingests. FOLIOID is the parcel key (PK).
_TIER2_LEEPA_COLUMNS: dict = {
    "folioid":              {"data_type": "text",   "nullable": False, "primary_key": True},
    "just_value":           {"data_type": "double", "nullable": True},
    "market_value":         {"data_type": "double", "nullable": True},
    "assessed_value":       {"data_type": "double", "nullable": True},
    "taxable_value":        {"data_type": "double", "nullable": True},
    "soh_cap":              {"data_type": "double", "nullable": True},
    "building_value":       {"data_type": "double", "nullable": True},
    "land_value":           {"data_type": "double", "nullable": True},
    "cap_difference":       {"data_type": "double", "nullable": True},
    "use_code":             {"data_type": "text",   "nullable": True},
    "use_description":      {"data_type": "text",   "nullable": True},
    "last_sale_amount":     {"data_type": "double", "nullable": True},
    "last_sale_date":       {"data_type": "date",   "nullable": True},
    "last_sale_instrument": {"data_type": "text",   "nullable": True},
    "last_sale_book_page":  {"data_type": "text",   "nullable": True},
}


def _coerce_float(v):
    if v in (None, "", "N/A", "n/a", "NA"):
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _coerce_esri_date(v):
    """Esri f=json date fields land as epoch milliseconds (int) or an ISO string."""
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(int(v) / 1000.0, tz=timezone.utc).date().isoformat()
    s = str(v)
    return s.split("T")[0] if "T" in s else s[:10]


def _join_leepa(use_rows: list[dict], value_rows: list[dict], sale_rows: list[dict]) -> list[dict]:
    """Left-join three layers on FOLIOID with the value layer as the spine (canonical parcel set)."""
    use_by_folio = {r.get("FOLIOID"): r for r in use_rows if r.get("FOLIOID")}
    sale_by_folio = {r.get("FOLIOID"): r for r in sale_rows if r.get("FOLIOID")}
    joined: list[dict] = []
    for v in value_rows:
        folio = v.get("FOLIOID")
        if not folio:
            continue
        u = use_by_folio.get(folio) or {}
        s = sale_by_folio.get(folio) or {}
        joined.append({
            "folioid":              folio,
            "just_value":           _coerce_float(v.get("Just")),
            "market_value":         _coerce_float(v.get("Market")),
            "assessed_value":       _coerce_float(v.get("Assessed")),
            "taxable_value":        _coerce_float(v.get("Taxable")),
            "soh_cap":              _coerce_float(v.get("SOHCap")),
            "building_value":       _coerce_float(v.get("Building")),
            "land_value":           _coerce_float(v.get("Land")),
            "cap_difference":       _coerce_float(v.get("CapDifference")),
            "use_code":             u.get("Code"),
            "use_description":      u.get("Description"),
            "last_sale_amount":     _coerce_float(s.get("Amount")),
            "last_sale_date":       _coerce_esri_date(s.get("DoS")),
            "last_sale_instrument": s.get("Instrument"),
            "last_sale_book_page":  s.get("ORBookPage"),
        })
    return joined


def _make_leepa_resource(chunk: list[dict]):
    """Factory that wraps a chunk in a dlt resource with zero parameters.

    dlt's spec_from_signature converts function args into a dataclass — mutable
    list defaults (_c=chunk) trigger a ValueError. Closing over `chunk` from an
    outer function scope avoids the issue because the resource has no params at all.
    """
    @dlt.resource(
        table_name="leepa_parcels",
        write_disposition="merge",
        primary_key="folioid",
        columns=_TIER2_LEEPA_COLUMNS,
    )
    def leepa_rows():
        yield from chunk
    return leepa_rows


def _promote_leepa_to_tier2(rows: list[dict], chunk_size: int = 5_000) -> None:
    """Write joined LeePA parcel rows to data_lake.leepa_parcels in chunked merge batches.

    replace disposition on 200k rows blows the Supabase pooler (same issue as FAF5).
    merge + 5k chunks keeps each dlt run well under the connection timeout.
    """
    import secrets as _secrets

    total = len(rows)
    n_chunks = (total + chunk_size - 1) // chunk_size
    for i in range(0, total, chunk_size):
        chunk = rows[i : i + chunk_size]
        pipeline = dlt.pipeline(
            pipeline_name=f"leepa_t2_{_secrets.token_hex(4)}",
            destination="postgres",
            dataset_name="data_lake",
        )
        load_info = pipeline.run(_make_leepa_resource(chunk)())
        load_info.raise_on_failed_jobs()
        print(f"  leepa_parcels chunk {i // chunk_size + 1}/{n_chunks} ({len(chunk)} rows)")


def ingest_leepa_parcels_value(tier1_pipeline) -> None:
    """Pull layers 9/10/12 (use codes, last qualified sale, just value), archive each as
    Tier 1 CSV.gz with pointer rows, then join on FOLIOID and promote to
    data_lake.leepa_parcels. Layers 13/14/15 are intentionally skipped — their fields
    are identical to layer 12, only their choropleth styling differs."""
    today = date.today().isoformat()

    layers = [
        ("just_value", LEEPA_JUST_VALUE_URL),
        ("use_codes",  LEEPA_USE_CODES_URL),
        ("last_sale",  LEEPA_LAST_SALE_URL),
    ]
    pulled: dict[str, list[dict]] = {}
    for name, url in layers:
        rows = list(paginate_arcgis_tabular(url))
        if not rows:
            print(f"leepa {name}: 0 rows — aborting Tier 2 promotion")
            return
        pulled[name] = rows
        object_path = f"leepa/{name}/{today}.csv.gz"
        upload_csv_gz(TABULAR_BUCKET, object_path, rows, list(rows[0].keys()))
        write_tier1_pointer(
            tier1_pipeline, f"leepa_{name}", TABULAR_BUCKET, object_path, len(rows), url,
        )

    # Fail-fast: layer 12 (just_value) is the canonical parcel set. If pagination dropped
    # >10% of rows, the join would be silently incomplete — abort before promotion so the
    # Tier 2 table never sees a stealth-truncated snapshot.
    canonical = arcgis_count(LEEPA_JUST_VALUE_URL)
    if canonical > 0 and len(pulled["just_value"]) < int(canonical * 0.9):
        raise RuntimeError(
            f"leepa just_value pagination returned {len(pulled['just_value'])} rows "
            f"vs canonical {canonical} (<90%) — aborting Tier 2 promotion to avoid silent data loss.",
        )

    joined = _join_leepa(pulled["use_codes"], pulled["just_value"], pulled["last_sale"])
    if not joined:
        return
    _promote_leepa_to_tier2(joined)
