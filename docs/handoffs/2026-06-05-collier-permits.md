# S2 — Collier Permits Publish-Lag Fix Handoff (2026-06-05)

**Dependency:** None — run in parallel with all other Sonnet tasks.
**Tier:** Sonnet (< 20 lines of change, no output-shape impact).
**Open check to open:** `collier_permits_lag_fix`.

---

## Goal

The collier-permits-monthly GHA goes RED every month because `download_month(year, month)` hard-raises
when Collier County hasn't posted the prior calendar month yet. Fix: fall back to the latest-available
month instead of crashing.

## Verified start point

**Error (GHA run 27021030444):** `ValueError: No issued XLSX found for 2026-05. Most recent 6 available:
[(2026,4)…]`

This is NOT a WAF/scrape break. The listing page fetches fine; Collier just publishes on a lag.

**Existing helper (already there — use it):**
`ingest/pipelines/collier_permits/fetcher.py` → `download_latest_issued()`:

```python
def download_latest_issued() -> tuple[bytes, str]:
    """Download the most recent issued XLSX from the listing page."""
    reports = discover_issued_reports()
    if not reports:
        raise ValueError("No issued XLSX reports found on listing page.")
    latest = reports[0]
    return download_month(latest.year, latest.month)
```

## The fix (3 lines in pipeline.py)

In `ingest/pipelines/collier_permits/pipeline.py`, function `run_pipeline`:

```python
def run_pipeline(year: int, month: int) -> None:
    try:
        xlsx_bytes, filename = download_month(year, month)
    except ValueError as exc:
        print(f"collier_permits: {exc} — falling back to latest available.")
        xlsx_bytes, filename = download_latest_issued()
    ...
```

Apply the same fallback in the `--dry-run` branch of `main()`.

**Why this is safe:** `dlt` merges on `permit_number`. Re-pulling April until May lands is idempotent — no
duplicates, no data loss.

## Vendor-First check

Verify Collier's actual publish schedule: when does the prior month's issued-permits XLSX actually appear?
WebFetch the listing page (`LISTING_PAGE_URL` in `collier_permits/constants.py`) and check the most recent
entries. If Collier consistently publishes mid-month, consider shifting the cron from the 1st to the 15th
(edit `.github/workflows/collier-permits-monthly.yml`).

## Verify

```sh
# Simulate a not-yet-published month (any month newer than what's on the listing page)
python -m ingest.pipelines.collier_permits.pipeline --month 2099-01 --dry-run
# Must: exit 0, print "falling back to latest available", print row count from the real latest month
```

Existing tests must stay green: `pytest ingest/pipelines/collier_permits/ -v`
