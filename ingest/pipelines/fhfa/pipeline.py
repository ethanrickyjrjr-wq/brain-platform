import argparse
import sys

import dlt

from .resources import fhfa_hpi_resource


def run():
    pipeline = dlt.pipeline(
        pipeline_name="fhfa_hpi",
        destination="postgres",
        dataset_name="data_lake",
    )
    print("Ingesting FHFA HPI master (~133k records)...")
    load_info = pipeline.run(fhfa_hpi_resource())
    load_info.raise_on_failed_jobs()
    print("FHFA HPI pipeline complete.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="FHFA HPI ingest pipeline.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate only; skip dlt write.")
    args = parser.parse_args(argv)

    if args.dry_run:
        print("fhfa dry-run: fetching FHFA HPI master...")
        rows = list(fhfa_hpi_resource())
        print(f"fhfa dry-run: {len(rows)} rows")
        if rows:
            print("first row:", rows[0])
        return 0

    run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
