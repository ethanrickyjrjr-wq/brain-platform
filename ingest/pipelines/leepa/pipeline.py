import argparse
import sys

import dlt

from .resources import ingest_leepa_parcels, ingest_leepa_parcels_value


def run():
    inv = dlt.pipeline(pipeline_name="tier1_inventory", destination="postgres", dataset_name="data_lake")
    print("Ingesting LeePA parcels (layer 0 geometry -> Tier 1)...")
    ingest_leepa_parcels(inv)
    print("Ingesting LeePA value/use/sale layers (9/12/10 -> Tier 1 + Tier 2 leepa_parcels)...")
    ingest_leepa_parcels_value(inv)
    print("LeePA pipeline complete.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="LeePA parcels ingest pipeline.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate only; skip dlt write.")
    args = parser.parse_args(argv)

    if args.dry_run:
        from ingest.lib.arcgis_paginator import paginate_arcgis, paginate_arcgis_tabular

        from .constants import (
            LEEPA_JUST_VALUE_URL,
            LEEPA_LAST_SALE_URL,
            LEEPA_PARCELS_URL,
            LEEPA_USE_CODES_URL,
        )

        print("leepa dry-run: fetching parcel geometry...")
        features = list(paginate_arcgis(LEEPA_PARCELS_URL))
        print(f"leepa dry-run parcels: {len(features)} features")
        if features:
            print("first feature:", features[0])

        for name, url in [
            ("just_value", LEEPA_JUST_VALUE_URL),
            ("use_codes", LEEPA_USE_CODES_URL),
            ("last_sale", LEEPA_LAST_SALE_URL),
        ]:
            print(f"leepa dry-run {name}: fetching...")
            rows = list(paginate_arcgis_tabular(url))
            print(f"leepa dry-run {name}: {len(rows)} rows")
            if rows:
                print("first row:", rows[0])

        return 0

    run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
