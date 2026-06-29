# seller-stress-swfl — Design Spec
_Authored 2026-06-14. Status: APPROVED FOR IMPLEMENTATION_

---

## Why This Exists

No vendor publishes a composite seller stress score at ZIP grain that includes cancellation rate.
Zillow Market Heat Index is the closest competitor: equal-weight average of page views + price cut share + pending speed — no cancellations, not at ZIP grain, not SWFL-calibrated.
We have 7 years of monthly ZIP data (Apr 2019–May 2026, 126 SWFL ZIPs) across three Tier-1 parquets loaded 2026-06-14.
The gap is confirmed real; the data is already in the lake.

---

## What We Are Building

**Brain ID:** `seller-stress-swfl`

A new standalone brain (not an extension of housing-swfl) that reads three Tier-1 Parquet tables, computes a deterministic composite seller stress score per ZIP per period, and emits a regional direction read + per-ZIP detail table.

**skipSynthesisAgent: true.** All math is deterministic. No Anthropic API call during build.

---

## Source Tables

All three are Tier-1 Parquet in `s3://lake-tier1/`, registered in `cadence_registry.yaml`:

| Table | Parquet path | Key columns used |
|---|---|---|
| `redfin_price_drops_swfl` | `market/redfin_price_drops.parquet` | `zip_code`, `period_begin`, `pct_active_with_drops`, `avg_price_drop_pct` |
| `redfin_contract_cancellations_swfl` | `market/redfin_contract_cancellations.parquet` | `zip_code`, `period_begin`, `cancellation_rate_pct` |
| `redfin_delistings_relistings_swfl` | `market/redfin_delistings_relistings.parquet` | `zip_code`, `period_begin`, `share_delisted_pct`, `share_relisted_pct` |

**Column trap:** `data_lake.redfin_swfl` (old tracker) has a `price_drops` column that is 100% NULL. Never read from `redfin_swfl` for stress signals — use only the three standalone tables above.

---

## Composite Score Design

### Inputs and Polarity (all NEGATIVE-ON-RISE)

| Signal | Source column | Weight | Indicator type | Source for weight |
|---|---|---|---|---|
| Delistings rate | `share_delisted_pct` | **0.30** | LEADING | Redfin Nov 2025 research: delistings lead price unlock; highest weight for the leading signal |
| Price drop breadth | `pct_active_with_drops` | **0.25** | Coincident | Zillow MHI methodology (2024): price cut share is the primary seller-side coincident signal |
| Cancellation rate | `cancellation_rate_pct` | **0.25** | Lagging (~30-60 days) | SWFL-specific: buyer withdrawal as contract execution test; not in any public composite |
| Avg price drop depth | `avg_price_drop_pct` | **0.15** | Lagging | Dallas Fed nowcast (2023): depth amplifies breadth signal but lags it |
| Relisting rate | `share_relisted_pct` | **0.05** | Coincident | Redfin Data Center definition: relisting = delisted then returned; low-information at ZIP grain |

Polarity audit: ALL FIVE signals are negative-on-rise (higher value = more seller stress = bearish).
No inversion needed. Rising delistings, rising price drops, rising cancellations, larger drops, more relistings = all bearish.

Sum of weights: 0.30 + 0.25 + 0.25 + 0.15 + 0.05 = **1.00** ✓

### Baseline Window

Normalize each metric per ZIP against its own **2019-01-01 through 2021-12-31** average and standard deviation.
Rationale: 2019 = pre-COVID, pre-rate-shock equilibrium. 2020–2021 included because the SWFL market was not yet in extreme distortion (rates still near zero). Excludes 2022 onwards (rate shock + Ian) — those are the stress events we want to detect, not bake into the baseline.

Minimum observations for baseline: **N_BASELINE_MIN = 18** periods. A ZIP with fewer than 18 monthly observations in the 2019–2021 window gets no score (no suppression — suppress with null, never invent a baseline from 1-2 obs).

### Z-Score Normalization

For each signal `x` for ZIP `z`:
```
z_score(x, z) = (x - mean_baseline(x, z)) / stddev_baseline(x, z)
```

If stddev = 0 (no variation in baseline), treat z_score as 0 for that metric.

### Composite

```
raw_composite(z, t) = sum(weight_i * z_score(signal_i, z, t)) for all i
```

Map raw_composite to 0-100 scale anchored on historical percentiles:
- raw_composite <= -2.0 → score 0 (very low stress)
- raw_composite = 0.0 → score 50 (baseline-average stress)
- raw_composite >= +2.0 → score 100 (extreme stress)
- Linear interpolation between anchors

Named constants (must appear in pack code with source comment):
```typescript
const DELISTING_WEIGHT = 0.30;   // Redfin Nov 2025: delistings lead price unlock
const PRICE_DROP_BREADTH_WEIGHT = 0.25; // Zillow MHI (2024): price cut share = primary coincident
const CANCELLATION_WEIGHT = 0.25; // SWFL-specific: not in any public composite
const PRICE_DROP_DEPTH_WEIGHT = 0.15; // Dallas Fed (2023): depth lags breadth
const RELISTING_WEIGHT = 0.05;   // Low-information at ZIP grain

const BASELINE_START = "2019-01-01"; // Pre-COVID, pre-rate-shock equilibrium
const BASELINE_END   = "2021-12-31"; // Rate shock + Ian starts 2022; exclude

const N_BASELINE_MIN = 18; // Min monthly observations in baseline window to compute a score
const N_TRAILING_MIN = 3;  // Min recent periods to compute a current reading

const SCORE_FLOOR_SIGMA = -2.0; // raw composite at or below this → score 0
const SCORE_CEIL_SIGMA  =  2.0; // raw composite at or above this → score 100
```

---

## Direction Logic

| Score | Direction | Label |
|---|---|---|
| >= 65 | `bearish` | High seller stress — delistings/cancellations elevated vs 2019-2021 baseline |
| 45–64 | `mixed` | Moderate stress — some signals elevated, others not |
| 35–44 | `neutral` | Near-baseline stress |
| < 35 | `bullish` | Low stress — seller confidence above pre-shock norms |

Magnitude = `abs(score - 50) / 50`, clamped to [0, 1].

---

## Minimum Sample Guard

Two guards:
1. **Baseline guard**: fewer than `N_BASELINE_MIN` observations in 2019–2021 → zip score = null (suppress)
2. **Trailing guard**: fewer than `N_TRAILING_MIN` observations in the trailing window → zip score = null (suppress)

Suppressed ZIPs are silently dropped from the composite (not counted in the SWFL average). Do not impute, do not carry forward stale scores.

---

## Key Metrics to Emit

| Slug | Description | Units | Format |
|---|---|---|---|
| `seller_stress_score_swfl` | SWFL regional median seller stress score (all scored ZIPs) | score 0-100 | raw |
| `seller_stress_delistings_rate_swfl` | SWFL median share of listings delisted (latest period) | percent | percent |
| `seller_stress_price_drops_rate_swfl` | SWFL median % active listings with a price drop (latest period) | percent | percent |
| `seller_stress_cancellation_rate_swfl` | SWFL median contract cancellation rate (latest period) | percent | percent |
| `seller_stress_avg_drop_depth_swfl` | SWFL median average price drop size (latest period) | percent | percent |

All five slugs must be registered in `brain-vocabulary.json` (concept + slug_index entry) in the same commit.

---

## Per-ZIP Detail Table

Emit one row per scored ZIP with:
- `seller_stress_score` — composite 0-100
- `share_delisted_pct` — raw value
- `pct_active_with_drops` — raw value
- `cancellation_rate_pct` — raw value
- `avg_price_drop_pct` — raw value
- `share_relisted_pct` — raw value
- `periods_scored` — how many months went into the trailing reading
- `baseline_suppressed` — true if ZIP was suppressed (omit score)

Table id: `seller_stress_by_zip`. Grain: `zip`. Rides in the dossier.

---

## SWFL-Specific Caveats (required in pack output)

1. "~50% of SWFL transactions are all-cash (Lee County, Attom 2024) — rate-sensitive national thresholds do not apply; this score is calibrated to SWFL's own 2019–2021 baseline."
2. "Hurricane Ian (Sept 2022) produced a natural spike; scores from Oct 2022–Mar 2023 reflect forced delistings, not organic seller stress — treat as a labeled distress event, not a trend."
3. "Condo segment is not separated in this score; SB 4-D special assessment delistings inflate stress in condo-heavy ZIPs (e.g., Marco Island corridor). See `condo-sirs-swfl` for the condo-specific read."

---

## Architecture

```
[Tier-1 Parquet] ──────────────────────────────────────────────────────────┐
  redfin_price_drops.parquet  →  stressDropsSource (DuckDBSource)          │
  redfin_contract_cancellations.parquet → stressCancSource (DuckDBSource)  │
  redfin_delistings_relistings.parquet  → stressDelistSource (DuckDBSource)│
                                                                            ▼
                                                             sellerStressSwfl (PackDefinition)
                                                               corpusSummary():
                                                                 join 3 tables on (zip, period)
                                                                 compute baseline stats (2019-2021)
                                                                 compute z-scores per signal
                                                                 weighted composite → 0-100 score
                                                               outputProducer():
                                                                 top/bottom 5 stress ZIPs
                                                                 SWFL median score
                                                                 direction + magnitude
                                                                 per-ZIP detail_table
```

No `input_brains`. No upstream brain dependency. All inputs are Tier-1 Parquet.

---

## Files to Create

| File | Purpose |
|---|---|
| `refinery/sources/stress-price-drops-source.mts` | DuckDB source for price_drops parquet |
| `refinery/sources/stress-cancellations-source.mts` | DuckDB source for cancellations parquet |
| `refinery/sources/stress-delistings-source.mts` | DuckDB source for delistings_relistings parquet |
| `refinery/packs/seller-stress-swfl.mts` | Pack definition + composite math |
| `refinery/packs/seller-stress-swfl.test.mts` | bun:test assertions |
| `refinery/packs/catalog.mts` | Add entry: id, domain, scope, ttl |
| `refinery/vocab/brain-vocabulary.json` | +5 slugs (concept + slug_index per slug) |

Register in `refinery/packs/index.mts` (import + PER_PACK_REGISTRY entry).

---

## Pre-Build Probe Required

Before writing any pack code, run DuckDB probes on all three Tier-1 Parquets:
- Confirm exact column names (the raw CSV used spaces; parquet normalizer maps them)
- Confirm ZIP column name and sample values (should be `zip_code`, values like "33908")
- Confirm metric columns are stored as FLOAT, not VARCHAR
- Get a sample row from each table (latest period, one Cape Coral ZIP)

The three pipeline normalizers mapped columns during ingest:
- price_drops: `zip_code`, `period_begin`, `pct_active_with_drops`, `avg_price_drop_pct`
- cancellations: `zip_code`, `period_begin`, `cancellation_rate_pct`
- delistings: `zip_code`, `period_begin`, `share_delisted_pct`, `share_relisted_pct`

Probe confirms these are correct before trusting them in the pack.

---

## Out of Scope (v1)

- City/neighborhood grain (pipelines not built yet)
- DOM, inventory, pending enrichment (new housing tracker pipeline not yet built)
- Property-type split (SFH vs condo) — v2
- HMM Regime Classifier — separate spec, separate PR

---

## Opus or Sonnet?

**Sonnet.** This is deterministic math with a clear algorithm and established pack patterns.
The logic is: join 3 tables → compute baseline stats → z-score → weighted sum → scale → emit.
No novel architecture decisions remain; the research phase is complete.
Opus is warranted for the HMM Regime Classifier (v2) — novel ML architecture, no precedent in this codebase.

---

## Acceptance Criteria

1. `bun test refinery/packs/seller-stress-swfl.test.mts` passes
2. `bun refinery/tools/check-vocab-coverage.mts --all` passes (0 orphans)
3. `npm run refinery -- seller-stress-swfl --target-only` renders without errors
4. Output direction is `bearish` for at least one SWFL ZIP in the current period (stress signals are elevated post-Ian)
5. `catalog.test.mts` passes (Gate 5)
6. `N_BASELINE_MIN` guard suppresses at least 1 ZIP (confirms the guard fires on thin data)
7. All 5 weight constants have inline source comments
