import csv
import io
import requests
from datetime import datetime, timezone

import dlt

from .constants import BLS_QCEW_BASE_URL, AREA_FIPS


def _find_latest_quarter(
    probe_fips: str = "12071",
    _now_year: int | None = None,
    _now_month: int | None = None,
) -> tuple[int, str]:
    """
    Back-step from the previous calendar quarter until BLS returns a
    non-empty JSON array for probe_fips. QCEW typically lags 2 quarters.
    _now_year/_now_month are injection points for unit tests.
    """
    now = datetime.now(timezone.utc)
    year = _now_year if _now_year is not None else now.year
    month = _now_month if _now_month is not None else now.month

    # Start one quarter before the current calendar quarter (current Q is never ready)
    qtr = (month - 1) // 3 + 1   # 1–4, current quarter
    qtr -= 1
    if qtr == 0:
        qtr, year = 4, year - 1

    for _ in range(6):
        url = f"{BLS_QCEW_BASE_URL}/{year}/{qtr}/area/{probe_fips}.csv"
        try:
            resp = requests.get(url, timeout=30)
            if resp.ok:
                reader = csv.DictReader(io.StringIO(resp.text))
                if next(reader, None) is not None:
                    return year, str(qtr)
        except Exception:
            pass
        qtr -= 1
        if qtr == 0:
            qtr, year = 4, year - 1

    raise RuntimeError(
        "BLS QCEW: could not find latest available quarter within 6 back-steps"
    )


def run() -> None:
    from .resources import bls_qcew_resource  # local import: pipeline.py is importable before Task 4

    latest_year, latest_qtr = _find_latest_quarter()
    prior_year = latest_year - 1
    prior_qtr = latest_qtr   # same quarter number, one year back

    quarters: list[tuple[int, str]] = [(latest_year, latest_qtr), (prior_year, prior_qtr)]
    print(
        f"Ingesting BLS QCEW: "
        f"{latest_year}-Q{latest_qtr} + {prior_year}-Q{prior_qtr} "
        f"for {len(AREA_FIPS)} areas..."
    )

    pipeline = dlt.pipeline(
        pipeline_name="bls_qcew",
        destination="postgres",
        dataset_name="data_lake",
    )
    load_info = pipeline.run(bls_qcew_resource(quarters))
    load_info.raise_on_failed_jobs()
    print("BLS QCEW pipeline complete.")


if __name__ == "__main__":
    run()
