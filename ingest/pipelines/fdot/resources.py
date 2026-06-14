from datetime import date

import dlt

from ingest.lib.arcgis_paginator import paginate_arcgis
from ingest.lib.geo_utils import FL_BBOX
from ingest.lib.storage_uploader import upload_csv_gz
from ingest.lib.tier1_inventory import upsert_inventory_row
from ingest.lib.guards import assert_min_rows, VolumeGuardError
from .constants import FDOT_AADT_URL, TABULAR_BUCKET

# Volume-guard floors before the Tier-2 `replace` (THE BIBLE §0.2 rule 5).
# 93_295 = 90% of the 103,662 rows live 2026-06-13. The aadt non-null rate catches a
# silent vendor field rename (AADT missing → _coerce_int → None) that would otherwise
# replace the consumer table with traffic-less rows.
_MIN_ROWS = 93_295
_AADT_NONNULL_FLOOR = 0.50


# Tier 2 column hints — pin the 24 fields from FTO_PROD/MapServer/7 to explicit dlt types
# so the Postgres table schema is stable across re-ingests. Geometry (Shape) is dropped.
_TEXT_COLS: tuple[str, ...] = (
    "district", "cosite", "roadway", "desc_frm", "desc_to",
    "aadtflg", "kflg", "k100flg", "dflg", "tflg",
    "countydot", "county", "mng_dist",
)
_INT_COLS: tuple[str, ...] = ("objectid", "year_", "aadt")
_DOUBLE_COLS: tuple[str, ...] = (
    "begin_post", "end_post",
    "kfctr", "k100fctr", "dfctr", "tfctr",
    "shape_leng", "shape_length",
)

_TIER2_COLUMNS: dict = {
    **{c: {"data_type": "bigint", "nullable": True} for c in _INT_COLS},
    **{c: {"data_type": "double", "nullable": True} for c in _DOUBLE_COLS},
    **{c: {"data_type": "text",   "nullable": True} for c in _TEXT_COLS},
}


def _coerce_int(v):
    if v in (None, ""):
        return None
    return int(v)


def _coerce_float(v):
    if v in (None, ""):
        return None
    return float(v)


def _normalize(raw: dict) -> dict:
    """Map a raw FDOT MapServer feature property dict (24 fields + Shape geometry) to the Tier 2 row shape."""
    return {
        "objectid":     _coerce_int(raw.get("OBJECTID")),
        "year_":        _coerce_int(raw.get("YEAR_")),
        "district":     raw.get("DISTRICT"),
        "cosite":       raw.get("COSITE"),
        "roadway":      raw.get("ROADWAY"),
        "desc_frm":     raw.get("DESC_FRM"),
        "desc_to":      raw.get("DESC_TO"),
        "aadt":         _coerce_int(raw.get("AADT")),
        "aadtflg":      raw.get("AADTFLG"),
        "kflg":         raw.get("KFLG"),
        "k100flg":      raw.get("K100FLG"),
        "dflg":         raw.get("DFLG"),
        "tflg":         raw.get("TFLG"),
        "begin_post":   _coerce_float(raw.get("BEGIN_POST")),
        "end_post":     _coerce_float(raw.get("END_POST")),
        "kfctr":        _coerce_float(raw.get("KFCTR")),
        "k100fctr":     _coerce_float(raw.get("K100FCTR")),
        "dfctr":        _coerce_float(raw.get("DFCTR")),
        "tfctr":        _coerce_float(raw.get("TFCTR")),
        "shape_leng":   _coerce_float(raw.get("SHAPE_LENG")),
        "countydot":    raw.get("COUNTYDOT"),
        "county":       raw.get("COUNTY"),
        "mng_dist":     raw.get("MNG_DIST"),
        "shape_length": _coerce_float(raw.get("Shape_Length")),
    }


def _promote_to_tier2(rows: list[dict]) -> None:
    """Write the normalized FDOT AADT rows to data_lake.fdot_aadt_fl (replace disposition)."""
    @dlt.resource(
        table_name="fdot_aadt_fl",
        write_disposition="replace",
        columns=_TIER2_COLUMNS,
    )
    def fdot_aadt_rows():
        for row in rows:
            yield _normalize(row)

    tier2_pipeline = dlt.pipeline(
        pipeline_name="fdot_aadt_tier2",
        destination="postgres",
        dataset_name="data_lake",
    )
    load_info = tier2_pipeline.run(fdot_aadt_rows())
    # Without this, dlt swallows per-job failures into LoadInfo and the pipeline
    # exits 0 with a half-empty table — Tier 1 succeeded, Tier 2 silently broke.
    load_info.raise_on_failed_jobs()


def ingest_fdot_aadt(tier1_pipeline) -> None:
    today = date.today().isoformat()
    features = list(paginate_arcgis(FDOT_AADT_URL, bbox=FL_BBOX))
    if not features:
        print("FDOT AADT: 0 features returned — skipping upload")
        return
    rows = [f.get("properties", {}) for f in features]

    # ── Volume guard — gate the REAL pull before EITHER write (THE BIBLE §0.2 rule 5).
    # Fail fast (before the Tier-1 archive AND the Tier-2 replace) so a partial pull or
    # a silent AADT field rename can never overwrite the consumer table with bad data.
    normalized = [_normalize(r) for r in rows]
    assert_min_rows(len(normalized), _MIN_ROWS, label="fdot_aadt_fl")
    nonnull_aadt = sum(1 for r in normalized if r["aadt"] is not None)
    rate = nonnull_aadt / len(normalized) if normalized else 0.0
    print(f"  fdot_aadt_fl aadt non-null rate: {rate:.1%} ({nonnull_aadt:,}/{len(normalized):,})")
    if rate < _AADT_NONNULL_FLOOR:
        raise VolumeGuardError(
            f"[volume-guard] fdot_aadt_fl: aadt non-null {rate:.1%} < {_AADT_NONNULL_FLOOR:.0%} "
            f"floor — likely a vendor field rename; aborting before replace"
        )

    # Tier 1 (cold archive): full raw CSV.gz + pointer row in data_lake._tier1_inventory.
    object_path = f"fdot_aadt/{today}.csv.gz"
    upload_csv_gz(TABULAR_BUCKET, object_path, rows, list(rows[0].keys()))
    upsert_inventory_row(
        bucket=TABULAR_BUCKET, path=object_path, vintage=today,
        byte_size=None, pack_id="traffic-swfl", source_url=FDOT_AADT_URL,
    )

    # Tier 2 (hot consumer cache for traffic-swfl brain): normalized 24-column table in data_lake.fdot_aadt_fl.
    _promote_to_tier2(rows)
