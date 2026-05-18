"""
USGS Water Services dlt pipeline.

Two modes via CLI:
  python -m ingest.pipelines.usgs.pipeline                       # full backfill
  python -m ingest.pipelines.usgs.pipeline --modified-since P7D  # nightly
  python -m ingest.pipelines.usgs.pipeline --modified-since P90D # monthly

After the dlt run, issues a post-ingest UPDATE on data_lake.usgs_sites to
populate parameter_cds from data_lake.usgs_daily (spec §7) — zero extra
HTTP calls, naturally accurate to what we actually hold.
"""

import argparse
import sys

import dlt
import psycopg2


def _post_ingest_rollup() -> None:
    """
    UPDATE usgs_sites.parameter_cds from a GROUP BY rollup of usgs_daily.
    Reads Postgres creds from the same dlt secrets the resources just used.
    """
    creds = dlt.secrets["destination.postgres.credentials"]
    conn = psycopg2.connect(
        host=creds["host"],
        port=int(creds["port"]),
        dbname=creds["database"],
        user=creds["username"],
        password=creds["password"],
        sslmode="require",
    )
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE data_lake.usgs_sites s
                    SET parameter_cds = sub.cds,
                        refreshed_at  = now()
                    FROM (
                        SELECT site_no,
                               jsonb_agg(DISTINCT parameter_cd ORDER BY parameter_cd) AS cds
                        FROM data_lake.usgs_daily
                        GROUP BY site_no
                    ) sub
                    WHERE s.site_no = sub.site_no;
                    """
                )
                print(f"post-ingest rollup: updated {cur.rowcount} usgs_sites rows")
    finally:
        conn.close()


def run(modified_since: str | None = None) -> None:
    from .resources import usgs_daily_resource, usgs_sites_resource

    if modified_since:
        print(f"USGS pipeline: incremental (modifiedSince={modified_since})")
    else:
        print("USGS pipeline: full backfill (year-chunked per parameterCd)")

    pipeline = dlt.pipeline(
        pipeline_name="usgs",
        destination="postgres",
        dataset_name="data_lake",
    )

    # Sites first so post-ingest rollup has rows to UPDATE on.
    sites_info = pipeline.run(usgs_sites_resource())
    sites_info.raise_on_failed_jobs()

    daily_info = pipeline.run(usgs_daily_resource(modified_since=modified_since))
    daily_info.raise_on_failed_jobs()

    _post_ingest_rollup()
    print("USGS pipeline complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="USGS Water Services dlt pipeline")
    parser.add_argument(
        "--modified-since",
        type=str,
        default=None,
        help='ISO 8601 duration, e.g. "P7D" (last 7 days) or "P90D" (last 90 days). '
             'Omit for full backfill.',
    )
    args = parser.parse_args()
    try:
        run(modified_since=args.modified_since)
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        sys.exit(130)


if __name__ == "__main__":
    main()
