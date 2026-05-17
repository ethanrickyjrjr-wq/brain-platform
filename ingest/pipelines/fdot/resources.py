from datetime import date

from ingest.lib.arcgis_paginator import paginate_arcgis
from ingest.lib.geo_utils import FL_BBOX
from ingest.lib.storage_uploader import upload_csv_gz, write_tier1_pointer
from .constants import FDOT_AADT_URL, TABULAR_BUCKET


def ingest_fdot_aadt(pipeline) -> None:
    today = date.today().isoformat()
    features = list(paginate_arcgis(FDOT_AADT_URL, bbox=FL_BBOX))
    if not features:
        print("FDOT AADT: 0 features returned — skipping upload")
        return
    rows = [f.get("properties", {}) for f in features]
    object_path = f"fdot_aadt/{today}.csv.gz"
    upload_csv_gz(TABULAR_BUCKET, object_path, rows, list(rows[0].keys()))
    write_tier1_pointer(pipeline, "fdot_aadt", TABULAR_BUCKET, object_path, len(rows), FDOT_AADT_URL)
