# lib/assistant/ — answer engine conventions (loads when you edit here)

This is the LIVE answer engine. The single most important fact:

- **User-facing framing lives in `refinery/lib/rules-of-engagement.mts`, NOT CLAUDE.md.** That lean block
  rides in every payload's `_meta.rules` (8 importers). To change what an answer believes (cite, grain,
  as-of date, no-jargon), edit THAT — and keep it ≤300 tokens, byte-mirrored across the 4 files guarded
  by `rules-of-engagement.test.mts`.
- **Charts: two layers, model never writes a number.** `composeChartFromRequest` (user-directed: held +
  web-cited + upload + user figures) runs first; `buildChartForQuestion` (auto: ranked-delta → rich
  pre-wired → generic any-brain bar) is the fallback. `lintChartBlock` is the belt-and-suspenders. Web
  search is wired via `external_points` → `fillExternalPoint` → `web_search_20250305`. To make more chart
  shapes buildable see `docs/superpowers/specs/2026-06-28-chart-ideas-and-dynamic-charts-handoff.md`.
- **Speaker hygiene:** no `§`, no internal pack IDs, no tier codes, no `master`/brain-id leakage. The
  `display-leak.test.mts` wall enforces it. Dates are MM/DD/YYYY (never the raw `SWFL-…-YYYYMMDD` token).
- **Never frame the product as "ZIP-level"** — the moat is four-lane at ANY grain (`zip-level-framing-lint`).
- **Tier:** 1 = small-talk / single fact · 2 = default analytical (table ≤6 rows) · 3 = full audit on
  explicit request only. Read rates as written; never recompute a rate from raw counts.
- **Answers are plain text** — no blockquotes, no tables (they break copy-paste).
