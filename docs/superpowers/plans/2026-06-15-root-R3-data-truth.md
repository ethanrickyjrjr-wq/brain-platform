# HANDOFF BRIEF — Root 3: Data correctness, grain & formatting

> Standalone brief. Hand this whole file to a fresh Claude. Companion roots:
> Root 1 (AI/project unify) → `2026-06-15-root-R1-unify-ai-project.md`;
> Roots 4+5 (visuals/discoverability) → `2026-06-15-root-R4R5-visuals-discoverability.md`.
> Source inventory: `2026-06-15-MASTER-PROBLEM-INVENTORY.md`.

**Goal:** the data must be *true* and read like a human wrote it. A client who
catches one wrong number stops trusting everything. This root is mostly
python-ingest + render-layer, independent of the Root-1 frontend work.

## A1 — DAT-6: Hurricane Ian is MISSING from the storm read (HIGHEST PRIORITY)
**Symptom (live):** a Fort-Myers-area read claims *"76 property-damage events…
ZERO reached hurricane-force wind (≥74 kt)"* and *"most recent billion-dollar
storm = 2004-08-13"* (Charley). Ian (2022, Cat 4, ~$112B, costliest in FL
history, devastated Lee) is absent. This alone destroys credibility.

**Where it lives:** NOT the pack — `refinery/packs/storm-history-swfl.mts` is a
pure reader of `extreme_wind_event_count` (the ≥74 kt filter) and
`last_billion_dollar_event_*` produced by the source connector
`refinery/sources/storm-history-source.mts` + the python ingest
`ingest/duckdb_pipelines/storm_history_swfl/` (`pipeline.py`, `constants.py`).

**Initial findings / likely causes (verify, don't assume — PROBE FIRST):**
1. **Ingest vintage stops before 2022.** `constants.py` `YEAR_RANGE_END` /
   the Tier-1 parquet `storm_events_swfl.parquet` may end pre-Ian. Check the
   `vintage_end_year` in the corpus summary vs. NCEI's published years; if it
   ends < 2022, re-run ingest with the current range. The pack caveat already
   says *"bump YEAR_RANGE_END … when NCEI publishes the next yearly file"* — it
   may simply never have been bumped.
2. **The ≥74 kt wind filter reads a null magnitude on the events that ARE Ian.**
   NOAA logs hurricane impact under event types (Hurricane / Storm Surge-Tide /
   Tropical Storm) that frequently carry **no `MAGNITUDE` wind value** — surge
   and flood rows log water, not wind. So `extreme_wind_event_count` (MAGNITUDE
   ≥ 74) can be literally 0 even with Ian in-corpus. The "hurricane-force"
   metric is measuring the wrong column. Fix: count hurricane-force from event
   TYPE (Hurricane/Tropical Storm) + magnitude where present, or rename the
   metric so it stops claiming "ZERO hurricane-force events."
3. **`last_billion_dollar_event` is stale / damage-string parse drops Ian.**
   The connector parses `damage_property` ("112B" etc.) best-effort; if Ian's
   rows have unparseable/`""` damage or the billion-dollar scan ends pre-2022,
   the "most recent" stays 2004. Cross-check `unparseable_damage_count`.

**Verify:** query the Tier-1 parquet directly (DuckDB) for Lee 2022 rows; confirm
Ian appears, what event types/magnitude/damage it carries, then make the metric
reflect reality. Re-run `npm run refinery -- storm-history-swfl --force` and read
the output. Then master.

**Gate reminders:** this touches `refinery/packs/**` + ingest → vocab `--all` +
per-pack test gates fire; any new/renamed metric slug must be registered in
`refinery/vocab/brain-vocabulary.json` **in the same commit**. Ingest changes:
PROBE FIRST, guard load-bearing columns before any destructive replace (BIBLE
§0.1/§0.2).

## A2 — DAT-5: storm name renders blank ("Hurricane on 2004-08-13")
A null/empty storm-name field yields "Hurricane on `<date>`". Find where the
storm-name field goes null in the flood/storm read path and guard it (should be
"Hurricane Charley"). Same source/ingest area as A1.

## A3 — OUT-4: a ZIP question answered with 3-COUNTY stats, mislabeled
Asking 33908 returns *"Lee county-wide, which covers 33908: Southwest Florida
(Lee + Collier + Charlotte)…"* — a 3-county figure dressed as a ZIP answer, with
a self-contradictory scope line. Borders the MOAT rule (never present a
county/region figure as a ZIP figure). **Fix:** when data only exists at a
coarser grain, answer at the ZIP grain first (or say "we hold this at county
grain"), then show the broader region as a clearly-labeled COMPARISON — never
lead with a half-region number labeled as the ZIP. Look at the coverage-label
logic in `lib/zip-dossier.ts` + `welcomeGroundedSpeakLine`'s "carry that label"
instruction and the storm pack's SWFL-wide rollup (it sums LEE+COLLIER+CHARLOTTE
with no ZIP grain — that rollup is what leaks as a "ZIP" answer).

## A4 — DAT-2: median price renders `400000` not `$400,000`
`lib/deliverable/examples.ts:97` (`value: String(m.value)`) stringifies the raw
number, dropping currency/units. Metrics carry `display_format`/`units` (see the
storm pack's `display_format: "count"`); apply a shared formatter at harvest +
render so `display_format:"currency"` → `$400,000`. Find/centralize the format
helper; don't hand-format per call site.

## A5 — DAT-1 / DAT-3 / DAT-4: citation bloat + URL leak baked into brain output
- CRE dossier ships ~87,843 chars of citation text over MCP
  (`refinery/packs/cre-swfl.mts:189-200`) — each metric's `source.citation`
  enumerates every corridor. Truncate/aggregate the citation at the brain-output
  layer (not just the render) so MCP/`/api/b` payloads shrink too.
- A raw `https://www.bls.gov/oes/tables.htm` is baked into the workforce brain's
  conclusion prose (`refinery/packs/labor-demand-swfl.mts:255-259,335`) → leaks
  as plaintext. Move the URL into `source.url`, keep prose clean.
- `/p/[id]` cards print full `source.citation` verbatim (DAT-4) — same root as
  DAT-1 surfaced on the deliverable page.

## A6 — FMT-1: dates must be MM/DD/YYYY EVERYWHERE
Output uses ISO `YYYY-MM-DD` (e.g. "2004-08-13"). Operator standard is
**MM/DD/YYYY** across every surface (reads, cards, charts, deliverables, emails,
MCP). Global render rule — find the date-render seam (`asOfFromToken`,
`lib/project/as-of.ts`, speaker layer) and centralize one formatter. Watch:
freshness tokens embed `YYYYMMDD` and must stay verbatim (don't reformat the
token).

**Suggested order:** A1 (credibility) → A2 → A3 → A4/A6 (formatting sweep) → A5.
