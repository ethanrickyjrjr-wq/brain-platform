import dlt
from .resources import ingest_fdot_aadt


def run():
    inv = dlt.pipeline(pipeline_name="tier1_inventory", destination="postgres", dataset_name="data_lake")
    print("Ingesting FDOT AADT stations...")
    ingest_fdot_aadt(inv)
    print("FDOT pipeline complete.")


if __name__ == "__main__":
    run()
