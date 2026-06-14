# Handoff — Collier permits XLSX download 403s from GitHub runner IPs

**Status:** OPEN. `Collier County permits monthly` GHA has **never succeeded** (4/4 failures since 2026-05-27).
**Check:** `collier_permits_runner_ip_403`. **Owner:** next session.

## Symptom
The cron fails with:
```
requests.exceptions.HTTPError: 403 Client Error: Forbidden for url:
https://www.collier.gov/files/.../2026-4-issued-permits.xlsx
```
The error is on the **XLSX binary download**, AFTER the publish-lag fallback already correctly resolved the
month (May not published → falls back to April).

## Root cause (verified 2026-06-14, in-session)
- The **listing page** (`colliercountyfl.gov`) is WAF-protected and is already fetched via **Firecrawl stealth**
  (`fetcher._fetch_listing_html` → `scrape_with_actions(..., proxy="stealth")`). This works —
  `discover_issued_reports()` returns the month list correctly.
- The **binary XLSX download** (`fetcher.download_month` → `requests.get(hit.url, headers={Referer, UA})`,
  ~line 93) is a **direct request from the GitHub runner**. `www.collier.gov`'s WAF blocks datacenter / Azure
  runner IPs → **403**.
- **Proof it's an IP-reputation block, not a dead URL / bad headers:** the exact same April URL returns
  **200 / 901,189 bytes from a residential IP**, **403 from the GHA runner**, same headers.
- The fetcher docstring's assumption ("binary file servers don't JS-challenge") is **false** for runner IPs.

## The fix — route the binary download through a WAF-surviving proxy
Only `download_month()`'s `requests.get` needs to change; keep `discover_issued_reports()` (Firecrawl stealth)
as-is. **VERIFY EACH option against live vendor docs (Vendor-First) BEFORE coding** — do not assume:
1. **Firecrawl** — does the scrape API return **raw binary** (the .xlsx bytes), or only markdown/html? If it
   can't hand back the actual file bytes, it cannot fetch the xlsx → skip. (Check the Firecrawl docs in-session.)
2. **Spider** — the repo already uses Spider as the scrape fallback (`extract_client.scrape_with_fallback`).
   Check whether Spider can return raw bytes for a binary URL through its proxy.
3. **Stealth/residential proxy on `requests.get`** — if a proxy egress URL is already configured (the Firecrawl
   stealth proxy, or any residential proxy in secrets), route the binary GET through it. Lowest-effort if available.

## Files
- `ingest/pipelines/collier_permits/fetcher.py` — change `download_month()` (`requests.get` ~line 93).
- `ingest/pipelines/collier_permits/constants.py` — `BASE_URL` / `LISTING_PAGE_URL`.
- `ingest/lib/firecrawl_client.py`, `ingest/lib/extract_client.py` — existing scrape seams to reuse.
- `ingest/pipelines/collier_permits/pipeline.py` — `run_pipeline` (merge to `data_lake.collier_building_permits`).

## Constraints
- Writes `data_lake.collier_building_permits` (merge on `permit_number`) → **diff-review lane** (CLAUDE.md RULE 1).
- **PROBE FIRST:** confirm the proxy returns the real xlsx bytes (~900 KB, openpyxl-parseable) BEFORE wiring the
  pipeline. Don't burn a full run to find out.
- **Do NOT touch** the publish-lag fallback (`_fallback_latest`, 60-day tolerance) — it already works. As of
  2026-06-14 the newest issued month on the listing is **April 2026** (May not yet published); the pipeline
  correctly falls back to April.
- Verify green via dry-run: `gh workflow run collier-permits-monthly.yml -f dry_run=true` must reach
  `collier_permits dry-run: N rows ...` and exit 0.

## Do NOT
- Don't pause/disable the cron to hide the red.
- Don't re-dispatch on a hunch — **every failed run logs a cron incident** (`log-cron-incident.yml` → issue #44).
  Probe locally / confirm the proxy path first, then dispatch once.
