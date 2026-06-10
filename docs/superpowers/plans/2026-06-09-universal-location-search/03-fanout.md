# §C — Grain registry + fan-out: `assembleLocationDossier`

**Phase 2 · ~2.5 days · depends on: §A, §B · status: not started**
Read [`README.md`](./README.md) §0 first (guards G2 + G5 are the heart of this section).
**This is the moat.** The no-fabrication guarantee lives here as a typed invariant.

---

## Goal
Given a resolved location, walk every brain and emit one line per brain that covers it, at the
brain's true grain — a real ZIP number where we hold one, otherwise the county/corridor figure
**labeled** "covers {place}". Never label a non-ZIP number as ZIP; never let a brain cover a
place it doesn't.

## Files
- **New (I/O):** `lib/zip-dossier.ts` — `BRAIN_GEO`, `DOSSIER_EXCLUDED_BRAINS`,
  `assembleLocationDossier`, `renderLocationDossierText`, the `LocationDossier` types.
- **New (test):** `lib/zip-dossier.test.ts`.
- **Modify:** `lib/fetch-brain.ts` — add ONE export:
  `loadParsedBrain(slug): Promise<ParsedBrain | null>` (read via `readBrainMarkdown:130` +
  `parseBrainMarkdown`; return `null` on not-found/parse-fail so one bad brain never 500s the
  dossier). Reuse `renderDetailRowText:250` for true-ZIP rows.

## Enumerate
`BRAIN_CATALOG` (`refinery/packs/catalog.mts`) minus `DOSSIER_EXCLUDED_BRAINS = ["master"]`
(**G5** — `master` is `catalog.mts:146`; an unguarded loop would pull it).

## `BRAIN_GEO` (G2) — sourced; `grains` finest-first + `covers` county set; 27 entries
Each entry carries a one-line sourced comment in code (directive 2). `covers` uses `CountyFips`;
`"region"`/`"all"` = no county gate.

| brain | grains | covers | source |
|---|---|---|---|
| rentals-swfl | [zip, region] | Lee,Col | Zillow ZORI per-ZIP + SWFL median |
| permits-swfl | [zip, corridor, county] | Lee,Col | Lee `zip_code`; Collier corridor-geocoded (**no zip_code**) |
| housing-swfl | [zip, region] | Lee,Col | Redfin `housing_by_zip` grain="zip" |
| hurricane-tracks-fl | [county, region] | **6-county** | HURDAT2 × NFIP |
| properties-lee-value | [county] | Lee | LeePA parcels → Lee |
| properties-collier-value | [county] | Col | FDOR CO_NO=21 + Redfin |
| traffic-swfl | [county] | Lee,Col | FDOT AADT |
| cre-swfl | [corridor, city] | Lee,Col | corridor profiles + MarketBeat per-place |
| env-swfl | [zip, county, region] | **6-county** | NFIP per-ZIP AAL + NFHL + region |
| tourism-tdt | [county] | Lee,Col | FL DOR TDT Form 3 |
| sector-credit-swfl | [county] | Lee,Col | SBA by county+NAICS |
| macro-us | [national] | (all) | SOFR + US CPI |
| macro-florida | [state] | (all FL) | FL labor + CBP |
| macro-swfl | [county, region] | Lee,Col | BLS LAUS + QCEW |
| logistics-swfl | [region] | region | FAF5 zone 129 |
| logistics-swfl-nowcast | [region] | region | FDOT AADT proxy |
| storm-history-swfl | [county, region] | Lee,Col,Cha | NOAA Storm Events |
| fgcu-reri | [region] | region | FGCU RERI |
| safety-swfl | [county] | Lee,Col | FBI CDE NIBRS |
| econ-dev-swfl | [region] | Lee,Col,Cha | SWFL Inc. announcements |
| rsw-airport | [region] | region | RSW+PGD enplanements |
| city-pulse-swfl | [city] | Lee,Col | daily city pulse, 7 cities |
| corridor-pulse-swfl | [corridor] | Lee,Col | weekly corridor pulse |
| labor-demand-swfl | [msa] | Lee,Col | BLS OEWS by MSA |
| news-swfl | [region] | 5-county | DBPR enforcement |
| licenses-swfl | [county] | Lee,Col | DBPR Construction/Electrical |
| condo-sirs-swfl | [county] | Lee,Col | DBPR SIRS |

## Per-brain emission (skip brain if `loc` has a county and `county ∉ BRAIN_GEO[brain].covers`)
- **(a)** zip-kind + a detail_table `grain==="zip"` with a row `key===zip` →
  `renderDetailRowText:250`, `is_true_zip:true`. (Today: only housing-swfl.)
- **(b)** zip-kind + a `key_metrics` slug containing `_zip_${zip}` AND `grains.includes("zip")`
  → `is_true_zip:true`. *(Today env/rentals/permits emit these only for extreme ZIPs until §F —
  set Phase-2 expectations accordingly.)*
- **(c)** else headline metrics, `is_true_zip:false`, `coverage_label` from
  `fallbackGrain = grains.filter(g=>g!=="zip")[0] ?? grains[0]` →
  "Lee county-wide — covers 33931" / "Naples-area — covers 34102" /
  "Cape Coral-Fort Myers MSA — covers 33913". **Route through the scrub chokepoint**
  (`toDisplayBrain` / `sanitizeProse`, `refinery/render/speaker.mts`), never raw `key_metrics`.

## Output (renamed from ZipDossier — PB4)
```ts
export interface LocationDossierLine {
  brain_id: string; domain: string; grain: Grain; coverage_label: string;
  is_true_zip: boolean; text: string; source_citation: string; source_url: string;
}
export interface LocationDossier {
  resolved_as: Grain; zip: string | null; in_scope: boolean;
  resolution: ZipResolution | null; lines: LocationDossierLine[];
  freshness_tokens: Record<string, string>;
}
export function assembleLocationDossier(loc: LocationInput): Promise<LocationDossier>;
```
The emission loop keys (a)/(b) on `zip !== null`. corridor/county/region kinds emit only the
lines honest at their grain (no ZIP lines) + a note "ask with a ZIP for ZIP-level."

### ⚠️ MANDATORY — pocket-only corridor inputs (`corridor_id === null`) MUST still fan out
§B's `kind:"corridor"` variant ships `corridor_id: string | null` — a **pocket-only** match
("North Naples" / "Estero" pocket) has `corridor_id: null` but a populated `pocket` AND a
populated `county` (see README §B build-note; this is locked, not a bug). The fan-out loop:
1. **Gate on `loc.county`, NEVER on `corridor_id`.** The county is always present on the corridor
   variant, so the G2 county-coverage test (`county ∉ BRAIN_GEO[brain].covers → skip brain`) runs
   identically whether or not a single corridor was identified. Every county/region brain covering
   `loc.county` emits its labeled "covers {pocket}" line.
2. **`corridor_id === null` only suppresses the ONE corridor-specific line** (e.g.
   `corridor-pulse-swfl`, which needs a single corridor id) — guard that lookup with a null check
   and skip just that line.
3. **Do NOT `continue` / early-return / throw on `corridor_id === null`.** Treating null as "no
   location" would silently drop the entire pocket from the dossier — the exact moat-break (a real
   in-scope place answered as "nothing") this section exists to prevent. Label by `pocket`.

## Token budget
`renderLocationDossierText(dossier, tier)` — true-ZIP lines first & uncapped (they're the
answer); (c) lines capped ~6–8 by relevance (real-estate + environmental + safety before
macro/labor), per `MAX_WEB_FACTS=8` (`server.ts:130`). Tier-1 = true-ZIP + one rollup line;
tier-2 expands; tier-3 = all.

## Acceptance — `bun test lib/zip-dossier.test.ts`
Moat tests run against **synthetic `ParsedBrain` fixtures** (not live `brains/*.md`, so they
can't flake on nightly data), PLUS one integration smoke:
- **(i)** every non-excluded catalog id has a `BRAIN_GEO` entry, else **throw** (G2 CI gate).
- **(ii)** no line with `grain!=="zip"` has an empty / zip-only `coverage_label`.
- **(iii)** no `is_true_zip` line unless `BRAIN_GEO[brain].grains.includes("zip")`.
- **(iv)** no line has `brain_id==="master"` (G5).
- **(v)** a county-only brain (safety-swfl) never emits a line that reads as a ZIP-specific number.
- **(vi)** a Charlotte ZIP gets **no** macro-swfl line (`covers` gate).
- **Integration smoke:** every ZIP key in live `housing_by_zip` rows is `in_scope:true` (catches
  `swfl-zip-county.json` gaps forever).
