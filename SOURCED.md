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
