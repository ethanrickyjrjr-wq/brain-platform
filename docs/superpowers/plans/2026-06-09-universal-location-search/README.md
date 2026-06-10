# Universal Location Search — one geography spine, every dataset routed by *where*

**Status:** planned, not started (2026-06-09). Verified against `main @765d688`.
**Owner of the idea:** operator. **Build:** parceled into 7 sections (§A–§G) so a different
Claude can pick up each one cold. Read this README, then open your section's brief.

---

## The problem (why we're doing this)

Today you can only ask the lake about a place if a brain happened to be wired for that grain.
Flood + housing answer by ZIP; everything else answers by county/corridor and *refuses* a ZIP.
There is no path from a street address. Operator's words: **"a 1972 search engine."**

**Cause (not excuse):** every source publishes at its own grain — BLS/FDOT county, MarketBeat
corridor, Redfin/Zillow/NFIP ZIP — so the lake was wired grain-by-grain, and ZIP-search got
bolted onto two brains instead of built as a shared resolver.

**Fix:** ONE geography spine. **Location is a lens, not a storage grain.** We do NOT copy
numbers to ZIP grain. A resolver knows how geography nests — address → parcel → ZIP → corridor
→ city → county → MSA → region — and routes ANY location input to every dataset that covers it,
**at the grain we hold it, labeled** ("Lee county-wide — covers 33931"). Universal search that
never lies.

**The moat (inviolable):** never present a figure as finer than we hold it, and never claim a
brain covers a place it doesn't. Enforced as typed invariants at the fan-out boundary (§C).

**Operator decisions (2026-06-09):** honesty model = inline + label honestly; scope = spine +
fan-out, all surfaces; surfaces = MCP `swfl_fetch` + `/api/where` + `/api/z` + web page;
**address lookup is first-class.**

---

## Architecture (one resolver, three layers, four surfaces)

```
 input: ZIP | address | city | county | corridor | neighborhood | region
   │
   ▼ resolveLocation(input)                                          ── §B
   ├ ^\d{5}$              → resolveZip(zip)            → kind:"zip"   ── §A (pure spine)
   ├ gazetteer place      → resolveZip(place→zip)      → kind:"place"   (FIRST, beats fuzzy)
   │  (ENTRY_BY_NORM)
   ├ "Lee County" / FIPS  →                            → kind:"county"  (no ZIP)
   ├ corridor / pocket    → resolvePlace               → kind:"corridor"(no ZIP)
   ├ "SWFL"/"Southwest FL"→                            → kind:"region"  (no ZIP)
   └ free-text address    → geocodeAddress[§E]→zip     → kind:"address"
   │
   ▼ assembleLocationDossier(loc)                                    ── §C (fan-out)
   │   for brain in catalog, skip DOSSIER_EXCLUDED_BRAINS, skip if county ∉ covers:
   │     (a) detail_table grain="zip" + row(zip)   → TRUE-ZIP line   (zip kinds only)
   │     (b) per-ZIP slug for zip (+grains⊇zip)     → TRUE-ZIP line
   │     (c) else headline metrics                 → LABELED "covers {place}" line
   │
   ▼ surfaces: MCP swfl_fetch · /api/where + /api/z/[zip] · /r web page + search box  ── §D
```

---

## Shared types (defined in §A `refinery/lib/zip-resolver.mts`, imported everywhere)

```ts
export type Grain =
  | "zip" | "corridor" | "city" | "county" | "msa" | "region" | "state" | "national";
export type CountyFips =
  | "12015" | "12021" | "12043" | "12051" | "12071" | "12115";  // Cha Col Gla Hen Lee Sar
```

---

## §0 — Verified-fact ledger + hard guards (every section obeys these)

**Code anchors confirmed on `main @765d688` (use exactly these; do not re-guess):**

| symbol | location |
|---|---|
| `renderDetailRowText` | `lib/fetch-brain.ts:250` |
| `fetchDetailRow` | `lib/fetch-brain.ts:297` |
| `readBrainMarkdown` | `lib/fetch-brain.ts:130` |
| `buildDossier` | `lib/fetch-brain.ts:183` |
| `swfl_fetch` zip handler | `app/api/mcp/server.ts:235` (housing default `:242`, zip-param doc `:226–230`) |
| `MAX_WEB_FACTS = 8` | `app/api/mcp/server.ts:130` |
| `assignCorridor` | `refinery/lib/corridor-assignment.mts:66` |
| `ENTRY_BY_NORM` build | `refinery/lib/geography-gazetteer.mts:89` |
| `levenshteinSimilarity = 1 − dist/maxLen` | `refinery/lib/embedder.mts:159` |
| `resolvePlace`, `FUZZY_THRESHOLD = 0.82` | `refinery/lib/place-resolver.mts:133 / :77` |
| `barrierClassFor` (unknown→`"inland",0,null`) | `refinery/lib/swfl-geo.mts:191` |
| static JSON import pattern | `refinery/lib/geography-gazetteer.mts:16` |
| `BRAIN_CATALOG` (27 brains + `master` at `:146`) | `refinery/packs/catalog.mts:25` |

**Verified facts that shape the design:** the place→ZIP crosswalk
(`fixtures/swfl-place-zip-crosswalk.json`) has only **11 places, Lee+Collier** — Captiva
`33924`, Boca Grande `33921`, N. Fort Myers `33903/33917`, Pine Island, Punta Gorda are all
**absent**; `34134` is an alt of **both** Estero and Bonita Springs; `resolvePlace` returns
corridor/pocket only (**no county handling**); Collier permits have **no `zip_code`** column.

| # | Guard | Basis |
|---|---|---|
| **G1** | `zip-resolver.mts` is **pure** — static ESM JSON import, **no `fs`** (it must load in the Vercel MCP function). | `geography-gazetteer.mts:16` already ships in live `_meta.geography`. |
| **G2** | `BRAIN_GEO[slug] = { grains: Grain[]; covers: CountyFips[] }`. `is_true_zip` ⇔ `grains.includes("zip")` **AND** a real row/slug found. Branch (c) emits only if `zip.primary_county ∈ covers`. CI test: every non-excluded catalog id has an entry or **throw**. | §C |
| **G3** | Reuse only the anchors above. | verified |
| **G4** | Geocoder: **one live API call before writing code**; lock `postcode`+coord field paths from the real JSON, not memory. Census geocoder (`ingest/pipelines/collier_permits/geocoder.py`) is the only fallback. | docs JS-rendered; Mapbox MCP usable for the sanity check, but runtime calls the HTTP API. |
| **G5** | Fan-out skips `master` via `DOSSIER_EXCLUDED_BRAINS = ["master"]`. | `catalog.mts:146` |
| **G6** | **Never present a derived default as a fact.** `barrierClassFor` unknown→"inland" must NOT pass through: emit `null` + a `resolution_note`. | `swfl-geo.mts:182` docstring |
| **G7** | **Scope is a sourced, citable artifact** (`fixtures/swfl-zip-county.json`), never "whatever Redfin shipped." No runtime widening from data rows. | PB1 |

### Build note — §A fixture source precedence (locked 2026-06-10, do not re-litigate)

`01-spine.md` says to *union* the ZIPs from `lee_building_permits`, NFIP, ZORI, etc. into the
scope superset. **Implementation deviation, operator-approved:** those permit/NFIP ZIP columns are
**mailing-grade** (verified in-lake 2026-06-10 — `lee_building_permits.zip_code` holds NY/PA
contractor ZIPs like `10620`/`15101`; NFIP `reported_zipcode` maps one ZIP to 2–3 counties and
includes Miami `33131`). Unioning them verbatim would declare out-of-state ZIPs "SWFL" — a G1/G7/moat
break. So the locked rule is: **the U.S. Census ZCTA-to-county relationship file is the SOLE scope +
county authority; mailing-ZIP lake columns are candidate-only (admitted only if Census agrees); a
ZCTA is in-scope only if its dominant county is one of the 6.** Site-grade published ZIPs (ZORI
in-scope, `collier_parcels.phy_zipcd`, the barrier table) are cross-checked for coverage, never used
to widen scope. Full rule + provenance: header of `scripts/build_swfl_zip_county.py` and the
fixture's `precedence_rule`/`discrepancies`/`excluded_examples`. The one population override
(`33936`→Lee) is in `SOURCED.md#swfl-zip-county-pop-override`.

### Build note — §B `corridor_id` is nullable (locked 2026-06-10, do not re-litigate)

`02-dispatcher.md` types the corridor variant as `corridor_id: string`. **Implementation
deviation:** the corridor resolver (`place-resolver.mts`) legitimately returns a **pocket-only**
match (e.g. "North Naples") with no single corridor — there is no honest single ID — so the
shipped `LocationInput` types it `corridor_id: string | null` (null ⇒ pocket grain; §C labels the
line by `pocket`). **§C must gate fan-out on `loc.county` (always populated), never on
`corridor_id`** — a null `corridor_id` suppresses only the one corridor-specific line, never the
whole pocket. Full directive: `03-fanout.md` → "MANDATORY — pocket-only corridor inputs". Everything
else in §B matches the brief.

### Build note — §C BUILT + `covers` corrected from live data (locked 2026-06-10)

§C shipped: `lib/zip-dossier.ts` (`BRAIN_GEO`, `assembleLocationDossier`, `selectDossierLines`,
`renderLocationDossierText`) + `loadParsedBrain` in `lib/fetch-brain.ts` + 27 green tests
(`lib/zip-dossier.test.ts`). **A code audit of the live brains corrected two `BRAIN_GEO.covers`
values the brief got wrong:** `housing-swfl` and `rentals-swfl` hold **site-grade** per-ZIP data
across **Lee+Collier+Charlotte+Sarasota** (verified: 91 in-scope housing ZIP rows span 4 counties),
so both are `covers: METRO_4`, not `Lee,Col` — else §C would refuse ~37 per-ZIP answers we hold.
`permits-swfl` stays Lee+Collier (its per-ZIP slugs are mailing-grade contractor ZIPs, fenced at
resolution). The 34 housing ZIPs outside `swfl-zip-county.json` are **0 genuine gaps** —
Census-verified as 15 non-ZCTA + 19 Manatee-dominant ZCTAs, all correctly fenced by the moat. §C
unblocks §D (the critical-path dependency).

---

## Section map, dependencies, and Claude assignment

| Section | Brief | Phase | Depends on | Claude |
|---|---|---|---|---|
| **§A** Spine — `resolveZip` + `swfl-zip-county.json` | [`01-spine.md`](./01-spine.md) | 1 | — | 1 (first) |
| **§B** Dispatcher — `resolveLocation` | [`02-dispatcher.md`](./02-dispatcher.md) | 1 | §A | 1 (same session) |
| **§C** Fan-out — `assembleLocationDossier` + `BRAIN_GEO` | [`03-fanout.md`](./03-fanout.md) | 2 | §A, §B | 2 (the core) |
| **§D** Surfaces — MCP / endpoints / web + search box | [`04-surfaces.md`](./04-surfaces.md) | 2 | §C | 3, 4, 5 (D1/D2/D3 parallel) |
| **§E** Geocoding — `geocodeAddress` (Mapbox) | [`05-geocoding.md`](./05-geocoding.md) | 3 | §B + secret | 6 |
| **§F** Crisp ZIP rows — rentals + permits detail_tables | [`06-crisp-rows.md`](./06-crisp-rows.md) | 3 | §C contract | 7 & 8 (one per pack) |
| **§G** Parcel-exact — address→parcel enrichment | [`07-parcel-exact.md`](./07-parcel-exact.md) | 4 | data track | later |

**Critical path: A → B → C → D.** Once §C lands, §D1/D2/D3 + §E + §F fan out to ~6 parallel
Claudes. To claim a section: confirm its deps are merged on `main`, read its brief + this §0,
build, and ship its acceptance test green.

---

## Build order & timing (honest)

| Phase | Sections | Delivers | Effort |
|---|---|---|---|
| **1** | §A, §B | spine (covers the **6-county footprint**, not 11 places) + dispatcher + tests | ~2.5 days |
| **2** | §C, §D | **ZIP/address/place/corridor/county/region search LIVE across every dataset**, existing data, + the human search box | ~4 days |
| **3** | §E, §F | address geocoding (→ZIP/corridor) + crisp rentals/permits ZIP rows + MAPBOX env wiring | ~2–3 days |
| **4** | §G | parcel-exact address answers | days–weeks, separate |

~**8 days** to the full universal-search product. Parcel-exact is genuinely missing data,
scoped separately — not a blocker.

---

## SCOPE LEVER — RESOLVED 2026-06-09: **6-county (operator-confirmed)**

The spine covers the **6-county env footprint** (Lee/Collier/Charlotte/Glades/Hendry/Sarasota)
so env's Boca Grande / barrier-island flood data is reachable by ZIP, with the `covers`
county-gate (G2) keeping Lee+Collier-only brains from over-claiming a fringe ZIP. The §A builder
authors `swfl-zip-county.json` for all 6 counties — no Lee+Collier trim. (Captiva `33924` is Lee,
so it's covered regardless.)

---

## Out of scope
Duplicating any dataset at ZIP grain · `BrainOutputMetric` type-lift (grain is derived, not
stored) · parcel-exact answers (§G) · point-in-polygon containment · runtime scope widening (G7).
