import argparse
import sys

import dlt

from .resources import ingest_fdot_aadt


def run():
    inv = dlt.pipeline(pipeline_name="tier1_inventory", destination="postgres", dataset_name="data_lake")
    print("Ingesting FDOT AADT stations...")
    ingest_fdot_aadt(inv)
    print("FDOT pipeline complete.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="FDOT AADT ingest pipeline.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate only; skip dlt write.")
    args = parser.parse_args(argv)

    if args.dry_run:
        from ingest.lib.arcgis_paginator import paginate_arcgis
        from ingest.lib.geo_utils import FL_BBOX

        from .constants import FDOT_AADT_URL

        print("fdot dry-run: fetching AADT features...")
        features = list(paginate_arcgis(FDOT_AADT_URL, bbox=FL_BBOX))
        rows = [f.get("properties", {}) for f in features]
        print(f"fdot dry-run: {len(rows)} rows")
        if rows:
            print("first row:", rows[0])
        return 0

    run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
