# HANDOFF — Sold-resolution fallback lane (web/appraiser) + first-cohort property_id gap

**Date:** 07/01/2026 · **Status:** DESIGN / research-first — NOTHING built, NOTHING pushed for this lane.
**Parent:** Phase-2 Part A (`phase-2-sold-lake-and-comps.md`) · **Spec of what shipped:**
`docs/superpowers/specs/2026-07-01-steadyapi-sold-capture-design.md` (organic sold capture, commit `b65f881b`).

This handoff captures a design conversation, not a build. It exists so the next session picks up on
verified ground instead of re-deriving it. Every number below was live-probed or read from code THIS
session — provenance is named inline. Do not trust it blind; re-verify anything load-bearing before you act.

---

## CORRECTIONS — research pass, 07/01/2026 (RULE 0.4, before any build). Read this before "Decisions" below.

**Tagging status (resolves the standing question of when the 10,161 no-`property_id` survivors get
stamped):** never has, and won't automatically. `listing-lifecycle-daily.yml` has no live `schedule:`
(dispatch-only); `gh run list` shows exactly one historical run (2026-06-27), and it failed (pre-cutover
Source-B path, before the SteadyAPI sole-spine switch). The workflow header's own comment — "PHOTOS_API
secret does NOT exist in this repo yet" — is now stale: `gh secret list` confirms it was set 2026-06-30
(today). Tagging only happens on the first live (`dry_run=false`) dispatch of the sweep — an
operator-authorized paid action (handoff action 3 below), not run this session.

**Lane 1 ("our data first") is not viable as scoped — two independent reasons, both lake-probed via
`mcp__lake__query_lake` against `pg.data_lake.*`:**
1. **No join key.** Neither `leepa_parcels` nor `collier_parcels` has an address column — only
   `parcel_id`/`folioid` + zip + use codes + values + sale year/month. `listing_state` carries
   `street_address` but no `parcel_id`. An address→parcel crosswalk to bridge them doesn't exist; building
   one would be its own separate project.
2. **Annual cadence, not fresh.** Both tables are `cadence_days: 365` (`cadence_registry.yaml:365-403`).
   Lee's snapshot (confirmed 2026-05-18) already shows May-2026 sales — reasonably current. Collier's
   snapshot (confirmed 2026-06-06) caps at **sale month 2025-06** — a full year stale, because Collier's
   underlying source (FDOR Statewide Cadastral) is only refreshed on an annual roll (~Aug), per the
   registry's own comment. Either way, a bulk-table Lane 1 structurally can't resolve a sale that closes
   THIS month — it won't land in our copy until next year's roll.

**The fix — collapses Lane 1 + Lane 3 into one lane, live-crawl PRIMARY (not fallback-after-bulk):**
Crawling the LIVE appraiser site (`leepa.org`, `collierappraiser.com`) by street address is the SAME
authoritative source as Lane 1 intended, but keyed on the field `listing_state` already has
(`street_address`) — no crosswalk needed — and far fresher than our annual bulk copy. crawl4ai reachability
check this pass: both sites return 200, no WAF block on a plain fetch (ToS-clean — Florida public property
records). Collier's root is an old frameset (needs the frame-target URL, not the homepage). LeePA's live
parcel-detail page (`Display/DisplayParcel.aspx`) loaded but did NOT render owner/sale data on a static
crawl — it's ASP.NET postback/AJAX-driven, so real extraction needs Playwright interaction (`wait_for` on
the data panel, not a bare GET). This confirms the "WAF-sensitive" caution in the original Decisions
section below, just for a different reason (dynamic rendering, not blocking) — budget for interaction
complexity, not just request volume.

**Live-scrape attempt, same session (operator asked "why not just scrape it now") — result: not trivial
yet, real engineering required:**
- **LeePA:** Owner / Address / Sales-Transactions are `showHideLink` collapsed panels; their content
  container (`div.overFlowDiv`) is empty in the raw HTML even after a 5s post-load delay — the grid only
  populates on click, client-side. A bare DOM `.click()` on the sales-panel expander (no real Playwright
  pointer event) triggered an ASP.NET postback that resolved to an **"Invalid Request" error page**, not
  the data. Network-request capture on load showed no background `.ashx`/`.asmx` data endpoint to hit
  directly either. Fix requires a proper Playwright pointer-event click (scroll-into-view + real mouse
  event) or finding the true postback target — real build work, not a quick script.
- **Collier:** ~30s page load (matches the WAF-sensitive caution). Root is a modern site still using an
  old multi-`<frame>` layout; the actual parcel-search frame wasn't located this pass.
- Full detail in `SESSION_LOG.md` (2026-07-01 entry, same title as this doc).

**Recording lag — still genuinely open.** No authoritative published figure for Lee/Collier deed-recording
→ public-postable lag was found this pass (crawl4ai fetches were reachability checks, not a lag-rate
source). The only cited data point: our own LeePA bulk field shows May-2026 sales already present in an
2026-05-18 pull — a weak signal that LeePA's OWN "last sale" field turns around within roughly the same
month, not a verified lag number. Do not treat this as resolved.

---

## ADDENDUM — lat/long crosswalk (verified live), SteadyAPI native option, other sources checked (07/01/2026, same session, operator-directed)

Operator's question "what about lat/long?" reopened the join-key problem — `listing_state` already carries
`lat`/`lon` per listing. This addendum is the live-verified answer plus two operator-requested follow-ups:
have the next session retry Collier, and check whether SteadyAPI itself offers a coordinate-based lookup.

### Lat/long solves parcel IDENTITY (not sale freshness) — Lee confirmed working, Collier still open

`leepa_parcels`/`collier_parcels` (the Tier-2 attribute tables) have neither address nor coordinates — only
`parcel_id`/`folioid`. But the underlying GIS sources both carry real parcel geometry:

- **Lee — effectively free, verified live.** LeePA's own parcel MapServer (`leepa/constants.py`
  `LEEPA_MAPSERVER_BASE` layer 0, `"geometry-bearing; original ingest target"`) already gets pulled into
  Tier-1 cold storage regularly (`data_lake._tier1_inventory`, path `leepa/parcels/{date}.geojson.gz`,
  pack_id `properties-lee-value` — 5 pulls on record, most recent **2026-06-15**). Live-queried the same
  MapServer endpoint directly this session:
  - `FOLIOID` **is** on the geometry feature (confirmed: `"attributes":{"FOLIOID":10292490,...}`) — same key
    as `leepa_parcels.folioid`. The join is free once wired.
  - **CRS gotcha, caught and fixed live:** the feature's native `spatialReference` is `wkid:102659` /
    `latestWkid:2237` — Florida State Plane West, **US survey feet**, not lat/lon. A naive point-in-polygon
    against `listing_state.lat/lon` (WGS84 degrees) would silently match nothing. Fix verified live: adding
    `outSR=4326` to the same query (`.../MapServer/0/query?where=FOLIOID=10292490&outFields=FOLIOID&outSR=4326&f=json`)
    returns correct WGS84 coordinates directly from LeePA's own server (tested — ring coordinates land at
    -81.78/26.33, correct for the Bonita Springs parcel). Confirmed against the official Esri REST API docs
    (`developers.arcgis.com/rest/services-reference/.../query-feature-service-layer/`, fetched live) that
    `outSR` is a real, standard query param — not assumed from memory.
  - **What this buys:** a listing's `lat`/`lon` point-in-polygon-matched against this (properly reprojected)
    geometry resolves its exact `folioid` — no address-string matching, no crosswalk build. The Tier-1
    archive already exists; the only new work is joining it to `leepa_parcels` by folioid and adding a
    point-in-polygon step (existing pulls are pre-`outSR=4326`, so either re-pull with the param added, or
    reproject the stored 2237 geometry — re-pulling with `outSR=4326` is simpler and verified working).

- **Collier — same idea, NOT yet confirmed, retry instructions below.** Source is
  `services9.arcgis.com/.../Florida_Statewide_Cadastral/FeatureServer/0` (a real ArcGIS FeatureServer — see
  `collier_parcels/constants.py`). Our ingest hardcodes `returnGeometry: "false"`
  (`collier_parcels/resources.py:126`) — geometry is available from the source, we simply don't request it
  today. Attempted to verify a lightweight fetch live this session and got an inconclusive read:
  - `returnCentroid=true` alone → `400 Cannot perform query. Invalid query parameters.`
  - `outSR=4326` alone → same `400`.
  - Re-ran the **known-good production query** (exact params `collier_parcels/resources.py` already uses
    successfully) with nothing changed except adding `returnGeometry=true` → **timed out** (40s), and so did
    the unmodified baseline re-run — Collier's ArcGIS Online-hosted endpoint was simply too slow/flaky in
    this window to get a clean read (matches the existing "~30s page load, WAF-sensitive" note elsewhere in
    this doc). **The 400s are NOT confirmed to mean "unsupported" — they may just as easily be transient.**
    Do not conclude Collier can't do this; the test was inconclusive, not negative.
  - **Retry commands for the next session** (run each alone first, then combine once each works solo):
    ```
    curl "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query?where=CO_NO=21&outFields=PARCEL_ID&resultRecordCount=1&returnGeometry=true&f=json"
    curl "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query?where=CO_NO=21&outFields=PARCEL_ID&resultRecordCount=1&returnCentroid=true&f=json"
    curl "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0?f=json"   # layer metadata — check "supportsReturningGeometryCentroid" + native spatialReference before assuming a CRS
    ```
    If `returnCentroid` is unsupported on this layer, fall back to `returnGeometry=true&outSR=4326` (full
    polygon, reprojected server-side, same trick verified on Lee) and compute the centroid ourselves — more
    payload than a centroid but the same de-risked reprojection path.

### SteadyAPI native option — it DOES offer this, verified live against `docs.steadyapi.com`

`GET /v1/real-estate/nearby-home-values` (base `https://api.steadyapi.com/v1/real-estate`, same `PHOTOS_API`
key already wired) takes **`lat`, `lon`, `radius` (default 5mi), `limit`, `status`** (`for_sale` /
`off_market` / **`sold`**) and returns a `properties[]` list — each with `property_id`, `address`,
`list_price`, `estimates` — for whatever falls in the radius. **Endpoint weight: 1** (verified against the
live docs — every real-estate endpoint listed, including the already-shipped `property-tax-history`, is
weight 1; nothing in this family costs more per call).

**Why this matters:** for a departed listing, calling this with a tight `radius` (e.g. well under 1mi) and
`status=sold`, then filtering the returned list by street address, could resolve a sold price **in one
SteadyAPI call per departure — the exact same budget line the existing `SOLD_CHECK_CAP`/`property-tax-history`
sold-capture already draws from** — with no crawling, no address→parcel crosswalk, no AJAX-panel problem at
all. This doesn't replace the appraiser-site lane (SteadyAPI's own "sold" coverage and its own lag are both
unverified — same "don't trust it blind" standard applies), but it's a live-vendor-confirmed candidate that
should be evaluated ALONGSIDE the live-crawl lane, not after it — same cost profile as calls already
budgeted, zero new crawl risk. Full endpoint reference: `docs.steadyapi.com` → Real Estate → Property
Details → `GET /v1/nearby-home-values`.

### Other sources checked, not viable for this specific need

Sent crawl4ai to check the Lee and Collier Clerk of Court "official records" search sites
(`matrix.leeclerk.org`, `app.collierclerk.com/CORPublicAccess/Search/Document`) as a possible
faster/fresher alternative to the property appraiser (deed recording is a Clerk function; the appraiser's
roll is downstream of it). Both are reachable and both are **indexed by party name / instrument number /
document type — neither has an address or parcel search field.** Collier's site does have a "Map Search"
tab but that's subdivision **plat book** search (BULK/CB/COAST/PB/RB book types), not situs-address search.
Verdict: not usable for "given a departed address, find its sale" without already knowing a grantor/grantee
name — parked, not a live candidate.

**Sequencing point, surfaced not decided:** the permanently-lost cohort (departs before sweep 1 ever runs)
grows every day the sweep stays parked. Authorizing sweep 1 (handoff action 3) is the single
highest-leverage move available — it shrinks the exact problem this lane exists for AND reveals the real
`dep=<checked>/<available>` departure volume needed to size the lane. Building the fallback lane in detail
before that number exists is sizing blind. This is the paid/operator action — not fired this session.

**Status: nothing registered via `node scripts/new-build.mjs`, nothing spec'd.** Holding until the operator
picks the corrected lane design (live-crawl primary; bulk-Lane-1 dropped or deferred) — registering a build
now would commit a spec to a premise already known to be wrong.

---

## The one idea

The shipped sold-capture (Part A) can only price a departure it can probe, and the probe
(`/property-tax-history`) is keyed on `property_id`. A big cohort of our current inventory has no
`property_id` yet and, once it leaves the market, never will through the API. **The fallback: for
departures the API can't reach, drop to the next sourcing lane — our own county-appraiser sales if we
already hold them, then crawl4ai to a named public source (cited), then a human/AI mop-up of the
residual.** Four-lane sourcing applied to the sold-resolution problem. Nothing invented; "found nothing"
stays unresolved.

---

## Verified current state (live-probed 07/01/2026)

Source: `mcp__lake__query_lake` against `pg.data_lake.*`, and direct code reads. Numbers are OUR data.

- **`data_lake.listing_state`, `source_name='api_feed'`: 10,161 active — Lee 7,412 + Collier 2,749 — and
  ALL 10,161 have `property_id = NULL`** (`count(property_id)=0` in both counties). This is the entire
  departure candidate pool at start.
- **`data_lake.listing_transitions`, `source_name='api_feed'`: EMPTY.** Zero departures have ever fired.
  The only transition history anywhere is `lifecycle_seed`: 10,459 `active` rows stamped on a single day
  (the seed). No `holding` transition exists in the whole system yet.
- **298-row gap** between the 10,459 seed and the 10,161 api_feed pool = **Hendry**, still stranded under
  `source_name='lifecycle_seed'`. The live feed sweeps **Lee + Collier only** (`API_COUNTIES` in
  `pipeline.py:34`), so those 298 never depart or backfill through this path — parked, not in the pool.
- **The sweep cron is PARKED.** `.github/workflows/listing-lifecycle-daily.yml:27-31` has the `schedule:`
  block commented out; only `workflow_dispatch` is live and its `dry_run` input defaults **true**
  (line 38-40). `cadence_registry.yaml:881-897` confirms: probe-excluded until ≥3 green daily runs from a
  trusted IP. **No ticks are running** — the state machine is frozen on the baseline. Nothing departs
  because nothing sweeps.

Why 0 `property_id`: the catch-up bridge (commit `700b06e7`) MIGRATED the seed rows into `api_feed`
identity; the seed carried no `property_id`. It is NOT a bug in the extractor — the SteadyAPI search
returns `property_id` and the normalizer even drops any row lacking it (`extract_api.py:94-96,136`).

---

## Mechanics that decide everything (from code, file:line)

- **Departure detection is free and needs no `property_id`.** A baseline row present in `prior` but absent
  from the next scan flips to `holding` — gated on a complete scan and a live prior state
  (`diff_states`, `transitions.py:81-90`, `_LIVE_STATES` line 22). We always know WHO left.
- **Pricing the departure needs `property_id`.** `plan_off_market_checks` skips any departure whose prior
  row has no `property_id` (`transitions.py:187-189`); `fetch_sold_event` returns `gap` without one
  (`extract_api.py:349-350`). So detection ≠ pricing.
- **`property_id` self-heals for SURVIVORS, not departures.** A still-active listing re-upserts from the
  fresh scan row `cur` (which carries `property_id`) on the same-state branch (`diff_states:63-67`); the
  MERGE overwrites the null. But a DEPARTURE is, by definition, absent from that scan — so its stored row
  keeps the null AND it's gone from the for-sale search (which is for-sale only). It can't be identified
  from either side.
- **Consequence — the "priming sweep":** the first live sweep stamps `property_id` onto the ~10,161
  survivors. Departures become API-probe-able from **sweep 2 onward** (alive at sweep 1 → stored pid →
  departs at sweep 2 → checkable). Costs nothing extra: it's the search walk we run anyway.
- **The permanently-lost set = whatever departs before its first live re-scan.** No stored pid, gone from
  search. This first cohort is exactly what the fallback lane is FOR.
- **Budget reality:** `SOLD_CHECK_CAP` (default 8/run, env-tunable, shared across counties —
  `constants_api.py:15`, `pipeline.py:70`). The real ceiling is the **SteadyAPI Starter plan: 10,000
  calls/mo**, shared with the daily search+enrich sweep (~4,700/mo steady-state target —
  `pipeline.py:138-139`). The `[sold]` log line already prints `dep=<checked>/<available>` — the
  `available` half is the true "capture-all" departure count, revealed for free once ticks flow, even at
  cap 8. Size the cap from that real number, not a guess. ("~240/day" from an earlier session was a guess
  with no data under it — there is no departure history to measure yet.)

---

## Decisions from this conversation

1. **Don't uncap `SOLD_CHECK_CAP` now.** Today it's a no-op: 0 `property_id` → captures nothing; and the
   sold `event_name`/`current_status` enum is still unverified (see below), so even checkable departures
   would resolve to `holding`. The cap is the LAST knob, not the first.
2. **The fallback cascade for a departure the API can't price:**
   - **Lane 1 (our data):** if the departed address parcel-matches a county-appraiser recorded sale we
     ALREADY hold in the lake → take price + date from our own data, cited to the appraiser. Zero crawl.
   - **Lane 3 (named web):** crawl4ai the sold date + price from a named public source, cited (homepage
     URL). crawl4ai is the ONLY crawl tool (RULE 0.4) — never Firecrawl.
   - **Residual:** human/AI follow-up on what neither lane resolves.
3. **Batch size scales to departure volume** ("depending on how many come back"). crawl4ai is browser-
   speed (Playwright, ~1.5-1.8s/page, WAF-sensitive), so volume gates it far harder than the API —
   hundreds of departures is a different job than a dozen. Prioritize the same way Part A does
   (list_price desc) if we must sample.

---

## Open unknowns — RESOLVE BY RESEARCH BEFORE BUILDING (RULE 0.4, do not spec from memory)

1. **Recording lag.** A sold price posts publicly only AFTER closing + deed recording — which lags the
   departure. A listing that leaves the sweep today is usually still pending; nothing recorded yet.
   → The fallback must be a PATIENT re-visit over time (same shape as the API recheck), not a one-shot the
   day it departs. **Verify the actual Lee/Collier recording lag** — do not assert it.
2. **Source choice.** County appraiser (Lee + Collier) = authoritative, cite-clean, we already touch it,
   but laggiest. Listing portal sold page = faster, WAF-hard, ToS-gray. **Pick on verified reachability +
   ToS + lag, not memory.**
3. **Probe-first: what appraiser sale data do we ALREADY hold?** If our lake already carries county-
   recorded sales matchable by address→parcel, Lane 1 shrinks the crawl job before it starts. Check the
   lake (there is a prior "LeePA sale price NULL" note — `last_sale_amount` exists but was NULL for some;
   confirm current coverage, don't trust the memory). RULE 0.5.

---

## Next actions, in order

1. **Research pass (crawl4ai + lake probe)** — pin down (a) where SWFL sold posts publicly, (b) the
   recording lag, (c) existing appraiser coverage in our own lake. Write findings into `SESSION_LOG.md`
   (RULE 0.4). This is free (crawl4ai is local; lake reads are our Postgres) — no paid credits, no approval
   needed.
2. **Brainstorm the lane** (RULE 3.5) from the evidence, THEN `node scripts/new-build.mjs <slug> "<label>"`
   to register the build + open its `_live_verify` check. Not before code.
3. **Separately — get real ticks flowing** (operator-authorized, this is the paid-call step): dispatch the
   listing-lifecycle sweep live, one county at a time (`workflow_dispatch`, `dry_run=false`). This primes
   `property_id` onto the survivors and starts departure flow, and the `[sold]` log reveals the true daily
   `departures_available`. Then size `SOLD_CHECK_CAP` against the 10k/mo plan.
4. **Confirm the sold enum** (the already-open check `steadyapi_sold_capture_live_verify`, operator-run,
   one paid call) — verbatim `event_name`/`current_status` for a real SWFL sold property; then tighten
   `_SALE_EVENT_RE` / `PENDING_STATUSES` / `OFF_MARKET_STATUSES` in `extract_api.py`.

---

## Guardrails that must survive the build

- **Moat:** every number carries its source; "no sold found" stays unresolved — never invented. Same
  discipline as the API classifier (`current_status` authoritative; pending ≠ withdrawn).
- **Don't fire a live paid sweep uninvited** — action 3 is the operator's to authorize (memory:
  no live paid API calls without approval).
- **Don't close `*_live_verify` on offline tests** — prod evidence only.
- **crawl4ai files never go to GitHub** (`*crawl4ai*` gitignored, RULE 0.4).
- **Part B (the on-demand comp helper) is a separate parallel-session track — do not touch it.**
