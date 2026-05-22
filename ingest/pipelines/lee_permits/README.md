# lee_permits ingest

Lee County Accela building permits → Tier 2 Postgres via Firecrawl + dlt.

## Live run

1. Confirm `FIRECRAWL_API_KEY` in `.env` (invoke `firecrawl-build-onboarding` if missing).
2. Confirm `SUPABASE_PG_*` creds in `.dlt/secrets.toml`.
3. Run the DDL: `docs/sql/20260522_lee_building_permits.sql` (manual paste into Supabase SQL editor).
4. Run: `python -m ingest.pipelines.lee_permits.pipeline --start 2023-01-01 --end <today>`

## Firecrawl interact recipe (captured at first run)

The Accela portal uses ASP.NET viewstate; a static `/scrape` call won't submit
the date-range form. The working recipe uses `/interact`:

1. Navigate to https://accela.leegov.com/CitizenAccess/Cap/CapHome.aspx?module=Building
2. Fill the "From Date" + "To Date" inputs
3. Click "Search"
4. Wait for the result table (selector: `table.ACA_GridView`)
5. For each page: scrape HTML, click "Next", repeat until "Next" is disabled

Record the literal selectors + interact JSON at first successful run.

## Schema

See `docs/sql/20260522_lee_building_permits.sql`.

## Notes

- Permit-type → 5-bucket classification lives in `buckets.py` (pure function, fully tested).
- Detail-page lat/lon enrichment is OPTIONAL in v1; if Accela list view doesn't
  surface coordinates, the corridor-assignment step in the brain falls back to
  ZIP-centroid + nearest-corridor heuristic (documented in pack header).
