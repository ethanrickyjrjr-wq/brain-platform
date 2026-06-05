import argparse
import sys

import dlt

from .resources import noaa_ghcn_rainfall_resource, build_years


def run() -> None:
    years = build_years()
    print(f"noaa_ghcn_rainfall: ingesting years {years[0]}–{years[-1]} for SWFL anchor stations...")

    pipeline = dlt.pipeline(
        pipeline_name="noaa_ghcn_rainfall",
        destination="postgres",
        dataset_name="data_lake",
    )
    load_info = pipeline.run(noaa_ghcn_rainfall_resource(years))
    load_info.raise_on_failed_jobs()
    print("noaa_ghcn_rainfall pipeline complete.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NOAA GHCN-Daily rainfall ingest pipeline.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and validate only; skip dlt write.",
    )
    args = parser.parse_args(argv)

    if args.dry_run:
        years = build_years()
        print(f"noaa_ghcn_rainfall dry-run: fetching {years[0]}–{years[-1]}...")
        rows = list(noaa_ghcn_rainfall_resource(years))
        print(f"noaa_ghcn_rainfall dry-run: {len(rows)} rows")
        if rows:
            print("first row:", rows[0])
        return 0

    run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
