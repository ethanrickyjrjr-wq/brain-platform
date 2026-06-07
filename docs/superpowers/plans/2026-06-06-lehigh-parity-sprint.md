# Lehigh Acres → Fort Myers / Naples parity — parallel agent sprint (AUDITED)

**Status:** brief for execution, not a status board (RULE 2). Open obligations live in the
`checks` ledger, never as ⬜/✅ here. Audited 2026-06-06 against live code + DB + git — every
claim below was re-verified this session, not inherited. Corrections from the audit are marked
**[AUDIT]**.

## Goal

Make a Lehigh corridor page (`/r/cre-swfl/lee-blvd-lehigh-acres`,
`/r/cre-swfl/joel-blvd-lehigh-acres`) indistinguishable in depth from a Fort Myers one.
Lehigh has two live corridors in `corridor_profiles` (Lee Blvd, Joel Blvd), both with NULL
CRE metrics and NULL `character_*`. Its six ZIPs (33936, 33971, 33972, 33973, 33974, 33976)
already inherit ZIP/county-grain data. The only real parity gap is corridor-grain depth.
Roadmap: `docs/lehigh-acres-data-parity.md`.

## Verified current state (live this session — code + DB + git, not memory)

- **27 live corridors; exactly 2 carry NULL `cap_rate_pct`** — both are the Lehigh rows.
  Both Lehigh rows: all four metric columns NULL, `character` present, `character_facts` /
  `character_speculative` / `character_generated_at` NULL.
- **CRE consumer is null-tolerant.** `cre-swfl.mts` filters each metric `!= null`
  (`creSwflOutputProducer`, ~L872–950); zero metric'd corridors → empty facts, no error.
  `resolveMetricSource()` (`cre-swfl.mts:136-141`) resolves per-metric `*_source_url` → row
  `source_url` → null. Filling Lehigh metrics is an idempotent UPDATE on two rows — zero code.
  **[AUDIT]** Identity column is `corridor_name` (+`city`); there is **no** `name`/`slug`/
  `centroid_lat`/`centroid_lon` column on `corridor_profiles` — UPDATEs key on `corridor_name`.
  Centroids live in fixtures, not the table.
- **Permit z-score blocker is geocoding, full stop.** `data_lake.lee_building_permits` =
  **119 rows, 0 with lat/lon** (29 in Lehigh ZIPs, 0 geocoded). `assignCorridor()`
  (`corridor-assignment.mts:72-79`) returns null for non-finite coords, so ungeocoded rows
  never attach to a centroid (geometric centroid+radius join, `MAX_CORRIDOR_RADIUS_MI=1.5`,
  county-Lee fallback in `permits-swfl.mts`). Collier already solved this: free US Census
  batch geocoder (`collier_permits/geocoder.py:geocode_batch`, no API key) wired at
  `collier_permits/pipeline.py:82-91`. Lee never geocodes (`scraper.py:169-170` set lat/lon
  = None; `pipeline.py:45-46` passes them through).
- **[AUDIT] permits-swfl v2 pagination is SHIPPED AND WORKING — do NOT rebuild it.**
  `ca0a099` (v2 pagination + per-permit detail, #29), `69b13dd` (pager-selector fix + 90d
  backfill), `0854877` (county-level Lee fallback + backfill script). Cron lives at
  `.github/workflows/lee-permits-weekly.yml`; `--dry-run` exists; `cadence_registry.yaml`
  lists `lee_permits` as a live 7-day pipeline. **Proof pagination works:** one dlt load
  pulled **78 rows in a single backfill** (~8 pages at ~10/page). The stale memory
  `lee-permits-v2-pagination-fix` ("pages 2+ return empty") is contradicted by this data and
  has been reconciled. **There is no `lee_permits_v2` check, because there is no open v2 work.**
  Two real _but out-of-scope_ residuals (separate from Lehigh parity): `declared_value_usd`
  extraction is broken (0/119; `permit_type_raw` is 108/119 so detail-fetch itself works),
  and total volume is genuinely low (real Lee volume across 4 windows, not a pagination bug).
- **Character generator is shipped.** `run-corridor-character-preview.mts`
  (`--corridors=`, `--output-dir=`, `--grounded-dir=`) → `write-corridor-character-to-db.mts`
  (`--corridors=`, `--preview-dir=`, `--dry-run`). **[AUDIT]** It writes
  `character_facts`, `character_chart`, `character_speculative`, `character_citations`,
  `character_generated_at`, `character_fact_pack_vintage` (note the `character_` prefix — the
  earlier draft said `generated_at`/`fact_pack_vintage`). **Grounded NDJSON is a HARD
  prerequisite** — the preview throws if no `_tier1_inventory` row exists for the slug; it does
  NOT silently generate ungrounded. Stage B grounding lands in `lake-tier1` via
  `corridor_grounded/pipeline.py` (Anthropic `web_search_20250305`).
  **[AUDIT] The rendered narrative system is `character_facts` + `character_speculative`**
  (`cre-source.mts:449 composeCharacterRender(...)` prefers `character_facts` over the legacy
  `character` head and appends `character_speculative`). 24/27 corridors carry it; the 3
  without are the 2 Lehigh + 1 other. `character_broker_narrative` is the **dead** legacy n8n
  column — **NULL across all 27** corridors, including Fort Myers/Naples. Task 3 targets the
  live columns; the roadmap's "broker narrative" wording is stale and has been corrected.
- **ZIP-report deps** (`app/r/zip-report/[zip]/page.tsx`): housing from
  `brains/housing-swfl.md` `detail_tables[id=housing_by_zip]` (all 6 Lehigh ZIPs present →
  won't 404); flood from `brains/env-swfl.md` `key_metrics`
  `swfl_zip_{zip}_flood_aal_usd_per_insured_property` + `swfl_zip_{zip}_flood_aal_pct_swfl_rank`.
  Missing flood → section hides gracefully via conditional render (NOT a 404/throw).

## ⚠️ Two discrepancies — both real (resolve honestly)

1. **CRE data grain mismatch — VALIDATED.** The columns (`cap_rate_pct`, `vacancy_rate_pct`,
   `absorption_sqft`, `asking_rent_psf`) are commercial-grain (cap rate / vacancy / NNN asking
   PSF / net absorption). The data on hand (5.5–6.25% cap, 9.7% vacancy, $1.8–2.5k/mo rent,
   "37% of SF permits") is MSA-level **residential/multifamily** — wrong grain _and_ wrong
   asset class. Stamping it violates RULE 3 / no-invention. → Task 1a sources fresh
   corridor/Lehigh-commercial-grain data; Task 1b fills **only** if grain is legit + operator
   signs off. Likely honest outcome: narrative-only (Task 3).
2. **Flood data is genuinely absent for all 6 Lehigh ZIPs — and it's BY DESIGN.**
   `env-swfl.md` carries flood AAL **only for coastal/barrier ZIPs** (33957 Sanibel, 33931
   FMB, 33921 Boca Grande, 33908 Iona, 33924 Captiva, 34102 Naples). Inland Lehigh ZIPs are
   not in the high-risk AAL set. The page hides the flood section cleanly. → Task 4 records
   this as a **decision** ("inland ≠ coastal AAL — correct by design"), not an ingest gap to
   fill. The roadmap's "inherits per-ZIP flood AAL" row is wrong for Lehigh and is corrected.

---

## Wave / dependency structure (isolated worktrees, 1 PR each)

**WAVE 1 (all parallel — disjoint surfaces):**

| Agent | Task                                       | Surface                                                            | Output                   |
| ----- | ------------------------------------------ | ------------------------------------------------------------------ | ------------------------ |
| A1    | 1a — CRE data SOURCING (research)          | none (read-only web)                                               | doc, no PR; feeds A2 + C |
| B     | 2a — Lee permit GEOCODE backfill           | `ingest/pipelines/lee_permits/` + `data_lake.lee_building_permits` | PR (Sonnet)              |
| C     | 3 — corridor-character NARRATIVE ×2        | `corridor_profiles.character_*` (needs LLM egress)                 | PR (Sonnet/Opus)         |
| E     | 4 — ZIP render smoke-test + flood decision | `app/` + `brains/` (read)                                          | report + check           |

**WAVE 2 (gated on A1 findings + operator grain sign-off):**

| Agent | Task                                                  | Output      |
| ----- | ----------------------------------------------------- | ----------- |
| A2    | 1b — CRE metric FILL (idempotent UPDATE + provenance) | PR (Sonnet) |

**[AUDIT] Task 2b ("permits-swfl v2 Accela pagination") is REMOVED** — it is already shipped
and working (see Verified state). The earlier split put it in its own worktree (Agent D), but
it shared the `ingest/pipelines/lee_permits/` package with Task 2a (B) — not disjoint. Removing
it eliminates both the redundant work and the only worktree collision.

Independence after the cut: A1 (no writes), B (Lee ingest), C (character cols), E (app/brains
read) touch disjoint surfaces. A2 is the only gated task (needs A1 data + a human "this grain is
legit" before any metric column is written).

---

## Shared rules every agent must honor (paste into each brief)

- **Worktree isolation:** each task on a branch `claude/lehigh-<task>` → one PR to main. Stage
  only files you created/modified.
- **Pre-push gate** (`.claude/hooks/check-prepush-gate.mjs`, matches `git push` + `safe-push`):
  (1) any `package.json` dep change → `bun install` + `git add bun.lock` same push (BLOCKS,
  exit 2); (2) touched `refinery/packs/**`, `refinery/vocab/**`, `refinery/lib/corridor-aliases.mts`,
  or `fixtures/corridor-*` → run `bun test refinery/lib/corridor-aliases.test.mts` +
  `bun refinery/tools/check-vocab-coverage.mts` (BLOCKS, exit 2). **[AUDIT]** The "secrets"
  branch is **advisory only** — it prints a NOTE, it does not block; wiring secrets into every
  workflow `env:` block is on you, not the hook.
- **RULE 0 / session loop:** before push, append a top-of-file `SESSION_LOG.md` entry; use
  `node scripts/safe-push.mjs` (never raw push, never `--no-verify`, never force-push main).
- **RULE 2 ledger:** close/open the relevant `checks` row in the same push. Never use plan-doc
  markers as status.
- **No-invention / provenance:** every data point gets a source URL; no fabricated numbers;
  flag grain mismatches (RULE 3, Data Provenance, Discrepancy Reporting).
- **SQL:** run migrations/updates directly (creds in `.dlt/secrets.toml`), idempotent, verify
  row count.

---

## Task 1a — CRE data SOURCING (Agent A1 · research · Opus / deep-research)

**Objective:** find the best genuinely-citeable corridor or Lehigh-commercial-grain CRE data
for the two corridors — cap rate, vacancy, commercial NNN asking rent ($/sqft), net absorption
sqft. Deliver a sourced data sheet + an explicit grain verdict per metric. **Do not write any DB.**

Leads (cite every number, record URL + as-of date):

- LSI Companies quarterly SWFL market trends (source of the 37% permit stat).
- Cushman & Wakefield MarketBeat Southwest Florida (retail/industrial/office by submarket).
- Colliers / CBRE SWFL market reports.
- LoopNet / Crexi active commercial listings physically on Lee Blvd and Joel Blvd (asking
  rent PSF, cap rate — note "asking ≠ achieved", aggregate carefully).
- Lee County Property Appraiser commercial sales near the two corridor centroids (implied cap).

**Deliverable** → `docs/superpowers/specs/2026-06-06-lehigh-cre-data-findings.md` (no PR): for
each metric — value(s), grain (corridor / Lehigh-submarket / MSA), source URL, as-of date, and
a one-line verdict: fill-eligible (corridor/Lehigh-commercial) vs narrative-only
(MSA/residential). End with a recommendation: which columns (if any) can be filled the right way.

**Honesty bar:** if only MSA-grain exists, say so — that is a valid, expected outcome (Lehigh has
no broker survey coverage by design). Findings feed Task 3 regardless.

Ledger: informs `lehigh_cre_metrics` (due 2026-09-30). Nothing to close yet.

## Task 1b — CRE metric FILL (Agent A2 · Sonnet · GATED on A1 + operator sign-off)

**Operator decision (2026-06-06): default is narrative-only — leave columns NULL.** If A1 only
turns up MSA-level / residential data (the expected outcome — Lehigh has no broker survey
coverage), that data goes to Task 3's narrative, **never** into the metric columns (RULE 3 /
no-invention). Run the fill below **only** for metrics where A1 found genuine
corridor/Lehigh-commercial-grain data with a citation, and only after the operator confirms that
grain per-metric. When in doubt, leave NULL — an empty metrics table is correct; an invented
number is not.

1. Idempotent `UPDATE corridor_profiles SET … WHERE corridor_name IN (…)` on the two rows, per
   fill-eligible metric only: `cap_rate_pct`, `vacancy_rate_pct`, `absorption_sqft`,
   `asking_rent_psf` (+ each `*_direction`), each metric's `*_source_url` set to the real
   citation, plus `metrics_period`, `metrics_verified_date`. Never stamp a narrative-only metric.
2. Update `refinery/__fixtures__/corridor-profiles.sample.json` to match (keep fixtures honest).
3. Verify: `bun test refinery/` green; rebuild cre-swfl; confirm the two corridors emit a
   metrics table with correct citations; eyeball `/r/cre-swfl/lee-blvd-lehigh-acres`.

PR: `claude/lehigh-cre-fill`. Ledger: `node scripts/check.mjs close lehigh_cre_metrics "<note>"`.

## Task 2a — Lee permit GEOCODE backfill (Agent B · Sonnet · PR)

**Objective:** backfill lat/lon on the Lee permits so the centroid+radius join attaches them and
Lehigh z-scores light up — **no pack change needed**.

1. Port `collier_permits/geocoder.py:geocode_batch()` (free US Census batch, no key) into the
   Lee pipeline; adapt the input split — Lee carries `address` (full) + `zip_code`, Collier
   carries `site_address` split internally. **Check the Census match rate** and log misses; a low
   match rate is itself a finding, not a silent partial.
2. Wire it into `lee_permits/pipeline.py` (mirror `collier_permits/pipeline.py:82-91`): geocode
   → set lat/lon **before** the dlt write, so future cron pulls stay geocoded (the merge on
   `permit_id` would otherwise re-null them). Backfill existing rows via a direct idempotent
   UPDATE or `ingest/scripts/backfill_lee_permits.py` (already chunked, re-pulls + geocodes).
3. Verify: query confirms the 29 Lehigh rows now have finite lat/lon; rebuild permits-swfl and
   confirm `fixtures/corridor-permits.json` shows the two Lehigh corridors with non-null
   `headline_z`. **[AUDIT] Temper the success bar:** 29 Lehigh permits over the few windows held
   (119 Lee total, 4 issued-date clusters) is statistically thin — `headline_z` will be present
   but low-confidence. "Non-null + honestly-labelled thin," not "robust."
4. Touched `fixtures/corridor-*` → run `bun test refinery/lib/corridor-aliases.test.mts` +
   `bun refinery/tools/check-vocab-coverage.mts` (pre-push gate).

PR: `claude/lehigh-permit-geocode`. Writes `data_lake.*` → diff review before push (RULE 1).
Ledger: close `lehigh_permit_geocode` (note the thin-volume caveat).

## Task 3 — corridor-character NARRATIVE (Agent C · Sonnet/Opus · PR · needs LLM egress)

**Objective:** generate the character narrative for both Lehigh corridors and persist the
`character_*` columns (`character_facts` + `character_speculative` — the live, rendered system).
This is where the MSA-grain market context (cap range, vacancy, the 37% SF permit share, rent
softening) legitimately lands — cited, with the speculative disclaimer.

1. **Prereq (mandatory, not optional):** the preview tool throws without grounded NDJSON. Confirm
   a `_tier1_inventory` row exists for both slugs; if missing, run
   `python -m ingest.pipelines.corridor_grounded.pipeline --corridor "<name>"` first (needs LLM
   egress). Optionally seed grounding with A1's source URLs so the narrative cites the same evidence.
2. Preview (no DB write):
   `bun refinery/tools/run-corridor-character-preview.mts --corridors="Lee Blvd Lehigh Acres,Joel Blvd Lehigh Acres" --output-dir=/tmp/lehigh-preview`
3. Inspect `/tmp/lehigh-preview/{slug}.json` — `facts_block` cites correctly, `speculative_block`
   carries its disclaimer (RULE 8 exempts this block from the no-smoothing ban — do NOT re-tighten).
4. Persist (after a 5-spot eyeball):
   `bun refinery/tools/write-corridor-character-to-db.mts --corridors="…" --preview-dir=/tmp/lehigh-preview`
5. Verify `corridor_profiles` now has non-NULL `character_facts` + `character_speculative`
   (+ `character_generated_at`, `character_fact_pack_vintage`) for both; eyeball the rendered
   corridor page (`composeCharacterRender` now prefers the generated facts over the legacy line).

PR: `claude/lehigh-narrative`. Ledger: close `lehigh_broker_narrative`.

## Task 4 — ZIP render smoke-test + flood DECISION (Agent E · Sonnet · report + check)

**Objective:** confirm all six `/r/zip-report/{zip}` render, and record the flood decision.

1. `npm run dev`; load `/r/zip-report/{33936,33971,33972,33973,33974,33976}`. Confirm housing
   renders, no 404/TypeError (all 6 ZIPs present in `housing_by_zip` — should pass).
2. **Flood: confirmed absent for all 6, by design.** `env-swfl.md` ranks only coastal AAL ZIPs;
   inland Lehigh is correctly out of that set, and the page hides the section gracefully. Record
   this as the resolution (no ingest work). If the operator wants inland ZIPs to ever carry a
   flood line, that's a separate env-swfl scope decision — open `lehigh_zip_flood_aal` as a
   **decision** check, not a build task.
3. **[AUDIT] Drop the old "confirm zip-report's table is in `SOURCE_PROVENANCE_TABLES`" step** —
   it's a no-op. The zip-report page loads brains from disk; it does not use that allowlist (which
   governs `/r/source/[table]` only and holds just `fl_dor_tdt_collections` + `marketbeat_swfl`).

PR: only if a render fix is needed; otherwise a findings note + the decision check above.

---

## Loose threads to track (not agent tasks)

- `corridor_ops_coverage_verify` (due Jun 7): confirm the daily freshness-probe GHA renders the
  `city_pulse_corridors_tier2` recency row + structural-gap section for the new Lehigh corridors.
- Sun Jun 8 — `corridor-pulse-weekly`: confirm both Lehigh corridor rows get picked up by the
  weekly news run.
- **[AUDIT] Out-of-scope but real:** `lee_building_permits.declared_value_usd` is 0/119 (CapDetail
  valuation extraction broken — `permit_type_raw` works at 108/119). Tracked separately in the
  ledger; verify whether permits-swfl actually consumes declared_value before prioritizing.

## End-to-end verification (sprint done = all green)

1. `bun test refinery/` passes after 2a (+ 1b if it runs).
2. `/r/cre-swfl/lee-blvd-lehigh-acres` and `/joel-blvd-lehigh-acres`: metrics table populated
   (if 1b ran) or an honest narrative + regional-context block (if narrative-only);
   `character_facts`/`character_speculative` present.
3. `fixtures/corridor-permits.json` shows both Lehigh corridors with non-null (thin-but-honest)
   `headline_z`.
4. All six `/r/zip-report/{…}` render; flood decision recorded.
5. Ledger reconciled: `lehigh_permit_geocode`, `lehigh_broker_narrative` closed;
   `lehigh_cre_metrics` closed if filled or annotated if narrative-only;
   `lehigh_zip_flood_aal` opened only as a decision if the operator wants inland flood lines.
6. A Lehigh corridor page is indistinguishable in depth from a Fort Myers one.
