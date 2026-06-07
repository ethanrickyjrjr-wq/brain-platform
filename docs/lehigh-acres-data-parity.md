# Lehigh Acres — data-parity roadmap (catch up to Fort Myers / Naples)

**Goal:** give Lehigh Acres (Lee County CDP, ~114k residents) the same depth of data
attention the Fort Myers and Naples corridors get. As of 2026-06-06 Lehigh has **two
corridors live** in `corridor_profiles` — **Lee Blvd** and **Joel Blvd** — both with
NULL CRE metrics.

Written 2026-06-06. Evidence below is from live lake/DB queries this session, not memory.

---

## What Lehigh ALREADY has (parity at ZIP / county grain — inherited, no work)

Lehigh is Lee County, and its six ZIPs (`33936, 33971, 33972, 33973, 33974, 33976`)
are present in the ZIP-grained datasets. It inherits everything county/metro-level
**automatically** — same as any Fort Myers ZIP:

| Surface                                            | Coverage                      | Evidence                 |
| -------------------------------------------------- | ----------------------------- | ------------------------ |
| ZORI rent index                                    | all 6 ZIPs, 17–52 rows each   | `zori_swfl` query        |
| LeePA parcels (just_value / last_sale / use_codes) | Lee County corpus             | `*_2026_05_30` views     |
| Redfin market, macro-swfl, labor-demand-swfl       | county / metro grain          | inherited                |
| safety-swfl (property crime)                       | Lee County rate               | inherited (county grain) |
| env-swfl flood AAL                                 | **coastal ZIPs only**         | by design — see note ▼   |
| city_pulse corridor news                           | **now flowing** (2 corridors) | `city_pulse_corridors`   |

> ▼ **Flood AAL is coastal-only, by design (verified 2026-06-06).** `env-swfl.md` computes
> per-ZIP flood AAL only for the high-risk coastal/barrier ZIPs (33957 Sanibel, 33931 FMB,
> 33921 Boca Grande, 33908 Iona, 33924 Captiva, 34102 Naples). **None of the six inland Lehigh
> ZIPs are in that set** — the earlier "inherits per-ZIP flood AAL" claim was wrong for Lehigh.
> The `/r/zip-report` flood section hides gracefully (no 404). This is correct behaviour, not a
> gap to fill, unless the operator decides inland ZIPs should carry a flood line.

**So the parity gap is NOT ZIP/county data — it is corridor-grain CRE depth.**

---

## Gaps — most important → least

### 1. CRE corridor metrics (cap_rate / vacancy / asking rent / absorption) — HIGHEST

The single visible gap. `/r/cre-swfl/lee-blvd-lehigh-acres` and `.../joel-blvd-lehigh-acres`
render an **empty metrics table**; every Fort Myers / Naples corridor shows a full one.

- **Why blocked:** no broker (MarketBeat) survey coverage for Lehigh → no auto-source.
- **Path:** Operation Dumbo Drop **manual drop**. Consumer is already null-tolerant
  (`buildMetricRows()` gates each metric `!== null`), so this is a **zero-code graduation**:
  hand-key cap_rate / vacancy_rate_pct / asking_rent_psf / absorption_sqft + `metrics_period`
  - `metrics_verified_date` + per-metric `*_source_url` into the two `corridor_profiles` rows.
- **Do NOT inherit a regional cap_rate** — fixture spread is 5.8–8.5; stamping one = an
  invented number (RULE 3 / no-invention).
- **Tracked:** check `lehigh_cre_metrics` (cre-swfl, due 2026-09-30).

### 2. Permit-activity corridor z-scores — HIGH (precise blocker found)

Fort Myers corridors carry permit-velocity z-scores from the centroid+radius join.
Lehigh now has centroids, **but the join still produces zero**, for a concrete reason:

- `data_lake.lee_building_permits` holds **29 permits in Lehigh ZIPs** — but **all 29 have
  NULL lat/lon** (`with_geocode = 0`). The corridor join is geometric (centroid + radius),
  so ungeocoded rows never attach. **This is the sole blocker.**
- **Correction (2026-06-06 audit):** the earlier "only 119 rows ⇒ v1 first-page-only" claim
  was wrong. permits-swfl **v2 pagination is shipped and working** (`ca0a099` #29, `69b13dd`
  pager-selector fix + 90d backfill, `0854877` county fallback; cron
  `lee-permits-weekly.yml` live). Proof: one dlt load pulled **78 rows in a single backfill**
  (~8 pages). The 119-row total is real Lee volume across the windows held, not a pagination
  defect. (Separate, out-of-scope residual: `declared_value_usd` extraction is broken at
  0/119 — tracked apart from Lehigh parity.)
- **Action:** geocode the Lehigh permits (`address` → point, free US Census batch, mirror
  `collier_permits/geocoder.py`) and wire it into `lee_permits/pipeline.py` before the dlt
  merge. Then z-scores light up with no pack change — though thin at 29 permits (label honestly).
- **Tracked:** check `lehigh_permit_geocode`.

### 3. Qualitative narrative (`character_facts` + `character_speculative`) — MEDIUM

Both Lehigh rows have a basic `character` line but no generated narrative. 24 of 27 corridors
carry the generator output; the 3 without are the 2 Lehigh + 1 other.

- **Correction (2026-06-06 audit):** the live, rendered narrative system is
  `character_facts` + `character_speculative` (`composeCharacterRender` prefers them over the
  legacy `character` head). `character_broker_narrative` is the **dead** legacy n8n column —
  NULL across **all 27** corridors, FM/Naples included — so "FM corridors carry the broker
  view" was misleading. Target the generated columns.
- **Path:** run the type-conditional corridor-character generator (already shipped;
  grounded-NDJSON prereq is mandatory — the preview throws without it) for the two Lehigh
  corridors — produces the speculative, self-disclaimed voice block.
- **Tracked:** check `lehigh_broker_narrative`.

### 4. ZIP-drill render verification — LOW (data exists; confirm UX)

The 6 Lehigh ZIPs have ZORI / parcel / flood data, so the reads should already work.

- **Action:** smoke-test `/r/zip-report/{33936,33971,33972,33973,33974,33976}`; confirm
  housing / env ZIP-drill renders them and that they're in the provenance allowlist.
- Not yet a check — open one only if a ZIP renders blank.

### 5. MarketBeat submarket enrichment — LOWEST (parked, zero-code-ready)

Requires a broker survey region for Lehigh that does not exist today (same documented
zero-row state as Estero / Fort Myers Beach). The `"Lehigh Acres"` submarket alias is
already registered, so if a broker region ever appears it is a zero-code graduation.

- **No action** until broker data exists.

---

## Sequence

1 (manual data drop) and 2 (permit geocode + v2) are the real parity moves; 3 is a
generated nicety; 4 is verification; 5 is parked. Closing 1 + 2 makes a Lehigh corridor
page indistinguishable in depth from a Fort Myers one.
