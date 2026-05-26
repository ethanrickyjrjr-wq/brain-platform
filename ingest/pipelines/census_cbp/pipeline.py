import argparse
import sys

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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Census CBP ingest pipeline.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate only; skip dlt write.")
    args = parser.parse_args(argv)

    if args.dry_run:
        print("census_cbp dry-run: fetching FL CBP data...")
        rows = list(census_cbp_fl())
        print(f"census_cbp dry-run: {len(rows)} rows")
        if rows:
            print("first row:", rows[0])
        return 0

    run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
