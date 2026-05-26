# env-swfl Flood-Logic Restructure

**Date:** 2026-05-19
**Author:** Opus 4.7 (planning) — wins head-to-head against independent analysis
**Status:** APPROVED 2026-05-19 — executing Group B → C → D in sequence. Group C blocked until Group B renders clean.

**Addendum (2026-05-19, post-approval):** include cap-rate bps adjustment + insurance premium as % of typical NOI in the per-ZIP output. This is how CRE investors read the number; AAL is the math, bps is the language. Threshold $800/yr revisitable after first full live render. NRI ingest deferred to v2 — does not block these PRs. Top-6 cap approved. Flood-veto label preserved in cascade for barrier ZIPs only.

---

## Context

env-swfl's flood logic is architecturally wrong in three specific ways, all rooted in the same flaw: it treats SWFL as one polygon.

1. **Binary alarm, not stratified signal.** `voteEnvDirection` (`refinery/packs/env-swfl.mts:228-281`) applies hardcoded SWFL-wide thresholds (sfha >40%/30%/20%, ve >8%/5%/2%) to area-weighted aggregates. No per-ZIP, per-parcel, or per-barrier-island branching.
2. **The flood-veto fires unilaterally.** `refinery/constitution/real-estate.mts:59-78` forces master bearish-0.85 whenever Lee or Collier VE coverage exceeds 5%. Lee's measured value is 5.75% (driven entirely by Fort Myers Beach, a 6.5-sq-mile barrier island), so the override fires on **every** Lee County refine — including Cape Coral, downtown Fort Myers, and inland properties that share none of that risk.
3. **The investor summary repeats flood 4×.** env-swfl's own `conclusion` paragraph restates SFHA/VE coverage; master's `composeConclusion` re-stamps "Overrides: flood-veto"; `cascade.caveats` re-states the same rule; the standing NFIP uninsured-loss caveat fires every refine. Four mentions of one concept reads like a disclaimer, not intelligence.

The economic reality our data already supports: Ian-era SWFL barrier-island NFIP claims averaged ~$134k vs mainland $46-68k. The brain has the per-ZIP signal in `data_lake.fema_nfip_claims` (89,492 SWFL rows with `reported_zipcode`, `flood_zone`, `occupancy_type`, paid amounts) — it just doesn't expose it.

**Intended outcome:** env-swfl emits per-ZIP financial flood risk (AAL$/yr per insured property + barrier-island classification). The flood-veto rule fires only when a barrier-island ZIP shows >$800/yr AAL — not on a metro-wide aggregate. Master's render mentions flood at most twice for a Fort Myers mainland refine, and once with a quantified $ value (not a categorical alarm) when it does.

---

## Recommendation: ONE design

### A. Output reshape — env-swfl emits per-ZIP records

**New `key_metrics`** (emitted in `envSwflOutputProducer`, deterministic math in `envSwflCorpusSummary`):

| Slug template                                       | Type                       | Computation                                                                                                                                              |
| --------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swfl_zip_{ZIP}_flood_aal_usd_per_insured_property` | number (USD/yr)            | `sum(paid_total over last 10 calendar years where reported_zipcode=Z) / 10 / insured_denominator(Z)`                                                     |
| `swfl_zip_{ZIP}_flood_aal_pct_swfl_rank`            | number (percentile 0-100)  | Percentile rank across all SWFL ZIPs with ≥1 claim in window                                                                                             |
| `swfl_zip_{ZIP}_barrier_island_score`               | number (0.0 / 0.5 / 1.0)   | From `BARRIER_ISLAND_ZIPS` table (§B)                                                                                                                    |
| `swfl_zip_{ZIP}_flood_cap_rate_adj_bps`             | number (bps midpoint)      | Lookup by barrier_score: 0.0 → 0 bps, 0.5 → 27.5 bps (range +20-35), 1.0 → 60 bps (range +50-70). Citation string carries the literal range.             |
| `swfl_zip_{ZIP}_insurance_pct_typical_noi`          | number (decimal, e.g 0.10) | `(AAL × 2) / (median_building_property_value × 0.08)` — loss-ratio inverse to imputed annual premium, divided by NOI imputed at 8% cap × property value. |

Top-6 highest-AAL ZIPs emit all five records each refine (5 metrics × 6 ZIPs = 30 slots; spec-validator ceiling honored). `insured_denominator(Z)` v1 = `population_estimate(Z) × 0.30` (NSI-penetration proxy, documented in caveats). v2 uses OpenFEMA Policies — deferred.

**Why bps + insurance-pct-NOI ride along with AAL:** the AAL$ is what the math says; the bps midpoint and the insurance-as-fraction-of-NOI are the CRE-investor translation. ULI/LaSalle 2024 surveys put the haircut at "+25-50 bps for elevated physical risk." Splitting it into 0.5-band ("+20-35 bps") and 1.0-band ("+50-70 bps") preserves that range while making mainland-vs-barrier the binding axis. Fed Reserve 2025: apartment insurance $39→$68/unit/mo nationally (+75% 2019-2024) with 72% NOI pass-through; SWFL post-Ian runs higher. The 8% cap-rate assumption for the NOI denominator is conservative for SWFL value-add multifamily and survives the smoothing-token ban (it's a stated assumption with a number, not a hedge).

**SWFL aggregates kept as anchors** (demoted, not removed): `swfl_sfha_pct_area_weighted`, county SFHA/VE breakouts, `swfl_post_ian_claims_ratio` (renamed from `swfl_flood_recovery_ratio` for clarity).

**Conclusion template** — three branches in `envSwflOutputProducer`, NOT LLM-generated. Each surfaces AAL$ + cap-rate bps range + insurance-pct-NOI for the top ZIP:

- **Mode 1 (barrier-island ZIP in snapshot, top_aal ≥ $800):** `"Barrier-island SWFL ZIPs carry order-of-magnitude higher flood loss: {top_zip} runs ${top_aal}/yr per insured property ({top_percentile}th percentile across {n_zips} SWFL ZIPs), vs the {county}-mainland median of ${mainland_median}/yr. CRE translation: +50-70 bps cap-rate adjustment for barrier-island flood exposure; imputed flood insurance runs {top_ins_pct}% of NOI at an 8% cap. Geography is the entire signal — flood risk for a {county} address is a property of the ZIP, not the metro."`
- **Mode 2 (no barrier ZIP, moderate coastal-mainland present):** `"SWFL coastal-mainland ZIPs cluster at ${median}/yr per insured property over the 10-year window, with no ZIP crossing the ${high_threshold}/yr barrier-island band. CRE translation: +20-35 bps cap-rate adjustment for coastal-mainland flood exposure; imputed flood insurance runs {top_ins_pct}% of NOI at an 8% cap. Flood exposure here is a real but bounded line item, not a structural veto."`
- **Mode 3 (only inland low-AAL ZIPs):** `"SWFL inland ZIPs in this snapshot show ${low_max}/yr or less per insured property over the 10-year window — below the ${low_threshold}/yr threshold where flood becomes a binding underwriting factor. CRE translation: no flood cap-rate adjustment indicated; imputed flood insurance runs {top_ins_pct}% of NOI."`

A trailing sentence appends only if `swfl_post_ian_claims_ratio > 2.0`: insurance-market signal recap.

**Caveats collapse to three.** Keep: (1) NFIP-uninsured floor, (2) denominator-is-population-proxy gap, (3) storm-list last-reviewed date. Drop the bbox-edge caveat (move to a code comment in `env-swfl-source.mts`), the LOMR caveat (move to source-level), the duplicate area-aggregate caveat, the duplicate USGS provisional caveat. The current 5-sentence "Downstream consumers should treat barrier-island and coastal-V/VE coordinates as flood-veto territory…" disclaimer sentence is deleted outright — the per-ZIP metrics are the receipt; prose disclaimers re-stating them violate CLAUDE.md "no caveat that restates a fact already in a metric."

### B. Geographic stratification — static table with data-driven validator

**Create `refinery/lib/swfl-geo.mts`** (NEW). Two exports:

```ts
export const BARRIER_ISLAND_ZIPS: ReadonlyMap<string, {
  zip: string;
  name: string;
  county_fips: string;
  classification: "barrier" | "coastal-mainland" | "inland";
  barrier_score: 0.0 | 0.5 | 1.0;
  population_estimate: number;  // 2020 ACS, rounded to nearest 1000
  notes: string;
}>;

export function barrierClassFor(zip: string): { score: 0.0 | 0.5 | 1.0; classification: ... };

export function validateClassification(zipAALs: Map<string, number>): string[];
// returns warnings if a ZIP not in the table ranks >80th percentile —
// build-time signal that the static table is stale, NOT a runtime override.

export function capRateBpsFor(barrier_score: 0.0 | 0.5 | 1.0): number;
// 0.0 → 0 bps; 0.5 → 27.5 (midpoint of +20-35); 1.0 → 60 (midpoint of +50-70).

export function capRateBpsRangeFor(barrier_score: 0.0 | 0.5 | 1.0): string;
// 0.0 → "no flood cap-rate adjustment"; 0.5 → "+20-35 bps"; 1.0 → "+50-70 bps".
// Used in the citation string on the cap-rate metric and inline in conclusion templates.
```

**Initial 12-ZIP seed** (manual curation, last_reviewed 2026-05-19):

| ZIP   | Place               | FIPS  | Class            | Score | Why                                  |
| ----- | ------------------- | ----- | ---------------- | ----- | ------------------------------------ |
| 33931 | Fort Myers Beach    | 12071 | barrier          | 1.0   | Ian 14-16 ft surge, ~90% destruction |
| 33957 | Sanibel             | 12071 | barrier          | 1.0   | causeway-only access                 |
| 33924 | Captiva             | 12071 | barrier          | 1.0   | barrier island                       |
| 34145 | Marco Island        | 12021 | barrier          | 1.0   | barrier island                       |
| 33921 | Boca Grande         | 12015 | barrier          | 1.0   | Gasparilla barrier                   |
| 34134 | Bonita Beach        | 12071 | coastal-mainland | 0.5   | beach-fronting mainland              |
| 34102 | Naples coastal      | 12021 | coastal-mainland | 0.5   | Naples city coastal grid             |
| 33914 | Cape Coral SW       | 12071 | coastal-mainland | 0.5   | canal grid, mainland                 |
| 33901 | Fort Myers downtown | 12071 | coastal-mainland | 0.5   | Ian 2-4 ft surge, structures intact  |
| 33990 | Cape Coral E        | 12071 | inland           | 0.0   | inland canal-fed                     |
| 34109 | North Naples        | 12021 | inland           | 0.0   | inland                               |
| 34112 | East Naples         | 12021 | inland           | 0.0   | inland                               |

**Pre-commit validation tests** (in `swfl-geo.test.mts`): 33931 → "barrier", 33901 → "coastal-mainland", 34112 → "inland". Asserts no orphan counties.

**Rejected alternatives:** a NOAA/USACE shapefile triggers the data-tier-policy brain-first gate for a 12-row problem; a pure data-driven classifier (claim-density threshold) is circular — the very metric we're computing.

### C. Flood-veto edge redesign

**Trigger rewrite** at `refinery/constitution/real-estate.mts:59-78`:

```ts
// Replaces the priority-90 ANY-VE-pct >5% trigger.
const FLOOD_BARRIER_MODE_1_AAL_THRESHOLD_USD = 800; // per insured property per year
const ZIP_AAL_PATTERN = /^swfl_zip_(\d{5})_flood_aal_usd_per_insured_property$/;
const ZIP_BARRIER_PATTERN = /^swfl_zip_(\d{5})_barrier_island_score$/;

const floodVeto: OverrideRule = {
  priority: 90,
  override_id: "flood-veto",
  effect: "force_bearish",
  condition: (upstreams: BrainOutput[]): boolean =>
    upstreams.some((u) => {
      const aalByZip = new Map<string, number>();
      const barrierByZip = new Map<string, number>();
      for (const m of u.key_metrics) {
        const aalMatch = ZIP_AAL_PATTERN.exec(m.metric);
        if (aalMatch && typeof m.value === "number")
          aalByZip.set(aalMatch[1], m.value);
        const barMatch = ZIP_BARRIER_PATTERN.exec(m.metric);
        if (barMatch && typeof m.value === "number")
          barrierByZip.set(barMatch[1], m.value);
      }
      for (const [zip, aal] of aalByZip) {
        if (
          aal >= FLOOD_BARRIER_MODE_1_AAL_THRESHOLD_USD &&
          (barrierByZip.get(zip) ?? 0) >= 1.0
        )
          return true;
      }
      return false;
    }),
};
```

Why regex instead of SKOS `resolveConceptSlugs`: the slug template embeds the ZIP. Enumerating 80 vocab entries to satisfy the existing helper would bloat `brain-vocabulary.json`. One-rule special-case, documented in header comment.

Delete `FLOOD_VETO_VE_THRESHOLD`, `FLOOD_VETO_CONCEPTS`, `FLOOD_VETO_METRICS`. The `hospitality.mts:16` comment references the old shape — update it to "regex-pattern flood-veto in real-estate.mts (post-2026-05-19 restructure)".

**Edge type at `refinery/packs/master.mts:229`:** change `env-swfl` edge from `"veto"` to `"modifier"`. Rationale per `refinery/types/pack.mts:39-51`: `"veto"` means "can flip downstream unilaterally", accurate only for the barrier-island case. `"modifier"` means "adjusts magnitude or confidence", accurate for the common Fort Myers / Cape Coral mainland refine. When the override actually fires for a barrier ZIP, `cascade.overrides` still names `"flood-veto"` — that's the receipt that the modifier flipped to veto-strength on this specific refine.

**Master's repetition fix.** In `masterSynthesizerOutputProducer` (`refinery/packs/master.mts:101-184`), after `cascade` and `key_metrics` are computed:

1. If any `key_metrics` entry matches `/^swfl_zip_\d{5}_flood_aal/`, drop any `cascade.caveats` entry matching `/flood-veto/` — the numeric metric IS the receipt; the prose caveat is redundant. Implemented as one filter line.
2. Run `dedupeCaveats(allCaveats)` — new utility in `refinery/lib/synth.mts`, pure function, substring-containment collapse on lowercase whitespace-normalized fingerprints. Preserves original order.

`composeConclusion` itself stays pure. The de-dup lives in master's producer where both arrays are visible.

### D. Data sources — vendor-first, tier-policy-compliant

| Source                                     | Status                                                                                                                                                    | Path                                                              | Brain-first gate                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `data_lake.fema_nfip_claims` (NFIP claims) | KEEP — extend `fema-nfip-source.mts` to bucket by `reported_zipcode` and emit `nfip-zip-aggregate` fragments                                              | unchanged tier                                                    | already in production                                                                          |
| `envSwflSource` (FEMA NFHL polygons)       | KEEP — anchors only, no parcel join                                                                                                                       | unchanged                                                         | already in production                                                                          |
| `usgs-water-source.mts`                    | KEEP — unchanged                                                                                                                                          | unchanged                                                         | already in production                                                                          |
| `storm-history-source.mts` (HURDAT2)       | KEEP — storm-shadow override still useful as 3-yr floor                                                                                                   | unchanged                                                         | already in production                                                                          |
| **FEMA NRI census-tract CSV**              | **OPTIONAL v1 / mandatory v2** — `hazards.fema.gov/nri/Public/NriExport/2023/CSV/NRI_Table_CensusTracts.csv`, free federal, ~1100 SWFL tracts             | Tier 1 Parquet at `data_lake/fema_nri_census_tracts_swfl.parquet` | env-swfl per-tract HLR-anchored AAL is the named consumer. Defer if v1 PR is getting too large |
| Census TIGER ZIP polygons                  | DEFER to v2 — one-time GIS preprocess, cache as fixture                                                                                                   | Tier 1 (fixture file)                                             | barrier-island validator is the consumer; v1's static table covers it                          |
| OpenFEMA NFIP Policies (denominator)       | DEFER to v2 — replaces population × 0.30 proxy with true insured count                                                                                    | Tier 2 (gated)                                                    | denominator-precision is the named consumer; documented as gap in v1 caveats                   |
| First Street / Jupiter / RMS               | **SKIP** — paid, $50k-$200k/yr, misaligned with bottom-up SWFL Data Gulf positioning. Free FEMA NRI + free NFIP claims deliver 80% of the signal at $0/yr | n/a                                                               | not pursued                                                                                    |

Per `feedback_market-positioning-bottom-up.md` and `feedback_no-competitor-trash-talk.md`: env-swfl's audience is small businesses / homeowners / citizens. A per-ZIP AAL number expressed in dollars is what a homeowner or small landlord understands. Paid enterprise cat models are a misalignment and never named in conclusion/caveats — no trash-talk.

### E. Render-layer concept-repetition cap

Add **Rule 3** to `refinery/validate/inference-bait-lint.mts` (alongside Rule 1 ambiguous-denominator and Rule 2 causal-chain-across-brains):

> **Concept-repetition cap.** A whitelisted concept (initial seed: `flood`) cannot appear in more than 2 distinct sections of `OUTPUT.json` among `{conclusion, caveats[], overrides[]}`. Violation aborts the render.

Implementation: count `/\bflood/i` occurrences across the three sections; if a single concept exceeds 2 distinct sections, throw with a message naming which sections. Whitelist lives at the top of the file; new concepts added as they surface.

This is the structural fix for the 4× repetition. Even if §A.3 and §C miss a path, Rule 3 catches it at validation time before render writes.

---

## Migration path — atomic groups

**Group B (one PR — env-swfl restructure):**

- `refinery/sources/fema-nfip-source.mts` — add `NfipZipAggregate` fragment kind, `aggregateZipRollupTop6` function
- `refinery/lib/swfl-geo.mts` (NEW) + `swfl-geo.test.mts` (NEW)
- `refinery/packs/env-swfl.mts` — `voteEnvDirection` rewrite, `envSwflOutputProducer` rewrite with mode-branched conclusion, `envSwflCorpusSummary` extended
- `refinery/vocab/brain-vocabulary.json` — add SKOS concepts `env_zip_flood_aal_usd_per_insured_property`, `env_zip_barrier_island_score`, `env_zip_flood_aal_pct_swfl_rank`, `swfl_post_ian_claims_ratio`
- `refinery/__fixtures__/fema-nfip-swfl.sample.json` — extend with ZIP-stratified rows
- `refinery/packs/env-swfl.test.mts` — three new tests (§G.4)

**Group C (separate PR, after B merges and produces per-ZIP metrics live):**

- `refinery/constitution/real-estate.mts` — replace `floodVeto` body with regex-pattern AAL trigger; delete `FLOOD_VETO_VE_THRESHOLD` / `FLOOD_VETO_CONCEPTS` / `FLOOD_VETO_METRICS`
- `refinery/constitution/real-estate.test.mts` — update tests to use new trigger shape
- `refinery/constitution/hospitality.mts:16` — update comment to reference new pattern
- `refinery/packs/master.mts:229` — change env-swfl edge_type `"veto"` → `"modifier"`
- `refinery/lib/synth.mts` — add `dedupeCaveats(caveats: string[]): string[]` pure function
- `refinery/packs/master.mts` producer — add caveat filter (drop flood-veto caveat when per-ZIP AAL metric present) + `dedupeCaveats` call
- `refinery/lib/synth.test.mts` — `dedupeCaveats` tests + integration assertion that Fort Myers Beach refine fires veto, Fort Myers mainland refine does not

**Group D (separate PR, after C merges):**

- `refinery/validate/inference-bait-lint.mts` — add Rule 3, seed whitelist with `flood`
- `refinery/validate/inference-bait-lint.test.mts` — Rule 3 tests

**Group E (post-Group-D, housekeeping):**

- `npm run ledger` — regenerates `docs/semantic-ledger.md` (auto-pulls from `brain-vocabulary.json`; no manual edit)
- `npm run triage` — regenerates `docs/orphan-triage.md`
- Re-render all role-targeted brain views

**Constitution registry trap check** (`feedback_ledger-constitution-registry.md`): this restructure modifies the EXISTING `real-estate.mts` constitution; no new constitution is added. The hardcoded import list in `refinery/tools/semantic-ledger.mts` is untouched. Safe.

---

## Verification (Section G)

### Commands

```
# Fixture-mode build, fast iteration
REFINERY_SOURCE=fixture npm run refinery env-swfl
npm run spec-validator -- brains/env-swfl.md
REFINERY_SOURCE=fixture npm run refinery master
npm run validate  # spec-validator + facts-only-lint + inference-bait-lint + smoothing-tokens

# Live-mode end-to-end
REFINERY_SOURCE=live npm run refinery env-swfl
REFINERY_SOURCE=live npm run refinery master

# Ledger + triage
npm run ledger
npm run triage
```

### Freshness token

Bumps automatically: env-swfl version → `vN+1` because `outputProducer` shape changed (key_metric slugs change). `freshnessToken()` (`refinery/lib/freshness.mts`) already incorporates version, so the rendered token transitions e.g. `SWFL-7421-v3-20260519` → `SWFL-7421-v4-20260519`. Master's freshness token follows on next refine. No format change needed.

### Expected behavior delta (must hold after Group B+C+D ship)

| ZIP                       | County  | AAL range $/yr | Class            | Flood-veto fires? | `flood` mentions in master OUTPUT |
| ------------------------- | ------- | -------------- | ---------------- | ----------------- | --------------------------------- |
| 33931 Fort Myers Beach    | Lee     | $1000–$5000    | barrier          | YES               | ≤3                                |
| 33914 Cape Coral SW       | Lee     | $100–$500      | coastal-mainland | NO                | ≤2                                |
| 33901 Fort Myers downtown | Lee     | $100–$400      | coastal-mainland | NO                | ≤2                                |
| 34145 Marco Island        | Collier | $800–$3000     | barrier          | YES               | ≤3                                |
| 34112 East Naples         | Collier | $50–$250       | inland           | NO                | ≤1 (may not surface)              |

### Anti-regression tests (must ship with Group B/C)

1. `env-swfl.test.mts`: synthetic 50-claim Ian-year fixture in 33931 → assert `key_metrics` contains `swfl_zip_33931_flood_aal_usd_per_insured_property` with value > 800 AND `swfl_zip_33931_barrier_island_score` === 1.0 AND `swfl_zip_33931_flood_cap_rate_adj_bps` === 60 AND `swfl_zip_33931_insurance_pct_typical_noi` > 0.05.
2. `env-swfl.test.mts`: 10-claim fixture in 33914 → assert AAL in $100–$500 range AND `swfl_zip_33914_barrier_island_score` === 0.5 AND `swfl_zip_33914_flood_cap_rate_adj_bps` === 27.5 AND conclusion uses Mode 2 template AND conclusion contains the literal "+20-35 bps".
3. `env-swfl.test.mts`: 2-claim fixture in 34112 → assert AAL < $300 AND `swfl_zip_34112_barrier_island_score` === 0.0 AND `swfl_zip_34112_flood_cap_rate_adj_bps` === 0 AND conclusion uses Mode 3 template AND conclusion contains "no flood cap-rate adjustment".
4. `master.test.mts` (or `synth.test.mts`): fixture with claims concentrated in 33901 only → `OUTPUT.overrides` does NOT contain `"flood-veto"`.
5. `master.test.mts`: fixture with claims concentrated in 33931 only → `OUTPUT.overrides` contains `"flood-veto"` AND `direction === "bearish"` AND `magnitude >= 0.85`.
6. `inference-bait-lint.test.mts`: synthetic OUTPUT mentioning `flood` in 3+ sections → Rule 3 throws.
7. `swfl-geo.test.mts`: `capRateBpsFor(0.0) === 0`, `capRateBpsFor(0.5) === 27.5`, `capRateBpsFor(1.0) === 60`. `capRateBpsRangeFor(1.0)` contains "+50-70".

---

## What this does NOT do

- Does not add property-level elevation, BFE, or LiDAR.
- Does not integrate Jupiter, First Street, RMS, KCC, AIR, or any paid cat model.
- Does not ingest OpenFEMA NFIP Policies (denominator stays a population proxy in v1; v2 follow-up).
- Does not add a NOAA / USACE shapefile.
- Does not change `finance`, `hospitality`, `macro`, or `logistics` constitutions (the hospitality comment touch in §C is doc-only).
- Does not change master's upstream list — env-swfl stays as one of 12 upstreams; only its `edge_type` changes (`veto` → `modifier`).
- Does not add a new constitution. The `semantic-ledger.mts` hardcoded import list is untouched.
- Does not rewrite `composeConclusion` itself — keeps that function pure; cleanup logic lives in master's producer plus the new `dedupeCaveats` utility.
- Does not change `voteEnvDirection`'s 3-year storm-shadow floor (still useful, still hardcoded).
- Does not change the freshness-token format.

---

## Critical files

- `refinery/packs/env-swfl.mts` — pack body, producer, voteEnvDirection (Group B)
- `refinery/sources/fema-nfip-source.mts` — ZIP-bucketed aggregator (Group B)
- `refinery/lib/swfl-geo.mts` (NEW) — barrier-island classification (Group B)
- `refinery/constitution/real-estate.mts` — flood-veto trigger rewrite (Group C)
- `refinery/packs/master.mts` — edge_type + caveat-dedup filter (Group C)
- `refinery/lib/synth.mts` — `dedupeCaveats` utility (Group C)
- `refinery/validate/inference-bait-lint.mts` — Rule 3 (Group D)
- `refinery/vocab/brain-vocabulary.json` — new SKOS concepts (Group B)
- `refinery/types/pack.mts` — **read only**, no edits (confirmed `BrainEdgeType` includes `"modifier"` at line 52)

## Reusable utilities to lean on

- `refinery/lib/freshness.mts` — `freshnessToken()` handles the v3→v4 bump automatically once `outputProducer` shape changes
- `refinery/lib/confidence.mts` — `computeConfidence` is unchanged; the three Tier-1 sources still average to 1.0
- `refinery/lib/synth.mts` — `applyOverrideCascade` is unchanged; only the rule body in real-estate.mts changes
- `refinery/render/master-index.mts` — unchanged; Rule 3 catches repetition at validation, not render
- `refinery/vocab/loader.mts` `resolveConceptSlugs` — used for the new SKOS concepts that DO have static slugs; the regex special-case is documented inline

---

## Open questions for review

1. **Threshold calibration.** `FLOOD_BARRIER_MODE_1_AAL_THRESHOLD_USD = 800`. Is this the right cut? It's calibrated from Wharton/Kousky NFIP-claims-based ranges (barrier-island avg claim ~$134k ÷ ~10-yr return ÷ ~30% policy denominator). Worth pressure-testing against the actual 89k-row SWFL claim data before locking.
2. **Should NRI ingest be in Group B or v2?** Including it makes the per-ZIP AAL a "claims OR NRI-tract-EAL" hybrid (more defensible). Deferring keeps the v1 PR small and reviewable.
3. **Top-6 ZIP cap.** Worth confirming spec-validator's metric-count ceiling before locking N=6. If the limit is higher, we can surface more.
4. **`flood-is-one-rule-not-the-headline` posture.** This plan keeps flood-veto in the cascade — it's one rule among many priority-90 overrides, not removed. Confirm that matches the intended brand posture.
