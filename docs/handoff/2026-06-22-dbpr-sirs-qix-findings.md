# DBPR SIRS — QIX websocket ingest: spike findings (2026-06-22)

**Status:** feasibility spike COMPLETE and PASSING from a home IP. Full pipeline build next.
**Why this exists:** the dbpr_sirs DOM scrape under-captures — Qlik virtualizes both columns
(County/ID scroll off-screen) and rows (~46 of thousands in the DOM, nodes recycle). The robust
fix is to pull hypercube data straight from the Qlik QIX engine over its websocket, bypassing the
rendered grid entirely. (SOLO-13 STEP 2 — the `result.tables` parser swap — is dead: no DOM
extractor can recover columns that aren't in the DOM.)

## The access path (confirmed live)

1. **Harvest with Playwright.** Load
   `https://dbpr-publicrecords.myfloridalicense.com/qpr/single/?appid=<APPID>&sheet=<SHEET>&opt=ctxmenu`,
   `wait_for_selector("table tbody tr")` (the grid render is what makes the engine open its socket),
   then capture the **real** QIX ws URL via `page.on("websocket")` (filter `"/qpr/app/"`).
   - The **csrf token + reloadUri ride inside that ws URL** — do NOT try to reconstruct it. The
     `/qpr/api/v1/csrf-token` endpoint 404s; there is no meta/window token. Capturing the live URL
     is the only reliable way. (ws URL length ≈ 292 chars.)
   - Grab the one session cookie: **`X-Qlik-Session-qpr`** (`cookie_len≈55`).
2. **Drive QIX with a raw `websockets` client** (websockets 16.0, already a dep). Connect to the
   captured ws URL with header `Cookie: X-Qlik-Session-qpr=...`.
   - **The session stays valid AFTER `browser.close()`** — the spike closes Playwright, then opens
     its own ws and `OpenDoc` succeeds. So we do NOT need to keep a browser alive during the pull.

## QIX JSON-RPC chain (both apps)

JSON-RPC 2.0 over the socket. `handle=-1` for global, then the returned `qHandle`:
- `OpenDoc(<appid>)` → doc handle (1)
- `GetAllInfos(doc)` → object inventory; the straight table is the single `qType:"table"` object
- `GetObject(<objId>)` → object handle
- `GetLayout(obj)` → `qLayout.qHyperCube.qSize {qcx, qcy}` + `qDimensionInfo[].qFallbackTitle`
- `GetHyperCubeData("/qHyperCubeDef", [{qTop, qLeft:0, qHeight, qWidth:qcx}])`
  → `qDataPages[0].qMatrix` = rows of cells; cell text is `cell["qText"]`.
  - **Cell cap ~10,000 per call** → `qHeight*qWidth ≤ 10000`. Page it: qHeight≈1000 (7-col) /
    2000 (5-col). (Sonnet's "qHeight 200 / 32 pages" was over-conservative; bigger pages are fine.)

## The two apps (object ids + schema — the gap the verdict left, now filled)

| period | appid | **object id** | cols (qcx) | **rows (qcy)** | column order (indices) |
|---|---|---|---|---|---|
| `pre_july_2025`  | `14f1ed21-7b21-4272-af14-9eaad7911440` | **`DAwQFJ`**  | 7 | **6284** | Project Type, Project Name, Association Name, City, Zip, County, ID |
| `july_2025_plus` | `d217126f-2edc-408b-bb98-2c355b6f0429` | **`vWkCfXc`** | 5 | **4026** | Project Name, Association Name, City, Zip Code, County |

Sample rows pulled live:
- pre-July: `['CONDOMINIUM','SEA DUNES CONDOMINIUM','SEA DUNES VILLAS','AMELIA ISLAND','32034-5423','NASSAU','226495']`
- July+: `['3 ISLAND CONDO','3 ISLAND CONDO ASSN, INC.','Miami Beach','33139','Dade']`

**County is present and clean in the QIX data** (the entire reason DOM scraping failed). Values are
mixed-case / sometimes abbreviated (`NASSAU`, `Dade`, `Sarasota`) → existing `normalize_county`
(uppercases) handles it; SWFL filter on `{LEE, COLLIER}` is unaffected.

## Mapping to the existing table (no schema change — brain-first parity)

The brain (`condo-sirs-swfl`) reads only COUNTS from `data_lake.dbpr_sirs_submissions`. Keep that
table + the psycopg `row_hash` upsert. QIX cells map 1:1 to the existing row dicts:
- pre-July (7): `project_type, project_name, association_name, city, zip, county, dbpr_id` = cells[0..6]
- July+ (5): `project_name, association_name, city, zip, county` = cells[0..4]; `project_type=None, dbpr_id=None`
- `result_truncated`: with a full hypercube pull we fetch all `qcy` rows → set **False** (verify
  fetched count == qcy; only True if the engine returns fewer).

## Open before push
- **GHA datacenter-IP egress unverified.** Home IP works. `myfloridalicense.com` public-records is
  unlikely to block, but verify on a runner before trusting the cron (cf. Crexi P0b).
- The monthly workflow must install Playwright browsers (it currently assumes the old crawl path) —
  reuse `crawl4ai-setup` or `playwright install chromium`.
- Expected SWFL yield ≈ a few hundred rows (DOM scrape's ~46-row alphabetical window was the bug).
