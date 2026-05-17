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


if __name__ == "__main__":
    run()
