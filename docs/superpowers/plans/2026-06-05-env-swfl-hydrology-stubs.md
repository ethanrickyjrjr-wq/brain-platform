# env-swfl hydrology stubs — resolve-or-retire report

**Date:** 2026-06-05 · **Branch:** `claude/env-swfl-hydrology-stubs-e4PY7` · **Status:** report only (no code/vocab/pack changes, nothing merged to `main`)

Brief, not a status board (RULE 2). This is the disposition report for the 3 env-swfl
hydrology slugs that carry vocab entries but have no live data source. It is meant to be
**picked up and executed** by a session on a machine with open network (some sources below
are off the web-session environment's allowlist — see STEP 3).

---

## STEP 1 — Current handling (verified in code)

The three stubs, as they exist in `refinery/vocab/brain-vocabulary.json` and are gated in
`refinery/packs/env-swfl.mts`:

| Slug | prefLabel | Intended source (scope_note) | Live status |
|---|---|---|---|
| `env_rainfall_swfl_annual_in` | SWFL Annual Rainfall (latest complete yr), avg of Lee+Collier station totals, unit `in`, range [0,120] | USGS param `00045` statCd `00006` | **null in prod** |
| `env_gw_level_lee_median_ft` | Lee County GW Median Elevation NAVD88 | USGS param `62610` | **null in prod** |
| `env_gw_highwater_exceedance_days` | Lee County GW high-water days >2 ft NAVD88 (septic/slab risk) | USGS param `62610` | **null in prod** |

`env-swfl.mts:752-756` and `:949` confirm the handling: **only Caloosahatchee surface stage
(`00065`, slug `swfl_sw_stage_caloosahatchee_ft`) emits.** The guard at `:757` checks
`snapshot.hydro.sw_stage_caloosahatchee_ft !== null`; the other three are never pushed to
`key_metrics`. The pack comments (`:491-495`, `:949`) already state `62610`/`00045` are
absent or zero-row in `data_lake.usgs_daily`, so emitting them would be permanently null —
the fixture carries illustrative values, live Postgres does not. **Code already matches the
"stub" framing; nothing is silently shipping a fake number.**

---

## STEP 2 — NOAA NCEI / GHCN-D for rainfall → **VIABLE (strong)**

`ncei.noaa.gov` is not directly reachable from the web-session env (off allowlist; the NCEI
access API also 403s the WebFetch fetcher). **But GHCN-Daily is mirrored on AWS Open Data
(`noaa-ghcn-pds` S3), which IS reachable and is current — inventory last-modified 2026-06-03.**
Real station list + inventory + station CSVs were pulled and coverage was computed.

### Anchor stations — daily PRCP, with measured completeness

| Station ID | Name | County | PRCP record | Recent completeness (measured) |
|---|---|---|---|---|
| `USW00012835` | Fort Myers Page Field AP | Lee | **1892–2026 (134 yr)** | 2023: 364 days/100%; **2024: 365 days/100% = 80.5 in** |
| `USW00012894` | Fort Myers SW FL Regional (RSW) | Lee | 1998–2026 (28 yr) | current |
| `USW00012897` | Naples Municipal AP | Collier | 2002–2026 (24 yr) | **2024: 359 days = 66.0 in** |
| `USC00086078` | Naples (COOP) | Collier | **1942–2026 (84 yr)** | current to 2026-05-30 |
| `USC00084210` | Immokalee (COOP) | Collier | 1970–2016 | retired — do not use |

Plus a **dense ~130-gauge CoCoRaHS network** (`US1FLLE*` Lee / `US1FLCR*` Collier), most
2007/2008–2026, available for sub-county / ZIP-grain density if ever wanted.

Both counties have multiple **current, complete, machine-readable** daily precip stations.
2024 reads (Page Field 80.5 in — a wet hurricane year; Naples Muni 66.0 in) are physically
sane and consistent with the vocab scope_note's "typical 50–60 in." **Buildable today.**

### Minimal connector spec (proposal)

- **Source:** AWS Open Data `noaa-ghcn-pds` S3 — **no token, no auth.** (The NCEI CDO v2 API
  needs a token and rate-limits; the token-free NCEI access service blocks bots; S3 sidesteps
  both.)
- **Pull from `csv/by_year/{YYYY}.csv`, NOT `csv/by_station/`.** Key finding: the by-station
  mirror **lags** — Page Field & Naples Muni are stuck at 2025-02-06 there, while
  `by_year/2026.csv` has Page Field PRCP through Jan 2026 and updates daily. By-year is the
  live source. (Naples COOP happens to be current in by-station, but by-year is uniformly
  current — use it.)
- **Format:** `ID,DATE(YYYYMMDD),ELEMENT,VALUE,M-FLAG,Q-FLAG,S-FLAG,OBS-TIME`. Filter
  `ELEMENT==PRCP`, drop rows with a non-blank `Q-FLAG` (failed QC). **VALUE is tenths of mm →
  inches = VALUE/254.**
- **Metric math (matches existing scope_note):** per-station annual total for the most-recent
  complete year (require ≥~90% day-coverage, or the scope_note's ≥10 monthly samples), then
  **average the station totals across Lee+Collier — average, not sum** (summing gauges is
  physically meaningless; the scope_note is explicit).
- **Station pin:** the 4 anchors above (2 Lee + 2 Collier); optionally fold CoCoRaHS for density.
- **Cadence:** data is daily; the metric is annual. Monthly refresh is plenty. Per
  pipeline-freshness rule, ship the GHA cron wrapper + `--dry-run` in the same PR.
- **Tier/gate:** bulk → Tier 2 (`data_lake.*`); the consuming brain (env-swfl) already has the
  `PackDefinition` and the slug, so the brain-first ingest gate is satisfied by wiring.
- **One provenance note:** GHCN-D gives total *gauge precipitation*, not the USGS `00045` the
  slug originally named. The metric definition (annual inches, Lee+Collier average) is unchanged
  and arguably better-sourced — but the raw_slug provenance string and the scope_note's "USGS
  active dv rain gauges" wording need a one-line correction when this is built.

---

## STEP 3 — Groundwater (`gw_median` + `gw_high_water_days`) → **RETIRE both** (one unverified lead)

USGS was **not** re-chased. The probe looked for any *named, non-USGS, machine-readable* SWFL
groundwater network. Findings:

1. **SFWMD DBHYDRO → confirms "catalog-only / dead."** The reachable machine-readable surface
   is the `DBHYDRO_Wells` ArcGIS FeatureServer — that's **well-location metadata** (construction,
   depth, hydrostratigraphy, station name), **not water-level time-series.** The actual daily
   water-level values live behind **DBHydro Insights** (which replaced the DBHydro Browser,
   retired **2025**); no documented clean public time-series API. Matches the prior "DBHYDRO API
   is dead" finding exactly.
2. **NGWMN wells (L-4820, L-727 in Lee; C-311, C-169, C-535, C-1156 in Collier)** exist with
   NAVD88 water levels — **but these are USGS-sourced** (surfaced via the National Groundwater
   Monitoring Network portal). Same thin USGS data the prior probe already found absent/zero-row
   for param `62610`. **Not a new source — do not re-chase.**
3. **NEW, non-USGS, UNVERIFIED lead — flag, don't chase from web-session:** **Lee County Natural
   Resources "Monitor Well Data"** (`leegov.com/naturalresources/hydrological-monitoring/monitor-wells/monitor-well-data`)
   — a county-run network; search results state it's explicitly in **NAVD88**. Both gw slugs are
   **Lee-specific**, so this is the one place that could resurrect them. **Machine-readability
   could NOT be verified** — the host is off the web-session env's allowlist (403/blocked). Could
   be a CSV/REST download or could be PDF reports + a map viewer; unknown from that box. **A
   session on a machine with open network should probe this directly.**

**Recommendation: retire both `env_gw_level_lee_median_ft` and `env_gw_highwater_exceedance_days`**
unless the Lee County NR probe finds machine-readable daily NAVD88 levels. No machine-readable
daily NAVD88 water-level source is otherwise confirmed reachable; DBHYDRO is catalog-only; USGS is
thin and out of bounds. The single open thread is a **~30-minute follow-up probe** of the Lee
County NR portal — *if* it publishes machine-readable NAVD88 daily levels, both slugs become
buildable from one Lee source. Absent that, retire.

---

## Recommended dispositions

- **`env_rainfall_swfl_annual_in` → BUILD.** GHCN-D via AWS S3 `by_year`, 4-station Lee+Collier
  anchor pin, average-of-totals. Connector spec above. Correct the "USGS 00045" provenance wording
  to GHCN-D. Ship connector + GHA cron + `--dry-run` in one PR; diff-review before push (changes
  brain output shape).
- **`env_gw_level_lee_median_ft` → RETIRE** (park the Lee County NR lead; build only if the probe
  finds a live machine-readable source).
- **`env_gw_highwater_exceedance_days` → RETIRE** (same lead; same county source if it ever lands).

### Pre-push gates (CLAUDE.md, for the executing session)

- package.json change → `bun install` + commit `bun.lock` in the same push.
- vocab/pack touched → `bun test refinery/lib/corridor-aliases.test.mts` +
  `bun refinery/tools/check-vocab-coverage.mts`.
- SESSION_LOG top-of-file entry; push via `node scripts/safe-push.mjs`.
- Show a diff before pushing the rainfall build (brain output shape changes).

### Sources

- NCEI GHCNd product page · NOAA GHCN-D on AWS Open Data (`noaa-ghcn-pds`)
- CDO station detail `USW00012835` (Fort Myers Page Field)
- SFWMD DBHYDRO + `DBHYDRO_Wells` ArcGIS FeatureServer (catalog-only)
- Lee County Monitor Well Data (`leegov.com`, NAVD88, machine-readability unverified)
- USGS NGWMN (USGS-sourced — out of bounds, do not re-chase)

---

## STEP 4 — WellMonitor recon (2026-06-05, open-network session)

**Decision: GW retirement STAYED.** Lee County NR WellMonitor confirmed machine-readable NAVD88 —
TASK B gate fires. Retiring before the endpoint spec is known is deciding blind. Full connector
spec follows; build is a **separate PR gated on threshold sourcing (see §B2 below).**

### 4.1 Access method (no auth, no CSRF)

```
POST https://naturalresources.leegov.com/Home/WellMonitor
Content-Type: application/x-www-form-urlencoded

Id         = <integer from option list> | "" (blank = ALL wells)
DateGroup  = 3 (Hourly) | 0 (Day, default) | 1 (Month) | 2 (Year)
StartDate  = M/D/YYYY  ← US locale REQUIRED; ISO 8601 returns HTTP 500
EndDate    = M/D/YYYY
```

Anonymous GET also 200 OK (returns last ~30 days, daily, all wells). No session cookie,
no rate-limit headers observed. `DateGroup=2` (Year) returned 0 rows — broken or empty;
do not use for aggregation.

### 4.2 Response format

HTML page (1–2 MB for a full year at daily granularity). **Not AJAX.** Data is server-rendered
as a JavaScript literal embedded in the page:

```js
data: [["1-GW1","5/5/2026","6.40","11.40"], ...]
```

Columns: `[well_name, date_M/D/YYYY, avg_water_elevation_ft_NAVD88, ground_elevation_ft]`

Values are strings; `ground_elevation_ft` is blank for some newer wells. The DataTables
"CopyCSV" button reads this in-browser array client-side — no separate JSON/CSV endpoint exists.

**Parser:** regex or DOM extract the `data: [...]` block → `JSON.parse`.

### 4.3 Scale and historical depth

| Request | Rows | Wells |
|---|---|---|
| Default (~30 days, all wells, daily) | 2,204 | 177 |
| Full year 2023 (daily, all wells) | 27,469 | 182 |
| Full year 2010 (daily, all wells) | 17,766 | 167 |
| 1995 sample | 2,195 | ~167 |

UI year dropdown goes to 1990; 1995 confirmed live. Full-year daily request: ~1.5 MB, all
records in one shot (server returns everything; client paginates in-browser).

### 4.4 Geographic scope — **LEE COUNTY ONLY, no Collier**

Verified three ways:
1. Page text: *"All Lee County's monitor well data is in North American Vertical Datum of 1988 (NAVD88)"*
2. Operator: Lee County Natural Resources dept — contact Brad Balogh `BBalogh@leegov.com`
3. Well names: 100% Lee County — numbered survey zones (16-GW, 17-GW, etc.), Bob Janes (Lee
   County commissioner namesake), Kiker Road (Alva, Lee), Pine Island (PI-GW1, Lee). Zero
   Collier County identifiers across 167–182 wells in any year checked.

**This source cannot back a SWFL-wide (Lee+Collier) metric.**

### 4.5 Pre-build verification gates (ALL required before build PR opens)

**A. `env_gw_level_lee_median_ft`** — Lee-named, Lee-sourced. Lee County NR covers it.
Metric: median `avg_water_elevation_ft` across all active wells, trailing 12-month window
(last complete calendar year with data confirmed). Build-ready once B2 is resolved.

**B. `env_gw_highwater_exceedance_days` — LEE-ONLY, but slug has no "lee" token.**
Vocab `scope_note` is Lee-specific. Lee County NR covers it at face value. Flag: if the metric
is ever broadened to SWFL-wide, this source cannot cover Collier — must revisit then.

**B2. THRESHOLD UNSOURCED — build BLOCKED until resolved.**
">2 ft NAVD88" is a hard-coded magic constant. Water levels span 1.00–24.79 ft NAVD88 across
wells; a fixed 2 ft absolute cutoff is only meaningful for near-sea-level wells. Two competing
interpretations:
- `avg_water_elevation_ft > 2.0` (absolute NAVD88) → meaningful for coastal wells only
- `(ground_elevation_ft − avg_water_elevation_ft) < 2.0` (depth-to-water < 2 ft) → physically
  correct for septic/slab risk; needs a cited FDEP/SFWMD/Lee County NR standard naming 2 ft

**Source required before build.** Candidates: FDEP septic setback standards, SFWMD wet-season
high-water guidance, Lee County NR flood-risk documentation. Must appear as inline citation
or `SOURCED.md` entry.

**C. `minLiveRows` guard** — mandatory. A 0-row response must raise, never produce null metrics.

**D. Citation string** — `"Lee County Natural Resources WellMonitor — naturalresources.leegov.com/Home/WellMonitor"`.
NOT SFWMD DBHYDRO, NOT a hardcoded `data_lake.*` path.

### 4.6 Connector spec (build-PR reference)

```python
# POST-based HTML scraper — no auth
URL = "https://naturalresources.leegov.com/Home/WellMonitor"

def fetch_year(year: int) -> list[dict]:
    payload = f"Id=&DateGroup=0&StartDate=1%2F1%2F{year}&EndDate=12%2F31%2F{year}"
    resp = requests.post(URL, data=payload,
                         headers={"User-Agent": "...",
                                  "Content-Type": "application/x-www-form-urlencoded"})
    resp.raise_for_status()
    rows = re.findall(
        r'\["([^"]+)","(\d+/\d+/\d{4})","([^"]*)","([^"]*)"\]',
        resp.text
    )
    if len(rows) == 0:
        raise ValueError("minLiveRows guard: 0 rows — source may be down or params wrong")
    return [{"well": r[0], "date": r[1],
             "water_elev_ft": r[2], "ground_elev_ft": r[3]} for r in rows]
```

dlt table: `data_lake.lee_nr_wellmonitor_daily`
(columns: `well TEXT, date DATE, water_elev_ft NUMERIC, ground_elev_ft NUMERIC`).
After first load: `GRANT SELECT ON data_lake.lee_nr_wellmonitor_daily TO service_role;
NOTIFY pgrst, 'reload schema';`

### Sources (updated)

- Lee County NR WellMonitor app: `naturalresources.leegov.com/Home/WellMonitor`
- Lee County NR landing page: `leegov.com/naturalresources/hydrological-monitoring/monitor-wells/monitor-well-data`
