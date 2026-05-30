# Event-Study Backfill — Design Spec

**Date:** 2026-05-30
**Status:** Design in review (brainstorm). Next: implementation plan.
**Serves:** Goal 7 (outcomes loop → causation; the table text literally names _"causal layer (Ian IV / synthetic control / diff-in-diff) → backtests vs 2022–2024"_) and the cold-start of Goal 9 (the compounding flywheel). This is the **head start** — mine natural experiments that _already happened_ instead of waiting 12 months for prospective ones.

---

## 0. Verified facts (live checks done during design — do not re-assume)

These were confirmed against live data / code on 2026-05-30. They override prior notes.

- **`data_lake.leepa_parcels`: 548,798 parcels.** `last_sale_date` non-null on **119,516** (range 1958→2025; ample in the 2021–2024 window).
- **`last_sale_amount` is NULL on 100% of rows.** The column exists (`leepa/resources.py:42`, reads ESRI `s.get("Amount")`) but nothing lands — wrong field name or the sale layer doesn't expose price. **There is no sale-price signal in our free data today.** Sale _timing/volume_ is rich; sale _price_ is absent.
- **No geometry in the Tier-2 table.** Value/use/sale columns only, PK `folioid`. Parcel **geometry lives in the Tier-1 geojson** (`leepa/parcels/{date}.geojson.gz` from `LEEPA_PARCELS_URL`), keyed by FOLIOID. Any radius query must **join Tier-1 geometry ↔ Tier-2 attributes on FOLIOID.**
- **One row per parcel = latest sale only.** Cross-sectional event study is possible; a **repeat-sales index is not** from this table alone (needs ATTOM / FL DOR SDF).
- **Mapbox MCP:** present in the authoring session's tool list but **absent from the operator's live MCP inventory** — discrepancy. The design does **not** depend on it.

---

## 1. The bet

Every chain that opened in SWFL in 2021–2024 is a natural experiment with a "before" and an "after" already in admin data. Estimate the **local effect of an anchor opening** on the surrounding area — by radius and time-since-open — against a credible counterfactual. One opening is an anecdote; a pooled, defensible estimate across many is a predictive pattern. Output rows are shaped to seed the Goal 9 cohort model: **`(starting conditions × event) → outcome`**.

---

## 2. Cut-1 scope (hard boundary — do not creep past this)

**Outcome reframed to what the data actually holds.** Cut-1's primary signal is **sales velocity/volume + permit intensity** in the catchment — both computable from data we have. **Price change is the strongest signal but is NOT available cut-1** and is gated behind Step 0 (§3).

**In:** recover a planted effect on synthetic fixtures; then run **~15–20 hand-seeded real events** (one anchor type, Lee County) through a **synthetic-control + dynamic event-study** estimator **with a placebo test**, Ian handled as a first-class covariate/blackout, reported with full citations and a falsifier.

**Out of cut-1 (documented upgrades):** price/repeat-sales (until Step 0 unlocks a price source), automated event discovery (permit-CO/BTR/DBPR/Sunbiz engine), Collier (unless ATTOM delivers it free), foot-traffic mobility data (paid), causal-forest/double-ML, live brain-pack wiring.

**Recommended v1 anchor:** a **food-service chain** — cleaner, smaller catchment than a big-box, and it lines up with DBPR food-service licensing as the eventual free event stream.

---

## 3. Step 0 — Feasibility probe (the build's first task; math-honest, no guessing)

Step 0 produces a short **feasibility memo** selecting the estimator inputs. All vendor surfaces are **verified in-session** (Rule 1 — Vendor First), never from remembered schema. Step 0 must answer:

1. **Price source (HARD GATE for any price signal).** In priority of cost: (a) **probe the LeePA sale ArcGIS layer's real field names** — the cheapest fix; if the price attribute is just mis-mapped (not `"Amount"`), one ingestion change restores price for free; (b) **ATTOM** — _first confirm it is even reachable in the build session_ (it is **not** a connected MCP tool in the authoring session), then verify in-session whether it carries dated assessment history, full sales history with price, an AVM, and Collier; (c) **FL DOR SDF** arms-length sale records. Outcome decides whether a price spine exists at all and whether Approach A (repeat-snapshot DiD) and Collier come online.
2. **Geometry join.** Confirm the FOLIOID join between Tier-1 geojson geometry and Tier-2 attributes; pick the parcel-centroid representation for distance math.
3. **Permit CO dates.** Can `lee_building_permits` / the Accela source yield **new-commercial CO dates** (use code + new-construction + declared-value filter)? Feasibility only cut-1; the engine is sprint 2.
4. **Hurricane Ian strategy (decided here, not bolted on).** Cheapest first: (a) **blackout window** around 2022-09-28; (b) **Ian damage / flood-zone as a DiD covariate** via existing `env-swfl` AAL + flood bands; (c) **interact event-timing × post-Ian**. Default (b) — we already own the covariate and it preserves sample.
5. **Pre-period length / donor-pool size.** Synthetic control is unstable with a short pre-period or thin donor pool — measure both; they gate synthetic-control vs simpler matched DiD for cut-1.
6. **Control covariate inventory.** Confirm which §7 covariates are queryable now.

---

## 4. Hurricane Ian — first-class, not a footnote

Any 2022–2024 Lee/Collier backtest is contaminated by Ian (2022-09-28): it reset assessed values, spiked insurance, triggered a multi-year rebuild-permit wave, and did so **unevenly by location** (coastal/flood-zone hammered, inland rebuild bump). That break correlates with both treatment (anchors chase growth) and outcome — uncontrolled, every "anchor effect" is partly "distance to Ian's damage footprint." Handling chosen in Step 0 (§3.4), using `env-swfl` AAL + flood bands as the damage proxy.

---

## 5. Event sources & geocoding

- **Cut-1: hand-seed** ~15–20 known openings of the chosen anchor with `anchor_name, anchor_type, address, open_date`. **Geocoded once via a one-time Census Geocoder batch script** (free, in-stack; manual lat/lon fallback for a handful) — **not** an MCP dependency. Result cached in the seed file.
- **Sprint 2 — self-generating engine** (probe in Step 0, build later): **permit COs**, **Business Tax Receipts** (new BTR + NAICS), **FL DBPR** (food-service/lodging/liquor license issue date + address — cleanest restaurant/bar/hotel feed), **Sunbiz** (already Firecrawl-wired). This is what makes it a flywheel, not a one-off.

---

## 6. Data substrate — have / need / who has the paid version

|                            | Source                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Have / free-now**        | LeePA parcels (Lee: **sale date + values + geometry**, but **no sale price** and geometry is Tier-1 only), permits (sparse, needs geocode), FDOT AADT (`traffic-swfl`), flood AAL (`env-swfl`), `macro-swfl`, tourism, corridor asking rents, Census (ACS + **Geocoder**). Free adds: FL DOR SDF sales, HUD–USPS vacancy (tract/ZIP quarterly), CFPB HMDA (tract annual). |
| **Need**                   | **Sale price** (→ fix LeePA field map / ATTOM / FL DOR SDF), dated event list (→ permit CO + BTR + DBPR + Sunbiz; hand-seed for cut-1), historical assessed/sale series (→ ATTOM, SDF), Collier parcels (→ Collier PA ingest or ATTOM), foot traffic (→ paid).                                                                                                            |
| **Who has the paid stuff** | ATTOM (named in CLAUDE.md; reachability unconfirmed), Regrid (cheap nationwide parcels), CoreLogic/Cherre (enterprise), CoStar/Crexi (CRE leases — enterprise), Data Axle/D&B (business open dates), AirDNA (STR), Advan/Placer/Dewey (mobility — the category we don't name in pitches).                                                                                 |

---

## 7. Architecture — six isolated units

A **new Python module** at `analysis/event-study/` (Python because the estimator needs vetted econometric libraries — `pysyncon`/`synthdid`, `differences`/`did`, Conley-SE impls). This is **explicitly a new convention**, _not_ the `refinery/` TypeScript pack pattern; it inherits no pack test-harness, export shape, or catalog wiring. It graduates to a `refinery/` brain pack only if signal holds. Each unit has one purpose, a defined interface, independent tests; deterministic math, no LLM in the estimate path.

1. **Event seed** (`events.json`) — hand-authored, Census-geocoded-and-cached. Interface: `[{anchor_name, anchor_type, lat, lon, open_date}]`.
2. **Geometry + distance unit** — joins Tier-1 geojson parcel geometry ↔ Tier-2 attributes on FOLIOID; given an event point, returns surrounding parcels with **continuous distance** (distance-decay kernel is primary; ½/1/2-mi bins kept only as a robustness cross-check — discrete cutpoints waste power and invite cherry-picking). Reuses existing geo helpers where applicable.
3. **Outcome extractor** — per event, before/after over ±24mo, **multiple signals** ordered by what we can compute now:
   - **Sales velocity / volume** — count & rate of dated sales in the catchment before vs after (119k dated sales make this the reliable cut-1 spine). Time-on-market where `properties-lee-value` carries it.
   - **Permit intensity + declared value** — leads sales 6–18mo; earliest "heating" tell.
   - **New-business density** — Sunbiz/BTR counts (the event source doubles as the clustering outcome).
   - **Free demand proxies** — HUD–USPS occupied-address growth; CFPB HMDA origination volume.
   - **Price / repeat-sales** — **only once Step 0 unlocks a price source** (Case–Shiller repeat-sales pairs preferred; median price retained only with an explicit composition-bias caveat).
4. **Control / donor pool + matcher** — match quality is the credibility. CEM or propensity scores on covariates **we already own**: pre-period sales-velocity trend, parcel density, use-mix, **flood-zone/AAL** (`env-swfl`), **FDOT AADT** (`traffic-swfl` — anchors cluster on high-traffic roads, a major confounder), distance-to-coast, **ACS tract income/growth** (Census), **existing-anchor density** (so overlapping catchments don't double-count). `macro-swfl` county trend = DiD baseline.
5. **Estimator** — on **vetted libraries, not hand-rolled** (Rule 1 + correctness):
   - **Synthetic control** (Abadie) — weighted donor blend tracking each treated site's pre-trend; the biggest single upgrade for "few treated units." Gated by Step-0 pre-period/donor findings.
   - **Dynamic event-study** (leads & lags by months-since-open) — pre-event leads ≈ 0 _is_ the parallel-trends test **and** the house-rules falsifier; catches pre-open land speculation.
   - **Staggered-adoption estimator** (Callaway–Sant'Anna or Sun–Abraham) — events land on different dates, so naive TWFE is biased (negative-weighting / forbidden comparisons).
   - **Conley spatial HAC standard errors** — nearby parcels aren't independent; naive SEs overstate significance.
   - **Placebo / permutation inference** — fake events (random date/location) → effect must be ≈ 0; permutation p-values for small N. This is the falsifier, baked into the method.
6. **Reporter** — every number cited; effect tagged `[INFERENCE]`; **N of events**; leads≈0 parallel-trends as the falsifier; plain-English caveats (openings chase growth; small N; Ian; no price signal cut-1; median-price composition if/when price arrives). No causal claim — correlational DiD, honestly labeled.

**Data flow:** `events → Census-geocode → per event: geometry-joined catchment + matched donor pool → multi-signal before/after → synthetic-control / staggered DiD + placebo → pooled dynamic estimate → cited report`.

---

## 8. Output schema feeds Goal 9

Result rows shaped as `(starting_conditions_vector, event_attributes, outcome_by_distance_and_time)` so they drop into the future Goal 9 cohort model and a **causal-forest / double-ML** (EconML / GRF) heterogeneity layer — _"which anchor, in which baseline context, produces the biggest uplift."_ Not built cut-1; the output is designed to feed it.

---

## 9. Testing

- **Planted-effect recovery** — synthetic fixtures with a known injected effect; estimator must recover it within tolerance (same discipline as the `fgcu-reri` polarity regression test).
- **Placebo ≈ 0** — fake events return null effect.
- **Distance kernel + bin robustness** — boundary behavior.
- **Matcher** — covariate balance before/after matching.

---

## 10. Sequencing & budget (honest)

- **Cut-1** (hand-seed velocity+permit spine, synthetic-control/dynamic estimator, placebo, fixtures-first): **~few days.**
- **Step-0 price-source resolution** (LeePA field-map probe → ATTOM reachability → SDF): **~half a day**, and it is the gate that decides whether a price spine and Collier exist. Do it first.
- **Sprint 2:** permit-CO/BTR/DBPR event engine, then foot-traffic (paid).

Cut-1 is done when it **recovers a planted effect on synthetic fixtures, then runs ~15 real events with a passing placebo check** — Ian-controlled, fully cited, on the velocity/permit spine. Anything past that line is a later sprint.

---

## 11. Explicit non-goals (cut-1)

No price/repeat-sales until Step 0 unlocks a source, no causal claim, no automated event discovery, no Collier-unless-ATTOM-free, no foot-traffic, no causal-forest, no live brain wiring. All are upgrade paths with a home above; none are in cut-1.
