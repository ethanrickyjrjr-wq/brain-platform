import argparse
import sys

import dlt

from .constants import NFHL_LAYERS
from .resources import ingest_nfhl_layer, ingest_nfip_claims


def run():
    inv = dlt.pipeline(pipeline_name="tier1_inventory", destination="postgres", dataset_name="data_lake")
    for layer in NFHL_LAYERS:
        print(f"Ingesting NFHL layer: {layer['name']}")
        try:
            ingest_nfhl_layer(inv, layer)
        except Exception as exc:
            print(f"WARNING: NFHL layer {layer['name']} failed — {exc}. Skipping.")
    print("Ingesting NFIP Claims...")
    try:
        ingest_nfip_claims(inv)
    except Exception as exc:
        print(f"WARNING: NFIP Claims failed — {exc}. Skipping.")
    print("FEMA pipeline complete.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="FEMA NFIP/NFHL ingest pipeline.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate only; skip dlt write.")
    args = parser.parse_args(argv)

    if args.dry_run:
        from ingest.lib.arcgis_paginator import paginate_arcgis
        from ingest.lib.geo_utils import FL_BBOX

        from .resources import _fetch_all_nfip_claims

        for layer in NFHL_LAYERS:
            print(f"fema dry-run NFHL {layer['name']}: fetching...")
            features = list(paginate_arcgis(layer["url"], bbox=FL_BBOX))
            print(f"fema dry-run NFHL {layer['name']}: {len(features)} features")
            if features:
                print("first feature:", features[0])

        print("fema dry-run NFIP claims: fetching...")
        claims = _fetch_all_nfip_claims()
        print(f"fema dry-run NFIP claims: {len(claims)} rows")
        if claims:
            print("first row:", claims[0])
        return 0

    run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
