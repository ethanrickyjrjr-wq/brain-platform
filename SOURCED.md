# SOURCED.md — Magic number citations

Every numeric constant in refinery pack code that affects scoring, confidence, or ranking
must have an entry here. Format: `## <anchor>` matching the `# see SOURCED.md#<anchor>`
comment in the code.

---

## tier-divergence-swfl-deadband

**DEADBAND: ±1.0 percentage point on the regional-median YoY signals (tier_spread_yoy_pct, tier_bottom_yoy_pct)**

`tier-divergence-swfl` reads a region bearish when the median luxury/starter spread YoY widens past
+1.0pp OR the median starter-tier YoY falls past −1.0pp; bullish only when the spread compresses past
−1.0pp AND the starter tier rises past +1.0pp (see `classifyPolarity`, `refinery/packs/tier-divergence-swfl.mts`).
The K-shape breakpoints (luxury YoY ≥ 0 AND starter YoY < 0) sit at the natural 0 line and need no citation.

**PROVISIONAL v1 — empirical, not published.** No vendor publishes a tier-divergence noise floor (no
vendor publishes a ZIP-level tier divergence at all). 1.0pp is a placeholder dead zone to ignore
sub-1pp month-to-month wobble in a RAW (not seasonally adjusted) index.

**Calibration instruction (graduation gate):** before this brain graduates from `KNOWN_INCOMPLETE` to
`BRAIN_CATALOG` (first clean live cycle), recompute the deadband as ≈1 SD of `tier_spread_yoy_pct`
across the ~107 both-tier SWFL ZIPs over a baseline that **EXCLUDES the 2020–2021 COVID appreciation
spike** (folding it in inflates the SD and over-widens the band) — e.g. 2018–2019 pre-shock plus
2023-onward post-normalization, or a robust dispersion (MAD/IQR) over the full series. Replace 1.0 with
the measured value. The code comments the update point at the `DEADBAND` constant.

---

## tier-divergence-swfl-tier-geography

**Zillow ZHVI tier cut geography = PER METRO/REGION (RESOLVED 2026-06-14, Zillow ZHVI User Guide).**

The bottom (5th–35th pct) and top (65th–95th pct) cutpoints in the ZIP-level tier files
(`Zip_zhvi_uc_sfrcondo_tier_0.0_0.33_month.csv` / `…_0.67_1.0_…`) are computed **per metro/region and
then applied to each ZIP** — NOT per-ZIP quantiles, NOT a national cut. A ZIP's `top_tier_value` is the
ZHVI of that ZIP's homes falling in the metro's upper band (Cape Coral-Fort Myers / Naples-Marco
Island), not "that ZIP's own top third." `tier-divergence-swfl` keeps its claim text observable —
top-tier $ value vs bottom-tier $ value and their ratio — and never asserts per-ZIP percentile semantics.

**Coverage note (33972 / 33974 Lehigh Acres):** these publish a top-tier value but no bottom-tier
series. As the cheap end of the metro they would be full of metro-bottom-band homes, so the missing
bottom tier is a **Zillow publish-coverage gap**, not percentile semantics. They have no both-present
anchor → the brain-input view excludes them (no spread computable); their single-tier history is
retained in `data_lake.tier_divergence_swfl` (FULL OUTER JOIN keeps it; not truncated).

Was an open question at build time (the methodology HTML was CAPTCHA-blocked); resolved against the
Zillow ZHVI User Guide. Filename percentile encoding (0.0_0.33 = bottom, 0.67_1.0 = top) confirmed by
live dollar values (luxury > starter for 33901/33914/34102/34108).

---

## labor-demand-swfl-wow-threshold

**wowDirection threshold: ±3% WoW**

No published noise floor exists for Lightcast/DEO OSPA weekly county-level job posting counts.
This is an empirical engineering estimate based on:

1. **Posting timing lag**: Lightcast scrapes multiple job boards on a rolling basis. A job posted
   Friday afternoon may be captured Saturday or Monday, shifting counts ±1–2% between adjacent
   calendar weeks independent of any real demand change (Lightcast methodology guide, §3 "Data
   Collection"; no specific county noise number is published).
2. **Deduplication jitter**: The same vacancy posted to LinkedIn, Indeed, and a company site is
   deduplicated by Lightcast with a 24–72h window. Dedup resolution that straddles a week boundary
   can cause a single job to appear/disappear week-to-week (same source, §4 "Deduplication").
3. **County-level vs. MSA-level**: DEO OSPA data is published at county level. County counts are
   lower-volume than MSA aggregates, so proportional noise is higher. No specific county noise
   quantile is published; 3–5% is accepted practice in regional LMI work (CareerSource FL
   practitioner communications; not a formal publication).

**Calibration instruction**: The 3% floor should be re-evaluated after the first 8 live weeks.
If direction flips every week with <3% moves, tighten to 2%; if true demand shifts are being
suppressed at 3%, loosen to 5%. The code comments the update point at `wowDirection()`.

**Comparison**: BLS LAUS ±0.2pp is a published revision floor (BLS LAUS Handbook of Methods,
Chapter 4, Table 4-2). Lightcast has no equivalent published table — hence the "empirical estimate"
classification here, not a "cited" one.

---

## econ-dev-swfl-qualifying-categories

**Momentum count restricted to categories: {relocation, expansion, grant, infrastructure}**

The `econ_dev_announcements_90d` momentum metric counts only rows whose inferred `category` is in
this set (see `isQualifying`, `refinery/packs/econ-dev-swfl.mts`). It is an engineering calibration,
not a published figure:

1. **Source is a mixed feed, not an announcement wire.** SWFL Inc. publishes under
   `swflinc.com/blog/` category sub-feeds (`/business-development`, `/chamber-news`, `/policy`).
   These interleave genuine project announcements (relocations, expansions, grants) with chamber
   marketing, events, awards, and policy commentary. Counting raw rows would inflate the momentum
   signal with non-project noise.
2. **Why these four.** `relocation`/`expansion`/`grant`/`infrastructure` are the categories that
   represent capital projects or public-investment events — the leading indicator the brain exists
   to track. `partnership` and `workforce` are still classified by the pipeline (and stored) but
   excluded from the headline count: they are predominantly MOUs, coalitions, and training/event
   pieces, not capital projects.
3. **Classification is heuristic and imperfect.** `_infer_category` (regex keyword match in
   `ingest/pipelines/swfl_inc/pipeline.py`) over-fires — e.g. the substring "report" matches the
   `port\b` infrastructure pattern; "Awards" matches the `award` grant pattern. The brain emits a
   per-build caveat ("N of M announcements … matched qualifying categories") so the signal-to-noise
   ratio is visible without log-trawling. Tighten the patterns (or require a hard signal — a `$`
   figure, a company name, a job count) if the caveat shows the count is dominated by false positives.

**Page-1-only scrape (no pagination)**: verified 2026-05-30 that the oldest item on page 1 of each
feed is years old (business-development 2021-12, chamber-news 2023-03, policy 2022-08), all well
past the 90-day window cutoff. Page 1 therefore fully contains the brain's 90/180-day windows;
pagination would only add stale rows. Re-check if a feed's posting cadence rises sharply.

---

## fgcu-reri

**confidence: 0.85**

- Rationale: FGCU RERI is a primary university source (Lutgert College of Business,
  peer-reviewed methodology). Single-source brain with no cross-validation upstream.
- Data lag: ~2 months structural (e.g., May 2026 report covers March 2026 data).
  Lag is baked into `caveats` on every build, not penalized in confidence.
- Benchmark: BLS LAUS (government primary, single-source) ships at 0.80–0.85 in macro-swfl.
  FGCU RERI is comparable provenance quality.

**fitScore: 0.7**

- Rationale: Dedicated SWFL regional macro leaf. Always relevant to SWFL macro queries.
  Not a universal macro brain (no national/state coverage) — capped below 1.0 to allow
  broader-scope brains to rank above it when the query is national or Florida-wide.

---

## safety-swfl-direction-threshold

**crimeDirection / rateTrend threshold: ±3% YoY (`DIRECTION_THRESHOLD_PCT`)**

A property-crime-rate YoY change of magnitude ≥ 3% flips the brain bullish (falling crime) or
bearish (rising crime); smaller moves read as neutral. Engineering estimate, not a published
figure:

1. **No published county-level UCR/FIBRS noise floor.** FDLE does not publish a year-over-year
   revision band for county Part I property-crime rates, so there is no authoritative threshold to
   cite (contrast BLS LAUS ±0.2pp, which is published).
2. **Population denominator drift.** The covered-population denominator moves ~1–3%/yr with organic
   growth even when the agency roster is stable, so a sub-3% rate change is within denominator noise.
3. **Calibration knob.** If the first live FBI-CDE-sourced years show the brain flipping on noise,
   tighten toward 5%; if it sits neutral through real moves, loosen toward 2%. Update point:
   `crimeDirection()` / `rateTrend()` in `refinery/packs/safety-swfl.mts`.

## safety-swfl-magnitude-divisor

**magnitude = min(1, |YoY %| / 15) (`MAGNITUDE_YOY_DIVISOR`)**

Normalizes the YoY rate change into the 0–1 magnitude scale; a 15% YoY swing saturates to full
magnitude. Engineering estimate: a 15% single-year move in a county property-crime rate is a
genuinely large shift (multiples of the ±3% direction threshold), so it anchors the top of the
scale. Not a published figure; same calibration discipline as the direction threshold.

## safety-swfl-coverage-shift-threshold

**Coverage-shift suppression: ±10% covered-population YoY (`COVERAGE_SHIFT_SUPPRESS_PCT`)**

FIBRS reports per-agency; the per-1k denominator is the sum of the populations of the agencies that
reported that year (the "covered population"). When that covered population moves more than 10% YoY,
the brain suppresses the direction to neutral and caveats it. Engineering estimate:

1. **Organic county population growth is ~1–3%/yr** (Census PEP, Lee/Collier). A covered-population
   move >10% cannot be organic — it means an agency entered or left the FIBRS roster.
2. **The roster genuinely swings.** Cape Coral PD (~25% of Lee County's population) reports to FIBRS
   in 2024 but is absent in 2021/2025. Including/excluding it shifts Lee's covered population
   ~25–40% — far above 10% — while a like-for-like comparison would not.
3. **Why suppress rather than adjust.** When the footprint changes, the numerator (crimes) and the
   geography both change, so the YoY rate is not a like-for-like comparison and cannot be rescued by
   normalizing the denominator alone. Neutral + caveat is the honest output. Update point: the
   coverage-shift guard in `safetyOutputProducer`.

**Note:** this guard makes the data internally honest; it does NOT fix the FIBRS undercount versus
the FDLE UCR baseline (incomplete NIBRS-transition participation). That is a source-fitness problem
tracked separately — `safety-swfl` stays dormant until a complete county source (FBI CDE) replaces
FIBRS aggregation.

---

## swfl-zip-county-pop-override

**`fixtures/swfl-zip-county.json` primary_county override: `33936` → Lee (`12071`)**

The spine's `primary_county` is normally the in-scope county with the largest `AREALAND_PART`
overlap in the U.S. Census 2020 ZCTA-to-county relationship file
(`tab20_zcta520_county20_natl.txt`). For ZCTA **33936** that metric ranks **Hendry (`12051`)
first** (63,780,211 m²) over **Lee (`12071`)** (29,834,595 m²), because the 33936 ZCTA stretches
east into vast, near-empty unincorporated Hendry land while the *populated* grain — Lehigh Acres —
sits in Lee. Land area misranks population here.

**Corrected to Lee on sourced grounds:**

1. **USPS preferred mail city for 33936 is "Lehigh Acres," Lee County** (USPS ZIP Code Lookup,
   tools.usps.com; same source of record as `fixtures/swfl-place-zip-crosswalk.json`, whose
   Lehigh Acres entry is `county: lee`, primary ZIP `33936`).
2. **Lehigh Acres CDP is entirely within Lee County** (U.S. Census place definition); the Hendry
   portion of the ZCTA is unincorporated, essentially unpopulated rangeland.
3. **Routing consequence (why it matters, not cosmetic):** `resolveZip(zip).primary_county` is the
   county-gate the §C fan-out uses (G2). A Hendry primary would route every Lehigh Acres ZIP query
   *away from* the Lee+Collier brains that actually hold its data. Population-dominant primary is
   the honest, useful assignment.

This is the **only** population override. The 2020 relationship layout carries no `ZPOPPCT`/`ZHUPCT`
field (verified live 2026-06-10), so overrides are documented case-by-case here rather than computed.
Census remains the sole *scope* authority; this override only re-ranks the primary among the
ZCTA's in-scope counties. Codified in `scripts/build_swfl_zip_county.py` (`POP_PRIMARY_OVERRIDE`)

---

## seller-stress-swfl-score-ceiling-sigma

**Display ceiling: raw composite ≥ 3.0σ → score 100 (`SCORE_CEIL_SIGMA`); floor −2.0σ → 0**

The 0–100 seller-stress score is a linear map of each ZIP's raw composite (a baseline-relative
z-score blend) clamped to [FLOOR, CEIL]. CEIL was 2.0 in v1, which pegged the entire top decile at
100. Widened to 3.0 on 2026-06-14 from a **measured** live distribution — not a guessed value:

1. **Measured, not assumed.** A live render (29,865 fragments) showed 11 of 111 scored ZIPs at
   exactly 100. Their raw composites spanned **2.02–3.05σ**: a single 3σ outlier (33983 @ 3.05) over a
   cluster at 2.02–2.58. CEIL=2.0 flattened all 11 to an identical 100, erasing real differences.
2. **Why 3.0 (the observed extreme).** Anchoring the ceiling at the largest observed composite lets
   the outlier read 100 while the cluster spreads ~80–92; ceiling saturation drops 11→1. A larger
   value (e.g. 3.8) has no support in the data and would push the genuine extreme below 100; a smaller
   one (2.5) leaves 2 pegged with a narrower spread.
3. **Floor unchanged (−2.0).** The distribution is right-skewed toward stress; there is no floor-side
   saturation, so widening the floor would only dilute the bullish tail without fixing anything.
4. **Display only — direction is decoupled.** `direction`/`magnitude` read the SWFL **median raw
   composite** (sigma space), not the clamped score, so widening the ceiling cannot move the call. The
   direction gates — bearish ≥ 0.6σ, mixed ≥ −0.2σ, neutral ≥ −0.6σ, else bullish — are the prior
   score gates (65/45/35) inverted through the v1 map (FLOOR −2 / CEIL +2): they preserve the exact v1
   classification while being invariant to CEIL. Post-change live check: median raw 1.06σ → bearish
   (unchanged), magnitude 0.53 (unchanged), top decile spread 80–100. Locked by the
   `rawCompositeToScore` + measured-cohort regression tests. Update point: `SCORE_CEIL_SIGMA` and the
   direction block in `sellerStressOutputProducer`, `refinery/packs/seller-stress-swfl.mts`.

---

## sba-foia-franchise-row-counts

**SBA 7(a) FOIA — Lee + Collier franchise row counts (verified 2026-06-14, full-file reads)**

Source: U.S. SBA FOIA data portal — `https://data.sba.gov/en/dataset/7-a-504-foia`
Filter applied: `projectstate='FL' AND projectcounty IN ('LEE','COLLIER') AND franchisename != ''`

| File          | Franchise rows | Total rows in file |
|---------------|---------------:|-------------------:|
| FY2000–2009   |             83 |            690,333 |
| FY2010–2019   |          160   |            545,751 |
| FY2020–pres   |          210   |            373,981 |
| **Total**     |        **453** |          1,610,065 |

Row counts are from a full-file DuckDB read on 2026-06-14. The SBA updates these files quarterly
(~1 month after each quarter end); row counts will grow. The pipeline guard
(`if len(rows) == 0: sys.exit(1)`) ensures a stale/empty pull aborts rather than overwriting the
Parquet with nothing.

**N_MIN_RESOLVED = 3** — minimum resolved loans (PIF + CHGOFF) required to compute a
`survival_rate` or `chargeoff_rate` at the ZIP-approx grain. At county grain, all brands are
included regardless of resolved count (rates are NULL when resolved = 0).

This threshold is consistent with existing pack logic (`refinery/config/packs.mts:168`,
`resolvedOf(n) >= 3` for the "strong performers" filter) and with PeerSense SBA franchise
methodology (peersense.com/industry-data, methodology page, verified 2026-06-14):
> "Brands with fewer than three resolved loans are excluded from rate calculations to avoid
> statistically unstable ratios."

**ZIP-approx note:** the SBA FOIA has no `projectzip` column. `zip_approx` is derived from
`borrcity + projectcounty` via `ingest.utils.zip_approx.get_zip_approx()` (Census Geocoder →
nearest ZCTA centroid). `zip_is_approx` is always `True`; these cells go to `detail_tables`
only and are never used to compute county-level direction signals.

At 453 total rows across ~26 years, most brand×ZIP cells will have far fewer than 3 resolved loans
(453 rows ÷ ~50 active brands ÷ ~15 distinct borrower cities ≈ <1 loan per brand/city). The
original Firecrawl-era estimate of "15-25 loans per high-volume ZIP over 25 years" was a projection
for a dense national dataset, not the SWFL-filtered slice. In practice, N_MIN_RESOLVED=3 will
suppress the vast majority of ZIP-approx cells. This is acceptable: the ZIP Parquet is
supplemental detail-layer only; the county Parquet drives all direction signals.

**Graduation threshold (operational gate, not a scoring constant):**
`franchise_foia_first_run` check uses "≥50 brands in Parquet" as the flip-to-live gate. Rationale:
the fixture has 15 synthetic brands; at ≥50 real brands the county Parquet is demonstrably broader
than the fixture and worth switching. This is an operational sanity check, not a mathematical
threshold — it does not affect scoring, confidence, or ranking. No citation required.

**Polarity table (for direction-vote build, Phase 2, see concern #5):**
| metric              | direction vote        | notes                                                  |
|---------------------|-----------------------|--------------------------------------------------------|
| `survival_rate`     | rising = **bullish**  | PIF/(PIF+CHGOFF); YoY comparison drives the vote       |
| `chargeoff_rate`    | rising = **bearish**  | CHGOFF/(PIF+CHGOFF); inverse of survival_rate          |
| `n_loans`           | volume only, no vote  | total loans including active/delinquent                |
| `total_gross_approval` | volume only, no vote | avg_loan_size useful for context, not polarity        |
Both rates are over **resolved loans only** (PeerSense methodology). Do not compute rates over all
loans including active/delinquent — that dilutes toward neutral as cohort ages and is not
comparable across brands with different loan-age profiles.

**ZIP citation deferred (TODO):**
If the ZIP-approx Parquet is ever surfaced in a `detail_tables` consumer, the citation source
string MUST carry the `zip_is_approx=True` signal — e.g.
`"SBA 7(a) FOIA — franchise loan outcomes, ZIP-approx (borrower city → nearest ZCTA centroid; NOT project ZIP)"`.
The franchise-source.mts live path reads only the county Parquet; the ZIP citation is wired when a
consumer is built (see TODO comment in franchise-source.mts).
