# lee_permits ingest

Lee County Accela building permits → Tier 2 Postgres via Firecrawl + dlt.

## Live run

1. Confirm `FIRECRAWL_API_KEY` in `ingest/.env` (invoke `firecrawl-build-onboarding` if missing).
2. Confirm `SUPABASE_PG_*` creds in `.dlt/secrets.toml`.
3. Run the DDL: `docs/sql/20260522_lee_building_permits.sql` (manual paste into Supabase SQL editor).
4. Run:
   ```
   python -c "from dotenv import load_dotenv; load_dotenv('ingest/.env'); from ingest.pipelines.lee_permits.pipeline import run_pipeline; from datetime import date; run_pipeline(date(2026,5,15), date(2026,5,22))"
   ```

## Firecrawl scrape recipe (confirmed against live portal 2026-05-25)

The Accela portal is an Angular SPA (`ng-app="appAca"`) — the date-range
form is rendered client-side, so a plain `/scrape` returns a stub HTML
without the inputs. The working recipe uses **firecrawl-py 4.28+ `app.scrape(...)`
with `proxy='stealth'` and an `actions=[...]` array** in a single call.

**Confirmed against live portal 2026-05-25:**

- Real host: `aca-prod.accela.com/LEECO/` (the vanity `aca.leegov.com` 302s here; `accela.leegov.com` is NXDOMAIN — the prior recipe pointed at a dead hostname).
- Module: `?module=Permitting&TabName=Permitting` (Lee's instance does NOT have a `module=Building`).
- Form inputs: `input[id$="txtGSStartDate"]` / `input[id$="txtGSEndDate"]`.
- Search submit: `#ctl00_PlaceHolderMain_btnNewSearch` (NOT `btnSearch` — that selector is ambiguous between submit and history).
- Result grid: `<table id*="gdvPermitList" class="ACA_GridView ...">`.
- Column order (0-indexed): `[_, Record Number, Address, Description, Status, Action, Related Records, Submittal Type, _]` — **no issued-date column on the list view**.

Implementation lives in `scraper.py:fetch_permit_pages`.

## v1 limitations (tracked for v2)

- **First page only** (10 rows max per run). Lee shows "Showing 1-10 of 100+" for any non-trivial window. v2 needs pagination.
- **No issued_date on list view.** v1 stamps every row with the search `end_date` as a documented approximation. v2 needs a per-permit detail-page fetch for real issued_date + declared_value_usd + permit_type.
- **`26TMP-*` temporary applications are included** alongside issued permits. v2 should filter or tag them.

See `MEMORY.md` → `[[permits-swfl-v2-pagination-detail]]` for the v2 plan.

## Schema

See `docs/sql/20260522_lee_building_permits.sql`.

## Notes

- Permit-type → 5-bucket classification lives in `buckets.py` (pure function, fully tested). v1 has no `permit_type_raw`; classification falls back to description-only.
- Detail-page lat/lon enrichment is NOT in v1; corridor-assignment in the brain falls back to ZIP-centroid + nearest-corridor heuristic (documented in pack header).
