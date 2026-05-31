# SOURCED.md — Magic number citations

Every numeric constant in refinery pack code that affects scoring, confidence, or ranking
must have an entry here. Format: `## <anchor>` matching the `# see SOURCED.md#<anchor>`
comment in the code.

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
