import dlt
from .resources import census_cbp_fl


def run():
    pipeline = dlt.pipeline(
        pipeline_name="census_cbp",
        destination="postgres",
        dataset_name="data_lake",
    )
    load_info = pipeline.run(census_cbp_fl())
    print(load_info)


if __name__ == "__main__":
    run()
