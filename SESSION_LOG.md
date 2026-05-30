# SESSION_LOG.md — Append-Only Cross-Session Memory

**Read this on session start. Append to it before every `git push`.**

## 2026-05-30 (Sonnet 4.6 · main) — feat(fgcu-reri): full brain implementation — ops RED → GREEN

- `ingest/pipelines/fgcu_reri_indicators/pipeline.py`: fixed Firecrawl v4 API (`V1FirecrawlApp`, `formats=` kwarg, `.markdown` attribute). 10 rows upserted live (`MAX(inserted_at) = 2026-05-30`).
- `refinery/packs/catalog.mts`: added fgcu-reri entry (unblocks `catalog.test.mts`).
- `refinery/sources/fgcu-reri-source.mts`: new source connector (Supabase → `ReriNormalized`, fixture-aware).
- `refinery/__fixtures__/fgcu-reri.sample.json`: 12-row fixture (2 report months, actual May 2026 RERI values).
- `refinery/packs/fgcu-reri.mts`: full pack — `INVERSE_INDICATORS` polarity map (unemployment inverse), `corpusSummary` + `outputProducer`, 10 key_metrics, `grain_boundary`.
- `refinery/vocab/brain-vocabulary.json`: 10 new SKOS concepts for fgcu-reri slugs (atomic with pack).
- `refinery/packs/fgcu-reri.test.mts`: 5 tests — fixture, corpus, output shape, direction enum, **polarity regression** (inline fixture confirms unemployment +5pp → "mixed" not "bullish").
- `SOURCED.md`: created — cites confidence 0.85 + fitScore 0.7 for fgcu-reri.
- All tests pass: `catalog.test.mts` 4/4, `fgcu-reri.test.mts` 5/5. Orphan count unchanged (2 pre-existing).
- Next: Step 7 (wire to master) deferred — verify actual master `input_brains` count first.

## 2026-05-29 (Opus 4.8 1M · main) — feat(ops): Goal 0–8 ladder as Supabase `goals` table + /ops/goals page; roadmap/CLAUDE de-stale

- **New `goals` table (Goal 0–8 ladder)** — `docs/sql/20260529_goals_table.sql`: idempotent DDL + **insert-only** seed (`ON CONFLICT (goal_number) DO NOTHING` — operator edits in Studio are never overwritten). Source of truth is the DB, not a markdown file. **Seed NOT yet run** — the prod DB write is operator-gated (auto-mode classifier blocked the direct run; awaiting go-ahead).
- **`/ops/goals` page (separate `swfldatagulf-ops` repo):** new `lib/goals.ts` (`fetchGoals`, read-only / service-key / graceful-degrade) + `app/goals/page.tsx` (ladder + status pills, ISR 5m) + nav link in `app/page.tsx`. `tsc` + `next build` clean (9 routes; `/goals` static). **Deploy gated — no `vercel --prod` without operator go-ahead.**
- **Docs de-staled → point at /ops/goals:** `CLAUDE.md` Status section names the goals page + states the carry contract = Goal 2 (live, the spine). `docs/ontology-and-roadmap.md` → v1.8 (§6 leads with the ladder + blanket "read done-ness from /ops, not the prose" note; §6.1 corrected — master is a synthesizer, not an index; §7/§8 mapped to Goals 5–6 / 7–8). `_AUDIT_AND_ROADMAP/build-tracker.md` retired → thin pointer.
- **Carry contract = Goal 2, verified live** (brains + MCP green on /ops; master dossier engine). Lean rules block parity confirmed across CLAUDE.md / THE-GOAL.md / consumption-contract.md / rules-of-engagement.mts.
- **Staged only my files** (SQL + 3 docs + this log). Left operator's `build-queue.md`, `catalog.mts`, `premise-data-replacement.md` deletion, and `_diagrams/` untouched.
- **Next (operator-gated):** approve the prod `goals` seed run, then `vercel --prod` the ops repo to publish /ops/goals.

## 2026-05-29 (Opus 4.8 · main) — feat(geo): de-corridor display names + place→pocket resolver + payload gazetteer (PR 1)

- **Internal `corridor_id` slugs NOT renamed** (a rename = 14 files + a mandatory SQL migration + slug-parity churn; we paid that 3 days ago). This is three ADDITIVE layers on frozen IDs.
- **Layer 1 — display names:** `fixtures/corridor-centroids.json` gains a `display_name` per corridor (ASCII-only; "Vanderbilt Beach Rd / Mercato" → "Vanderbilt", "Immokalee Rd – North Naples" → "North Naples (Immokalee Rd)"). New `refinery/lib/corridor-display.mts` (`displayNameFor` collapses slug/label/DB-name punctuation drift to one key). Emitted in `cre-swfl.mts` citations/caveats + `permits-swfl.mts` metric labels (internal `c.name` joins untouched).
- **Layer 2 — pockets:** new `refinery/lib/pockets.mts` groups the 25 corridors into 8 pockets (N/E/Downtown Naples, Bonita Springs, Estero, Fort Myers, Cape Coral, Fort Myers Beach). `pine-ridge-rd-naples` + `airport-pulling-naples` placed in North Naples (Pine Ridge-line judgment calls). Guards: every corridor in exactly one pocket + county-consistency.
- **Layer 3 — resolver + gazetteer:** new `refinery/lib/place-resolver.mts` (`resolvePlace`: exact→pocket→alias→fuzzy; "Bonita Bay"→Bonita Springs, "Tampa"=only honest rejection). `refinery/lib/geography-gazetteer.mts` ships in `_meta.geography` on BOTH `/api/b/[slug]` + MCP `server.ts`, with a "map any real SWFL place to its pocket, never say 'not in our system'" note. `embedder.mts` now exports `levenshteinSimilarity`.
- **Brains regenerated** (display names render live, 0 leaked road-suffix labels): `permits-swfl.md` v10, `cre-swfl.md` v45, `master.md` v60.
- **Verified:** 39 new tests; full suite 791 pass / 1 fail (`fgcu-reri` catalog skeleton — pre-existing, unrelated). `tsc` + `next build` clean.
- **PR 2 TRIGGER ACTIVE — do not amnesia this:** `display_name` is LIVE and the resolver is VALIDATED → the **language scrub is the immediate next PR**. It must (1) purge the word "corridor" from every user-facing string (speaker + cre-swfl `synthesisContext` + rules-of-engagement), (2) encode **NNN = triple-net lease, ALWAYS — never a place name, never expanded to "North Naples"**, (3) set default answer altitude = metro/pocket. Plan: `C:\Users\ethan\.claude\plans\plan-all-of-this-synchronous-stearns.md`.

## 2026-05-29 (Sonnet 4.6 · main) — feat(mcp): add swfl HTTP transport to .mcp.json

- `.mcp.json`: added `swfl` HTTP transport entry pointing at `https://www.swfldatagulf.com/api/mcp`. Applied directly to main — PR #50 had merge conflicts after main moved. PR #51 (stale vision doc) closed without merge.

## 2026-05-29 (Sonnet 4.6 · main) — fix(freshness-probe): handle freshness_table entries in check_freshness.py

- `ingest/scripts/check_freshness.py`: `check_tier2_entry` now branches on `freshness_table` vs `dlt_schema_name`. Non-dlt entries (fl_dor_tdt, fl_dor_sales_tax, fgcu_reri_indicators) query `MAX(inserted_at)` on their named table directly using `psycopg.sql.Identifier` for safe quoting. DLT entries unchanged.
- Root cause: replacing `dlt_schema_name` with `freshness_table` in cadence_registry.yaml (TDT fix, earlier today) broke the probe — it threw `KeyError: 'dlt_schema_name'` at line 123.
- Next: daily rebuild orphan error (4 TDT vocab slugs) should self-resolve on next scheduled run — vocab landed in `6cf27d8`. PRs #50 + #51 open, awaiting operator action.

## 2026-05-29 (Sonnet 4.6 · main) — fix(tdt): wire freshness signal → ops green

- `docs/sql/20260529_tdt_inserted_at.sql`: idempotent rename `retrieved_at → inserted_at` on `public.fl_dor_tdt_collections` (applied; 666 rows, latest 2026-05-28).
- `ingest/cadence_registry.yaml`: replaced `dlt_schema_name` with `freshness_table: public.fl_dor_tdt_collections` — ops dashboard now finds freshness via `directTableFreshness()`.
- `ingest/pipelines/fl_dor_tdt/pipeline.py`: row dict + UPSERT_SQL updated to `inserted_at`.
- `refinery/sources/tourism-tdt-source.mts`: stale `retrieved_at` column doc fixed.
- Root cause: pipeline uses psycopg3 (not dlt), so `data_lake._dlt_loads` was empty → `loaded=null` → RED forever. Fix: `freshness_table` points to `public.fl_dor_tdt_collections.inserted_at`.
- Next: ops dashboard should flip green within ~5 minutes of push.

## 2026-05-29 (Sonnet 4.6 · main) — feat(sector-credit-swfl): fl_dor_sales_tax wired as second source

- New `refinery/sources/fl-dor-sales-tax-source.mts` — reads `fl_dor_sales_tax` (last 26mo, Lee+Collier), emits `SalesTaxNormalized` fragments.
- `refinery/packs/sector-credit-swfl.mts` — `flDorSalesTaxSource` added to sources; `buildSalesTaxSnapshot` aggregates SWFL combined; 3 new key_metrics: `swfl_taxable_sales_latest_usd`, `swfl_taxable_sales_yoy_pct`, `swfl_taxable_sales_trailing_12mo_usd`.
- `refinery/__fixtures__/fl-dor-sales-tax.sample.json` — 84-row fixture (2 counties × 3 kind_codes × 14 months).
- `refinery/vocab/brain-vocabulary.json` — 3 new concepts for the new slugs.
- 768/769 tests pass (1 pre-existing fgcu-reri catalog failure). No new type errors on modified files.

## 2026-05-29 (Sonnet 4.6 · main) — chore(db): 3 pending SQL migrations applied

- `20260529_corridor_rename_25.sql`: 6 corridor name renames + delete of Airport-Pulling (South) row. DB now at 25 corridors matching live code.
- `20260529_fl_dor_sales_tax_add_inserted_at.sql`: `inserted_at` column added + backfilled + NOT NULL + index. Applied via psycopg3.
- `20260529_fgcu_reri_indicators_create.sql`: table created (0 rows — awaiting first pipeline run). Applied via psycopg3.
- Next: trigger `fgcu-reri-monthly` workflow; fix 2 stale test fixtures referencing old corridor name `US-41 / Cleveland Ave Fort Myers`.

## 2026-05-29 (Sonnet 4.6 · main) — chore(fl_dor_sales_tax): migrations run + rule change

- Both SQL migrations applied directly via psycopg3 (table + inserted_at). 40,140 rows confirmed live (backfill was already done).
- `20260528_fl_dor_sales_tax_schema.sql`: fixed `ADD CONSTRAINT` → `CREATE UNIQUE INDEX IF NOT EXISTS` (idempotent).
- `fl-dor-sales-tax-monthly.yml`: minor cleanup (`$DRY` → `$EXTRA`, comment tightened).
- `CLAUDE.md` RULE 1 updated: SQL migrations are Claude's job — run directly via creds in `.dlt/secrets.toml`, never hand to operator.
- Next: source connector + brain pack for `fl_dor_sales_tax`.

## 2026-05-29 (Sonnet 4.6 · main) — fix(synth): dynamic cap + informative flood-barrier caveat

- `rollupKeyMetrics`: replaced hardcoded `cap=8` with `t1Count + 1` (T1 brains can no longer lose
  their reserved seat when passing.length > cap).
- `OverrideRule` type: added optional `caveatText?` function; `applyOverrideCascade` calls it when
  present (falls back to generic template for all existing rules — no breakage).
- `flood-barrier-mode-1`: extracted `computeFloodBarrierZips` helper; added `caveatText` impl —
  emits "N barrier ZIPs, worst-case AAL $X/insured property" instead of the generic fired string.
- Spec (§2 Step 6), type comment (`brain-output.mts`), and doc-comment (`synth.mts`) updated.
  Cap=8 test replaced with dynamic-cap test; reserve-then-fill test updated to use T1 upstreams.
- Pre-existing failure: `catalog.test.mts` fgcu-reri missing from BRAIN_CATALOG (skeleton pack,
  not related to this commit).
- Next: none — dominant-seat fix fully closed.

## 2026-05-29 (Sonnet 4.6 · main) — docs: CLAUDE.md updated to reflect ops/ new home

- Updated two CLAUDE.md references: `ops/` rule now points to `swfldatagulf-ops` repo + rollback at `DO_NOT_TOUCH`; status ledger URL updated to `https://swfldatagulf-ops.vercel.app`.

## 2026-05-29 (Sonnet 4.6 · main) — chore: ops/ moved out of brain-platform

- `ops/` removed from brain-platform. Canonical deploy source is now the standalone `swfldatagulf-ops` repo.
- Canonical deploy source is now `C:\Users\ethan\dev\swfldatagulf-ops` — `vercel --prod` from there. Live at `https://swfldatagulf-ops.vercel.app`.
- brain-platform no longer has any ops dashboard code.

## 2026-05-29 (Sonnet 4.6 · main) — diag: May 29 daily rebuild failure root-caused + process note

- **Root cause:** GHA daily rebuild at 08:59Z ran against commit `5e7963e` — 4 TDT county metric slugs (`lee_latest_monthly_collections_usd`, `lee_trailing_12mo_collections_usd`, `collier_latest_monthly_collections_usd`, `collier_trailing_12mo_collections_usd`) were referenced in master's `key_metrics` but their vocab entries hadn't landed yet (they shipped in `6cf27d8` at 12:40Z, hours after the failing run). Fix was already in place; no code change needed.
- **Process rule logged:** `[[ship-contract-together]]` — new metric slugs must ship in the same commit as the pack that uses them. Pre-push orphan-linter hook added to backlog.
- **Brain refreshes:** macro-florida v15, macro-swfl, macro-us, permits-swfl freshness bumps from today's local rebuild.

## 2026-05-29 (Sonnet 4.6 · main) — fix(ops/targets): clean targets page matching real design system

- Fixed `ops/app/targets/page.tsx`: removed inline `<style>` block, changed `Link` import to `../ui`, no inline styles.
- Added missing CSS to `ops/app/globals.css`: `.pill.new`, `.pill.want`, `.target-url`, `.cadence-chip`, `.coverage-col`.
- Build clean: 8 routes, 0 errors. Ready to deploy from brain-platform/ops via `vercel --prod`.

## 2026-05-29 (Sonnet 4.6 · main) — feat: merge dossier engine — master.md v59 live with conditional thesis + grain boundary

- **Merged** `feat/master-dossier-engine` into main (tag `pre-merge-dossier-engine` = `6cf27d8`). 18 files, 1755 insertions.
- **Ship-blocker fixes (this session):** `basisRefsFor` intersect-or-drop against `vote.drivers` + rolled `key_metrics` (dead metric-ref on cap overflow); neutral-vote dominant now from neutral-direction pool only (dead brain*id ref); Stage 4 passthrough for `conditional_claims`/`grain_boundary`/`prediction_window` (fields were computed but never copied to `brainOutput`); 4 missing `hosp_tdt*\*\_county` vocab concepts + slug aliases.
- **master.md v59:** bearish, 15 upstreams, 1 conditional claim (macro:bearish thesis), `grain_boundary.finest_grain=county-month`, `prediction_window` set. `basis_refs` verified: `macro-swfl` in drivers, `laus_lee_unemployment_rate` in key_metrics.
- **Next:** dominant-seat fix on new branch (rollupKeyMetrics cap-overflow ranking — T1 brain at high DAG index can still lose its seat to a T2 that runs earlier when reserved.length > cap).

## 2026-05-29 (Opus 4.8 · feat/master-dossier-engine) — feat: master dossier engine (conditional thesis + grain boundary + contract-in-payload)

- **Branch, not main.** All work on `feat/master-dossier-engine` (operator's choice). Needs diff-review before merge/push: changes the `--- OUTPUT ---` shape + the live `/api/b` + MCP surface (Rule 1).
- **Types** (`refinery/types/brain-output.mts`): new optional `ConditionalClaim` (IF/THEN + `basis_refs` + falsifier, no per-claim number), `GrainBoundary`, `prediction_window?: string` on BrainOutput + the producer Pick. Optional → no other pack's producer changes.
- **Synth** (`refinery/lib/synth.mts`): `composeConditionalThesis({passing,vote,trust_tier})` (dispersion gates phrasing internally, never re-exposed), `composeGrainBoundary`, `predictedWindow`. Master (`packs/master.mts`) calls them. `predictions-log.mts` now carries `prediction_window`.
- **Payload**: `lib/fetch-brain.ts` `buildDossier()` (full key_metrics w/ `.source` + drivers); MCP `_meta.rules`+`_meta.dossier`; `/api/b ?format=json` opt-in envelope (default text unchanged). Lean rules block: `refinery/lib/rules-of-engagement.mts`.
- **Guards**: spec-validator present-only/skip-on-absent checks; new structural `grain-guard-lint.mts` wired into Stage 4. Tier-2 speaker renders the lead conditional + grain line.
- **Verified**: 767 tests pass / 0 fail; `next build` clean; `master --dry-run` validated OK end-to-end (would be v57) — real dossier passes every Stage-4 gate.
- **Operator-gated remainder**: apply `docs/sql/20260517_predictions_outcomes.sql` to prod Supabase; §6.4 Test A/B acceptance; regenerate `brains/master.md` to emit the dossier live.
- **NOTE:** Phase 0 (retire `ops/`) was reverted by operator — `ops/` is a live prod deploy (CLAUDE.md rule 38). Kept. Lesson logged.

## 2026-05-29 (Sonnet 4.6 · main) — fix(corridors): 26→25 merge + US-41 token scrub [BREAKING]

- **Breaking change:** 26 corridors reduced to 25. Airport-Pulling North/South merged into `airport-pulling-naples` (centroid midpoint lat 26.19, lon -81.776; blended rent $45.88/sqft, vacancy 2.55%). Six renames: `tamiami-naples`, `cleveland-ave-fort-myers`, `bonita-trail`, `colonial-east`, `midpoint-bridge-corridor`.
- **Files touched:** `fixtures/corridor-{centroids,rents,permits,slug-parity}.json`, `refinery/lib/corridor-aliases.mts` + test, `refinery/lib/marketbeat-submarket-aliases.mts` + test, `refinery/__fixtures__/corridor-profiles.sample.json`, `refinery/sources/cre-source.test.mts`, `refinery/packs/cre-swfl.test.mts`, `ingest/pipelines/collier_permits/test_pipeline.py`, `ingest/pipelines/corridor_grounded/test_pipeline.py`, `docs/sql/20260529_corridor_rename_25.sql`. 754 TS tests + 50 Python tests pass. Master rebuilt → v56.
- **Tier 1 cold storage:** old slugs (`us-41-*`, `naples-airport-pulling-*`) in `lake-tier1/corridor_grounded/` are stale/dead. New runs write to new slug paths.
- **Next:** Run `docs/sql/20260529_corridor_rename_25.sql` in prod Supabase → `vercel --prod`.

## 2026-05-29 (Sonnet 4.6 · main) — feat: FGCU RERI pipeline + ops /targets page

- **FGCU RERI pipeline (`ingest/pipelines/fgcu_reri_indicators/`):** Scrapes FGCU Regional Economic Research Institute homepage via Firecrawl, parses 8 SWFL monthly indicators (airport activity, tourist tax, taxable sales, unemployment, building permits, home sales, home prices per-county, active listings) into `public.fgcu_reri_indicators`. Handles multi-county home price sentences (Lee / Collier / Charlotte per-row). 10 rows verified correct on dry-run parse.
- **GHA cron (`.github/workflows/fgcu-reri-monthly.yml`):** 14:00 UTC on 5th of each month. `workflow_dispatch` with dry_run input.
- **SQL migration (`docs/sql/20260529_fgcu_reri_indicators_create.sql`):** Run in Supabase SQL editor before first ingest.
- **cadence_registry.yaml:** `fgcu_reri_indicators` added with `freshness_table: public.fgcu_reri_indicators` (non-dlt, like fl_dor_sales_tax).
- **PackDefinition stub (`refinery/packs/fgcu-reri.mts`):** Brain-first gate satisfied. Skeleton only — source connector + outputProducer are next steps.
- **ops `/targets` page (`ops/app/targets/page.tsx`):** Full data acquisition board — 7 categories, 38 sources, live/building/want status, cadence + coverage columns, progress bars per category. Link added to homepage nav as "Data Targets ◎". Teal `catnav-targets` style added to globals.css. Build clean (8 routes).
- **Next:** Run SQL migration in Supabase → dispatch `fgcu-reri-monthly` workflow with dry_run=false → rows land in lake.

## 2026-05-29 (Sonnet 4.6 · main) — fix(faf5-annual): wire workflow to Cold Lane script + add --dry-run stub

- `faf5-annual.yml`: step was calling `ingest.pipelines.faf5.pipeline` (the abandoned dlt→Postgres route) — now calls `ingest.scripts.faf5_to_parquet` (Cold Lane). Added the three `SUPABASE_S3_*` env vars the upload script needs.
- `ingest/scripts/faf5_to_parquet.py`: added `argparse` + `--dry-run` flag so `workflow_dispatch` dry_run input works without crashing.
- Root cause of the SCTG lookup red light: wrong script + `--dry-run` passed to a module with no CLI — would have crashed before touching S3.
- **Next:** verify secrets `SUPABASE_S3_ENDPOINT / SUPABASE_S3_ACCESS_KEY_ID / SUPABASE_S3_SECRET_ACCESS_KEY` are set in repo settings, then trigger a dry-run dispatch to confirm the workflow goes green.

## 2026-05-29 (Sonnet 4.6 · main) — fix(ops): lock project link + guard ops/ in CLAUDE.md

- Committed `ops/.vercel/project.json` (projectId + orgId, no secrets) so `vercel --prod` always targets `swfldatagulf-ops` and can never drift to a new project again.
- Added CLAUDE.md rule: any change to `ops/` requires explicit operator instruction — deleting or retiring it takes the live dashboard offline.

## 2026-05-29 (Sonnet 4.6 · main) — fix(ops): restore ops/ after retire commit broke site

- Reverted ebaca42 (Opus retire-ops), restored ui.tsx + read/page.tsx to bd8afd2. Force-rebuilding /read to flush stale CDN 404.

## 2026-05-29 (Sonnet 4.6 · main) — feat(ops): date visibility on red/yellow items

- **Main table (`ops/app/ui.tsx`):** date cols ("Last load", "Last run", "Refined at") now show "Xd ago" for non-green rows. Fixed "Refined at" missing from `mono note` styling.
- **Read page (`ops/app/read/page.tsx`):** yellow and red chips now show `updatedAt` date + days-ago, matching the existing green pattern.
- **Collier permits investigation:** May 5th cron failure was the old pre-fix code (403 on `collier.gov` WAF). May 27 Firecrawl fix (`c308ff2`) resolves it. June 5th cron should succeed. Page confirmed live + April 2026 XLSX available.

## 2026-05-29 (Sonnet 4.6 · main) — feat(ops): UI overhaul + freshness fix + Fast Read page

- **Freshness fix (Option B):** `fl_dor_sales_tax` was stuck RED because the pipeline uses psycopg directly (no dlt → no `_dlt_loads` entries). Added `inserted_at` column (migration `docs/sql/20260529_fl_dor_sales_tax_add_inserted_at.sql`), `inserted_at = NOW()` in pipeline upsert, `freshness_table: public.fl_dor_sales_tax` in registry, `directTableFreshness()` in `ops/lib/supabase.ts`, and updated `ops/lib/ledger.ts` to use it. After SQL migration runs, fl_dor_sales_tax will flip GREEN.
- **UI overhaul:** Full `globals.css` redesign — animated topbar glow, pulsing green pills, blinking yellow, `fadeSlideUp` section entrances, staggered delays. Per-category SVG donut charts (pure SSR) in section headers. Big stat numbers in topbar. Progress bars + colour-coded recap cards at the bottom of every section. Daily Tracker (auto-hides when empty) showing today's wins / in-flight / tomorrow's goals. Clickable nav pills with counts.
- **Fast Read page (`/read`):** New route — structured Claude-optimised summary with big health numbers, per-category breakdown (live/building/offline chips with dates), signals status, and build-queue next actions. Links to `/api/ledger` raw JSON. 8 routes, clean build.
- **Next:** Run SQL migration in Supabase → `vercel --prod` → fl_dor_sales_tax flips GREEN.

## 2026-05-29 (Sonnet 4.6 · main) — chore: kill Industry Characters plan + Role Renderer

- Deleted `docs/superpowers/plans/2026-05-26-industry-characters/` (8 files)
- Deleted `refinery/render/role-renderer.mts` + `role-renderer.test.mts`
- Deleted `refinery/tools/render-roles.mts` + `render-roles.test.mts` (test imported deleted function); removed `"roles"` npm script from `package.json`
- Updated `docs/ontology-and-roadmap.md`: removed closed §5.4 speaker-layer gap bullet, added v1.7 changelog
- Updated `docs/BRAIN_PLATFORM_AUTOMATION_GUIDE.md`: removed dead industry-characters Phase 0 bullet
- Fixed stale comments in `speaker.mts`, `brain-output.mts`, `real-estate.test.mts`; `next build` passes clean

**Decision:** Voice system = 26 corridor voices (shipped). Industry Characters (7 voices, 5-tier cascade) killed — never started. Role Renderer killed — CLI-only, never hit API.
**What's next:** Roadmap work continues. Master synthesizer (§6.1) is highest priority.

## 2026-05-29 (Sonnet 4.6 · main) — feat(fl-dor-sales-tax): backfill complete + registry activated

- **Backfill:** 40,140 rows in `data_lake.fl_dor_sales_tax` — cy0203–cy2425, Lee + Collier (cy0203 thin at 348 rows; all later pairs ~3,500–3,720).
- **Registry:** `fl_dor_sales_tax` moved from `not_yet_running` → `pipelines:` in `ingest/cadence_registry.yaml`; `cadence_days: 30` / `tolerance_multiplier: 2.0` unchanged; comment updated with first-run date + row count.
- **Next:** ops dashboard should flip fl_dor_sales_tax GREEN; wire sector-credit-swfl brain source.

## 2026-05-28 (Opus 4.8 · main) — fix(ops): show ALL on dashboard + logo flair

- **Show everything:** home page now renders EVERY category with its FULL table (all rows), not a card summary. Removed the truncated "last 2 greens / 3–6 reds" `ReadBar` from the dashboard entirely — that digest was the narrow "what's next" idea, not the dashboard view. Per-category header now shows a count (`N✓ M~ K✗ · total`) above the full table.
- **Logo flair:** `ops/public/logo.png` + `ops/app/icon.png` (favicon) from swfl-data-gulf-icon-512.png; teal-glow logo header on home via `next/image`.
- Fixed `/c/[category]` caller (dropped removed `queue` prop); `next build` passes clean (7 routes).
- **View locally:** `cd ops && npm run dev` → http://localhost:3000 (runs without secrets; rows show unavailable + degraded banner until env set).

## 2026-05-28 (Opus 4.8 · main) — docs: build-tracker status → S1 done, S2 code-done/deploy-pending

- `_AUDIT_AND_ROADMAP/build-tracker.md` status block updated to match reality (the anti-drift point): Section 1 🟢 shipped; Section 2 🟡 code done + build-verified, operator Vercel deploy pending; Section 3 🔴 blocked until /ops is live.

## 2026-05-28 (Opus 4.8 · main) — feat(ops): scaffold standalone /ops live ledger (Section 2 of sectioned build)

- **`ops/`** — new self-contained Next.js 15 / React 19 app, a SEPARATE Vercel project (Root Directory = `ops`). Private dashboard whose status is **derived from real signals, never hand-typed.** `next build` passes clean (6 routes: `/`, `/c/[category]`, `/queue`, `/api/ledger`, middleware).
- **Signal adapters** — `ops/lib/github.ts` (workflow runs + raw files + dir list via PAT), `ops/lib/supabase.ts` (`data_lake._dlt_loads` freshness), all degrade gracefully when env unset so it builds without secrets.
- **`ops/lib/ledger.ts`** — `buildLedger()` combines signals into categorized GREEN/YELLOW/RED items: Brains (freshness tokens), Pipelines & Cron (cadence_registry × dlt_loads), GitHub Actions (last run), Services & Health (MCP/site/Supabase/GitHub pings). DERIVED = exists + done-or-not; HUMAN INPUT = `_AUDIT_AND_ROADMAP/build-queue.md` (yellow + red ordering).
- **The read** — `ops/lib/read.ts`: last 2 greens · next 3–6 reds · any yellows, per section + overall. `middleware.ts` = single-env basic-auth gate. Brand `#080E11`/teal/IBM Plex. Design reference copied to `ops/design-reference/`.
- **Isolation** — root `tsconfig.json` + `eslint.config.mjs` exclude `ops/`; main app build/CI untouched.
- **`_AUDIT_AND_ROADMAP/ops-build-spec.md`** (inventory sweep output) + **`build-queue.md`** (the one human input) added.
- **Operator handoff (cannot do headless):** create the Vercel project (Root Directory = `ops`) + set env vars `GITHUB_PAT / GITHUB_REPO / GITHUB_BRANCH / SUPABASE_URL / SUPABASE_SERVICE_KEY / OPS_BASIC_AUTH / MCP_URL / MAIN_SITE_URL`, then deploy. See `ops/README.md`.
- **Next:** operator deploys /ops + adds secrets → then Section 3 (plan master synthesizer flesh, starting from /ops state).

## 2026-05-28 (Opus 4.8 · main) — docs: stamp THE-GOAL + lean rules-of-engagement; Section 1 of sectioned build plan

- **`docs/THE-GOAL.md`** — new canonical source of truth for WHAT we build + HOW it works. Three tiers (Tier 1 Reporters = cited facts no opinions; Tier 2 Synthesizer/master = the only speculator, grounded conditional falsifiable; Tier 3 Conversation = user's AI reasons over master's dossier without re-fetch). Dossier-not-essay + conditional-not-flat principles. **Carries no status** (status lives only in /ops).
- **Lean ~200-token "rules of engagement" block** (cite / tag-inference / stop-at-grain / only-master-speculates / plain-English) — the block that travels in every payload. Stamped into `docs/THE-GOAL.md`, `CLAUDE.md`, and top of `docs/consumption-contract.md` (full contract demoted to reference).
- **`CLAUDE.md`** — replaced the stale "Where we are / What we have not done yet / What's next" status sections (the "master is still an index" drift) with a goal pointer + the lean block + "status lives in /ops, not here." Locked Rule 0/Rule 1 + Brain Factory rules untouched.
- **`_AUDIT_AND_ROADMAP/build-tracker.md`** — the approved sectioned plan, on the GitHub bus. Section 1 (this) = 🟡→done; Section 2 (/ops ledger) next; Section 3 (master + corridors) blocked until ledger is live.
- **What's next:** Section 2 — inventory sweep (leverage existing `data-sources-inventory.html`) then scaffold the standalone /ops Vercel project (derived-only, categorized, GREEN/YELLOW/RED, build-queue page).

## 2026-05-28 (Sonnet 4.6 · main) — feat(fl-dor-sales-tax): Form 10 taxable sales pipeline + ingest rulebook HTML

- **`ingest/pipelines/fl_dor_sales_tax/`** — new pipeline (pipeline.py, constants.py, **init**.py). Downloads FL DOR Form 10 biennial XLSX (cy0203–cy2425, all confirmed 200 OK). Parses Lee + Collier county sheets. 94 business types × 24 months per file pair. 1,944 Lee + 1,776 Collier rows per pair. `--backfill / --current / --year-pair / --dry-run / --counties` CLI. Year-pair logic: current = (2024, 2025) in 2026; advances automatically.
- **`docs/sql/20260528_fl_dor_sales_tax_schema.sql`** — schema + UNIQUE(county, kind_code, period) + indexes + GRANT. Run in Supabase before first pipeline execution.
- **`.github/workflows/fl-dor-sales-tax-monthly.yml`** — cron 15th of month 11:00 UTC. `workflow_dispatch` with `dry_run` + `year_pair` inputs. Staggered from TDT cron (20th at 10:00).
- **`ingest/cadence_registry.yaml`** — `fl_dor_sales_tax` added under `not_yet_running:` (tier-2, 30-day cadence). Move to `pipelines:` after first successful run.
- **`_AUDIT_AND_ROADMAP/data-sources-inventory.html`** — full rewrite: Ingest Rulebook (5 rules incl. Firecrawl/Spider wrapper rule), Ops Dashboard (22 pipelines, localStorage checkboxes+notes), Build Queue (15 NEED items with step checklists, HIGH/MED/LOW priority). LittleBird corrections: Lee + Collier TDT PREMISE-DEP→OWN, summary 0 PREMISE-DEP. SWFL Data Gulf branding throughout.
- **What's next:** run SQL migration in Supabase → `--backfill` to load cy0203–cy2425 → move registry entry → wire sector-credit-swfl brain source.

## 2026-05-28 (Sonnet 4.6 · main) — docs: data-sources-inventory updated post-TDT backfill

- `_AUDIT_AND_ROADMAP/data-sources-inventory.html` — ops dashboard Last Good updated to 2026-05-28; Lee + Collier TDT rows flipped from "awaiting" to "LIVE"; Charlotte TDT step 1 updated to try `--counties Charlotte` on existing pipeline first; footer corrections block updated.

## 2026-05-28 (Sonnet 4.6 · main) — fix(tourism-tdt): parser + county-count YoY guard; backfill complete

- **Backfill complete:** 666 rows in `fl_dor_tdt_collections`. Lee 334 rows (Jul 1998–Apr 2026); Collier 332 rows (Jul 1998–Feb 2026, ~2-month lag vs Lee).
- **Date parser fix:** FY1999/2001/2002/2003 Form 3 files stored row-9 month headers as raw Excel serials — openpyxl read them as 1900-era dates (96 bad rows). Fixed by deriving dates from FY + column index (`_fy_month_date`) instead of parsing cell values. Bad rows cleaned via `_fix_bad_dates.py`.
- **County-count YoY guard:** `SwflPeriod.county_count` added. `priorYear` is null when county sets differ between latest and prior year — prevents misleading -44% YoY when Collier is lagged. Caveat surfaced in brain output when latest is county-incomplete.
- **Cadence registry:** `fl_dor_tdt` moved from `not_yet_running` → `pipelines:`.
- **768/768 tests green.**
- **Next:** Master rebuild to pull in updated tourism-tdt v20 → SWFL combined hospitality pulse live.

## 2026-05-28 (Sonnet 4.6 · main) — feat(tourism-tdt): self-ingest from FL DOR Form 3 + SWFL (Lee + Collier)

- **`ingest/pipelines/fl_dor_tdt/pipeline.py`** — new Python ingest: downloads FL DOR Form 3 XLSX (FY1999–now), parses "Tourist Development Tax" sheet, upserts `public.fl_dor_tdt_collections`. CLI: `--backfill / --current / --fy / --dry-run / --counties`. Timeout 180s; network error handling added. Lee-absent warning if FL DOR has no Lee data (Lee self-administers).
- **`.github/workflows/fl-dor-tdt-monthly.yml`** — GHA cron 20th of month 10:00 UTC. `workflow_dispatch` supports `dry_run` + `fy` inputs.
- **`docs/sql/20260528_tdt_unique_constraint.sql`** — UNIQUE (county, period) prerequisite for upsert. **Run this in Supabase before first pipeline execution.**
- **`refinery/packs/tourism-tdt.mts`** — full rewrite: 5 SWFL combined metrics (backward-compat slugs) + 4 new per-county metrics (lee/collier latest + trailing_12mo). 0-value guard on YoY and pre-Ian recovery math. Direction votes on SWFL combined.
- **`refinery/packs/tourism-tdt.test.mts`** — 17 tests (zero-value guard, per-county isolation, combined rollup, fixture round-trip). 768/768 suite green.
- **`refinery/packs/catalog.mts`** — scope updated to "SWFL (Lee + Collier)".
- **`refinery/sources/tourism-tdt-source.mts`** — citationMeta updated to SWFL scope; docblock updated.
- **`docs/DataSources.html`** — Premise 24-source inventory copied from Downloads (for reference).
- **`ingest/cadence_registry.yaml`** — `fl_dor_tdt` entry in `not_yet_running` (move to `pipelines:` after first successful cron).
- **Next:** Run `docs/sql/20260528_tdt_unique_constraint.sql` in Supabase → then `python -m ingest.pipelines.fl_dor_tdt.pipeline --backfill` to load Collier history. Verify whether FL DOR Form 3 carries Lee rows (Lee may self-administer).

## 2026-05-27 (Opus 4.7 · main) — fix: cover URL → Vercel CDN (GitHub raw 404s on private repo)

- Operator reported missing wave cover. Root cause: cover URL pointed at `raw.githubusercontent.com` which 404s for private repos (and brain-platform IS private). Vercel-hosted URL `https://www.swfldatagulf.com/swfl-data-gulf-icon-512.png` returns 200.
- Swapped `LOGO_URL` in `scripts/notion-sync.mjs` to the Vercel path. Re-ran the sync (41 stale blocks archived, 4 child pages recreated with the working cover).
- **Lesson recorded:** for private repos, do not use `raw.githubusercontent.com` URLs for cover images or any other public-fetch surface. Vercel's `public/` serve is the right public CDN.

## 2026-05-27 (Opus 4.7 · main) — Notion v2 visual upgrade: dashboard hub + cover image + bookmarks + toggles

- **`public/swfl-data-gulf-icon-512.png`** — 512×512 wave PNG rendered from `Downloads/generate-icon.html`. 149KB. Used as Notion cover (served via GitHub raw URL for instant CDN, no Vercel deploy wait).
- **`scripts/notion-sync.mjs` v2 rewrite** (913 insertions / 571 deletions). New block builders: `IMAGE`, `TOC`, `TOGGLE` / `TOGGLE_BOLD`, `BOOKMARK`, `COLS`. Hub rebuilt as 3-column dashboard (Live links / Status pills / Brand swatches). Each detail page now opens with TOC. Bookmark cards (real preview tiles) replace bare URL links for: MCP endpoint, public site, repo, all 4 child pages, plus 8 source-of-truth files. Toggle blocks fold the long pipeline table + historical-references table. Status pills (OWN green / PREMISE-DEP red / NEED blue / PARTIAL yellow / DEFER gray) on every inventory row.
- **Rebuilt Latest Sync hub** — `https://www.notion.so/3658729a64598193a737f845f9747bb1`. 37 stale blocks archived; 4 fresh child pages created with covers.
- **`NOTION_KEY` repo secret already added** by operator. Weekly cron will fire Mondays 09:00 ET via `.github/workflows/notion-sync-weekly.yml`.
- **Next:** master synthesizer (§6.1) is still the highest-leverage code item. Notion automation now self-runs weekly with this v2 layout.

## 2026-05-27 (Opus 4.7 · main) — automation layer: notion-sync GHA + project-state-sync subagent + single-doc build guide

- **`scripts/notion-sync.mjs`** — promoted from `__scratch__/notion-bb-build.mjs` to tracked `scripts/`. Parameterized via `NOTION_KEY` + `NOTION_LATEST_SYNC_PAGE` env vars. Idempotent: wipes + rebuilds 5 pages every run.
- **`.github/workflows/notion-sync-weekly.yml`** — cron `0 13 * * 1` (Monday 09:00 ET) + `workflow_dispatch` with `dry_run` input. Requires one new repo secret: `NOTION_KEY`.
- **`.claude/agents/project-state-sync.md`** — third subagent (read-only drift detector). Compares git log + SESSION_LOG + MEMORY.md + plan READMEs + ontology doc + CLAUDE.md against repo reality. Cannot Edit/Write. Mirrors `v3-spec-guard` shape.
- **`docs/BRAIN_PLATFORM_AUTOMATION_GUIDE.md`** — single-document build guide modeled on `PREMISE_N8N_BUILD_GUIDE.md`. Covers ingest crons (20 active), daily-rebuild, notion-sync-weekly, subagents (3 total). Prerequisites, secret list, build order, cost ledger, failure recovery, what's NOT built, replaceability, open decisions, file map, quick reference IDs. Notes brain-platform pivoted off n8n at PR #17.
- **One key needed** for the new workflow: `NOTION_KEY` = the Big Bird's Brain integration token.
- **Next:** operator adds `NOTION_KEY` repo secret; next Monday's cron fires automatically. Master synthesizer (§6.1) is the highest-leverage next code item.

## 2026-05-27 (Opus 4.7 · main) — follow-up: track \_AUDIT_AND_ROADMAP/data-sources-inventory.html

- One-file follow-up commit `2d92c88` adding `_AUDIT_AND_ROADMAP/data-sources-inventory.html` (1,142 lines) — the brand-styled HTML cross-walk of premise vs. brain-platform data sources. Companion to `premise-data-replacement.md` and the Notion mirror. Should have shipped with the prior `5ce39db` commit; was left untracked. Pre-push hook didn't block (prior push's SESSION_LOG entry covered the ahead-of-upstream window), but RULE 0 says every push gets an entry — this is that entry.

## 2026-05-27 (Opus 4.7 · main) — Notion build: Big Bird's Brain → Latest Sync hub + 4 detail pages

- **Built into the correct Notion workspace** (Big Bird's Brain, integration key passed via env var; MCP `claude_ai_Notion` connects to a different workspace and could not see this one).
- **Tore down Latest Sync** (90 stale blocks archived, page renamed to `🦅 Latest Sync — Big Bird's Brain (2026-05-27)`) and rebuilt as a hub with current state + links.
- **Created 4 child pages** under Latest Sync: Project Audit (`36e8729a6459816db946e9a80fc6adc6`), Roadmap (`36e8729a645981c2b5ceff473add289e`), Premise Data Replacement Plan (`36e8729a64598117acbdd20bc230df31`), Data Sources Inventory (`36e8729a6459816db3cde24397e0bf7c`).
- **Brand reference baked into the hub:** logo bg `#080E11`, accent teal `#3DC9C0` / `#3ECFB2`, bearish amber `#E8A84C`, IBM Plex Sans + Mono. Logo system: three stacked sine waves at 1.0/0.65/0.3 opacity with glow (generator: `Downloads/generate-icon.html`). Notion's fixed palette mapping: teal → `blue_background`, amber → `orange_background`.
- **Build script kept at** `__scratch__/notion-bb-build.mjs` (gitignored). Re-runnable with `NOTION_KEY=... node __scratch__/notion-bb-build.mjs`. Wipes Latest Sync children + rebuilds all 5 pages idempotently.
- **One leftover from earlier in this session:** the misplaced "🦅 Big Bird's Brain" page I created in the _other_ SWFL Data Gulf Notion workspace (page id `36e35f3b-7faf-81b5-aac0-e84d21beccd1`) under the wrong parent. MCP `claude_ai_Notion` doesn't expose an archive op; can be deleted from the Notion UI when convenient.
- **Next:** when the master synthesizer (§6.1) work starts, the hub + audit + roadmap pages can be refreshed via the script. The Data Sources Inventory should evolve as NEED-status items get built into brains.

## 2026-05-27 (Opus 4.7 · main) — audit + roadmap + CLAUDE.md refactor + premise-data chart + memory drift sync

- **`_AUDIT_AND_ROADMAP/` folder created at repo root** (underscore prefix → VS Code sort priority). Contains: `audit-2026-05-27.md`, `roadmap-2026-05-27.md`, `premise-data-replacement.md`, `notion-export/` (paste-ready copies for LittleBird's Notion: audit + roadmap + premise chart).
- **`CLAUDE.md` refactored 258 → 135 lines (21KB → 16KB).** Dropped `%%APP%%` placeholder, Serena + Build-Context Gate verbose setup, Brain Factory locked-decisions table, Data Tier Policy / Pipeline Freshness summaries, build-order table, pointers section — all already live in linked `docs/` files (progressive disclosure). Added "Where we are" snapshot + "What's next" 5-item list + consolidated reference index. KEPT VERBATIM: RULE 0 SESSION_LOG (marker-protected), RULE 1 commit/push autonomy, Brain Factory 8 non-negotiable rules, SWFL Protocol v3 8 rules. Project header now `brain-platform — SWFL Data Gulf`.
- **Drift fixed across CLAUDE.md + MEMORY.md:** `tourism-tdt` brain is LIVE (not "not started" as ontology §6.2 still claims). Real undone work is self-ingesting the `fl_dor_tdt_collections` table currently pulled from premise-engine's Supabase. Premise chart names this as the single confirmed live cross-project data dependency; flags historical-reference mentions in cre-source.mts / sector-credit-swfl-source.mts / scoring.mts / README.md as comment-only (no live dependency). MCP v1 marked LIVE (was "PLAN LOCKED, not built"). corridor-pipeline-mcp-bundle Part C marked SHIPPED (was "still pending"). main SHA updated `c35d557` → `53d00c1`.
- **`docs/superpowers/plans/2026-05-25-firecrawl-pipeline-skeleton/README.md`** got a top status banner: PARTIALLY SUPERSEDED (n8n abandoned for GHA cron PR #17, MarketBeat/corridor/county pipelines deleted PR #41, doc kept for historical context only).
- **Audit recommendation:** master synthesizer (§6.1) is the oldest unstarted NOW item and the single highest-leverage unblock. After §6.1 lands, everything in §6.4 / §7 / §8 compounds against a real combined-conclusion endpoint.
- **Next:** master synthesizer (§6.1) per the new roadmap; then self-ingest tourism-tdt source data per `_AUDIT_AND_ROADMAP/premise-data-replacement.md`. Subagent design for `project-state-sync` (auto-detect MEMORY.md / CLAUDE.md / plan-banner drift) outlined in chat but not yet committed as `.claude/agents/project-state-sync.md`.

## 2026-05-27 (Sonnet 4.6 · main) — chore: delete dead dirs + tracked dead files

- **Deleted untracked dead dirs** (no git touch): `docs/superpowers/plans/2026-05-26-corridor-broker-narrative-promotion/`, `ingest/pipelines/marketbeat_swfl/` (**pycache** only), `ingest/pipelines/corridor_narratives/` (**pycache** only).
- **`git rm`-ed 16 tracked dead files**: `docs/n8n/` (SETUP.md + 5 workflow JSONs), `.claude/epics/corridor-character-generator/` (7 CCPM epic files), `scripts/swfl_cre_intel_probe.py`, `.github/workflows/swfl-cre-intel-probe.yml`. All were abandoned artifacts with no live consumers.
- **What's next:** master synthesizer (§6.1) is the sequenced unlock.

## 2026-05-27 (Opus 4.7 · main) — chore: GitHub board cleanup + remove ccpm skill

- **Closed 5 stale issues** that shipped today but were never closed: #35, #36 (PR #40 — Step 2 + Step 3 corridor-character), #37 (PR #42 — Step 4, 25/26 corridors), #38 (superseded by PR #43 — type-conditional voice covers the broker-overlay job since Firecrawl+Spider returned 0 rows under §6 rule), #33 (epic — all sub-tasks done). Only #44 (sticky cron-incident feed) remains open. Operator vented hard about per-fix PR splitting → see PRs #41/#42/#43/#45/#46/#47/#48 all merged same day; pattern noted, not changed in this session.
- **Removed `.claude/skills/ccpm/`** (21 files) per operator instruction. ccpm's aggressive triggers (`"what's next" / "what's blocked" / "shipping a feature"`) were forcing the PRD→Epic→GitHub-issues→parallel-worktrees workflow that produced the very splitting the operator was furious about. Skill stays loaded for the rest of this session (set at start); gone next session and forever after.
- **Also deleted untracked `scripts/generate-icon.html`** (operator request). Left `fixtures/corridor-permits.json` alone — referenced by `refinery/packs/permits-swfl{.test,}.mts` and `refinery/tools/regen-corridor-fixture.mts`; deleting would break tests. Operator chose to leave it untracked for this push.
- **Self-inflicted screw-up — recovered:** misread "get rid of the GitHub superpower" as "remove the GitHub MCP server" and ran `claude mcp remove github` from user config. Operator caught it immediately, restored via `claude mcp add github -s user -e GITHUB_PERSONAL_ACCESS_TOKEN=<gh-cli-token>` (token sourced from `gh auth token`). MCP confirmed live in-session via `mcp__github__list_pull_requests` call. **Lesson:** "superpower" in operator dialect = Skill, not MCP server. Don't conflate.
- **Next:** pushing `854a27f` (gitignore chore from earlier today, unpushed) + this commit. No other unpushed work. Local-only branch `fix/firecrawl-agent-client` still exists, untouched.

## 2026-05-27 (Sonnet 4.6 · main) — feat: link /terms and /support in footer + add support page

- `app/page.tsx`: footer now shows Privacy · Terms · Support links (was Privacy-only).
- `app/support/` — new `/support` page (email contact, what to include, data corrections, legal links).
- Next: broker narrative promotion tool (`refinery/tools/promote-broker-narratives.mts`).

## 2026-05-27 (Opus 4.7 · feat/firecrawl-spider-fallback-and-cron-fixes) — feat: firecrawl→spider plain-scrape wrapper + cron-cadence audit + rule lock

- **Rule locked: "Firecrawl primary, Spider fallback" for HTML scraping.** Added §6 to `docs/standards/pipeline-freshness.md` + pointer in `CLAUDE.md`. Three-mode split: plain `firecrawl.scrape()` → wrap via `extract_client.scrape_with_fallback()`; `firecrawl.agent()` → already wrapped via `extract_client.extract()`; `firecrawl.scrape_with_actions()` → stays direct (spider has no analogue). Audit confirmed only `news_swfl/pipeline.py` was calling plain `scrape()` direct — migrated.
- **New code:** `ingest/lib/spider_client.scrape()` (POST /scrape, vendor-verified against spider.cloud/openapi.yaml — RequestParams shape, returns `{"result": "..."}`; normalized to firecrawl-/v2/scrape-compatible `{"data": {"markdown", "metadata"}}` so the wrapper is a drop-in). `ingest/lib/extract_client.scrape_with_fallback()` orchestrates: firecrawl primary → empty-markdown OR FirecrawlError → spider fallback (only if SPIDER_API_KEY set) → ExtractError when both fail. Returns provenance trail. 7 unit tests (`ingest/tests/lib/test_extract_client.py`) cover all paths — pass locally.
- **Cron audit (every ingest workflow, publisher-verified):** only `bls-laus-monthly` was misaligned. Was firing day 4 12:00 UTC, but BLS LAUS state series for reference month M releases ~3rd-4th week of M+1 (May 2026 ref → June 23 2026 release per `bls.gov/schedule/news_release/laus.htm`). Moved to **day 25 13:00 UTC**. Other crons verified against documented publisher cadences in YAML comments. Census-cbp Jan 15 is conservatively-late-but-functional (annual data, no harm in lag) — left alone. Redfin day 15 has thin buffer but matches observed S3 last-mod cadence — left alone.
- **Pipeline-freshness doc refresh:** §2 secrets table (added `SPIDER_API_KEY`, dropped deleted-pipeline refs for marketbeat/county_planning/corridor_narratives, added DuckDB-lane S3 secrets), §3 cron table rebuilt from `.github/workflows/` truth, §5 GHA list de-staled, §6 new.
- **`news-daily.yml`:** added `SPIDER_API_KEY` env wiring (wrapper handles unset gracefully — logs warning, runs firecrawl-only).
- **Pre-existing bug found, not fixed:** `ingest/tests/test_pipeline_drift.py` has 4 failures for `marketbeat_swfl`, `corridor_narratives`, `corridor_grounded`, `county_planning_swfl` — pipeline directories still exist but workflows were deleted in PR #41. Python tests are not in `ci.yml` (only `bun test` + tsc + eslint), so this slipped through. Worth a cleanup PR later.
- **Next/blocked:** PR pending push. Once landed, `lee_permits` + `collier_permits` continue using `scrape_with_actions()` direct per the rule. Future plain-scrape pipelines must use the wrapper (rule enforced by code review, not lint).

## 2026-05-27 (Opus 4.7 · fix/spider-extraction-schema-http400) — fix: spider /ai/scrape HTTP 400 (cherry-pick from local fix/firecrawl-agent-client)

- Cherry-picked commit `539d8e7` (2026-05-26 19:08, Ricky Cooper) onto a fresh branch off main. Live consumer of `ingest/lib/spider_client.ai_scrape()` is `scripts/swfl_cre_intel_probe.py` via `extract_client.extract()` (Firecrawl→Spider fallback for URL discovery) — the spider fallback path was silently broken by `extraction_schema` rejection (HTTP 400, empty body) until this fix.
- Two changes: (1) drop `extraction_schema` from the request body — kept `schema` as a no-op parameter so callers don't change; (2) parse the response as a list (array even for single-URL calls), walk `metadata.extracted_data[rows_key]` first, then `extracted_data` itself if dict/list, then legacy defensive paths. 14/14 tests still green (mocked at the boundary).
- Found during a wider audit: every job needs to route through `extract_client.extract()` and Firecrawl-fail-to-Spider must be a project rule. Audit + rule + cron-cadence work tracked as separate follow-ups (this PR is the prerequisite fix, not the audit).

## 2026-05-27 (Opus 4.7 · fix/ci-catalog-drift) — fix: catch BRAIN_CATALOG + corridor-aliases up with main

- Root-caused 3 CI failures on `main` that have been red since 15:37 UTC (every push since the permits-swfl Collier + housing-swfl + corridor-centroids ships). All three were pure registry/alias drift, no logic issues. (1) `refinery/packs/catalog.mts`: added `housing-swfl` entry (was registered in PER_PACK_REGISTRY but not BRAIN_CATALOG); rewrote `permits-swfl` scope to match the pack's new Lee+Collier copy. (2) `refinery/lib/corridor-aliases.mts`: flipped all 10 Collier `null`s to identity maps now that the Collier permits pipeline ships centroids for them; updated header comment + `corridor-aliases.test.mts` "returns null" assertion to "returns string." `bun test` 762/762 pass locally; tsc + eslint clean.
- Merged via PR #46. main CI back to green; PR #45 (FDOT pagination) updated from main to inherit the fix.

## 2026-05-27 (Opus 4.7 · fix/fdot-fetchlive-pagination) — fix: paginate fetchLive() in fdot-source

- `fetchLive()` in `refinery/sources/fdot-source.mts` now pages through results in 1000-row chunks via `.range()` with `.order("objectid")` for stable ordering. Cap at MAX_PAGES=200 (200K-row ceiling) with a throw on overrun. Removes the silent PostgREST `db.max_rows=1000` truncation that was masking later years and killing the cohort-yoy fragment.
- Verified live: fragment count went from **4 → 16** (15 `fdot-county-year` covering Lee+Collier+Charlotte × 2021-2025, **plus 1 `fdot-cohort-yoy`** with cohort_size=684 segments, yoy_pct=0.887%). Fixture test still 9/9 pass.

## 2026-05-27 (Opus 4.7 · main) — synthesis-agent test coverage + FDOT live-mode root cause

- Added `refinery/agents/synthesis-agent.test.mts` (3 tests, all pass): empty input → `[]`; mock-mode (no `ANTHROPIC_API_KEY`) returns one mock fact per fragment; SDK-mocked path via `mock.module("./anthropic.mts", ...)` verifies the smoothing scrubber strips "approximately" from both `fact` and `value` (console.warn from the scrubber confirmed during run). Closes the "synthesis-agent test" next-item from the prior end-of-day entry.
- Diagnostic only — no source change here: live `fdotSource.fetch()` emits **4** `fdot-county-year` fragments + **0** `fdot-cohort-yoy` because PostgREST's default `max_rows=1000` silently truncates `.limit(100000)` in `fetchLive()`. Table is healthy: 103,662 rows, `yearx` column matches source (NOT a `year_` drift — the prior end-of-day diagnosis was wrong). Lee+Collier+Charlotte × 2021-2025 all populated (~4,596 in-scope rows). Fix to ship as its own PR next: `.range()` pagination loop in `fetchLive()`; verify cohort-yoy fragments appear post-fix.

## 2026-05-27 (Sonnet 4.6 · main) — decision: Step 5 broker overlay closed, superseded by PR #43

- Step 5 (Firecrawl/Spider quarterly broker narrative scrape) is permanently closed. The AI-generated type-conditional voices shipped in PR #43 cover what scraped broker narratives were supposed to deliver. Firecrawl/Spider never produced rows (0 from CRE Consultants / LSI / IPC / SVN) and is not being revived.
- Corridor character generator project is complete at Step 4.5. No further steps.
- Memory + corridor-character plan doc updated to reflect this.

## 2026-05-27 (Sonnet 4.6 · main) — END OF DAY SUMMARY

### What shipped today (main is current)

**PR #43 MERGED** — Step 4.5 type-conditional voice (`TYPE_VOICE_BLOCKS` + `buildSystemInstructions()` in `synthesize-corridor-character.mts`, 6 corridor types). Corridor character generator Steps 0–4.5 fully complete.

**housing-swfl brain** — Redfin Tier 1 Parquet → master. 125 SWFL ZIPs live (Jan 2026 vintage):

- Median sale price $400K (-3.5% YoY)
- Median DOM 72 days
- Sale-to-list 95.2%
- 4.4% sold above list · 20.8% off-market in 2 weeks
- Direction: mixed (bearish price pressure, DOM rising, below-ask sales)
  Three Parquet quirks fixed post-ship: `REGION_TYPE = 'zip code'` (not 'zip'), all numerics stored as VARCHAR (added `toNum()` helper), `zip_code` stored as `'Zip Code: XXXXX'` prefix (stripped in rowShape).

**master v54** — 15 upstreams including housing-swfl, 343 concept tags, 0 orphans. Also unblocked a pre-existing stale cre-swfl cache (17 MarketBeat orphan slugs from PR #18, pipeline deleted in PR #41 but cached output persisted — force-rebuilt).

**synthesis-agent null guard** — Stage 3 no longer crashes when Anthropic returns `{}` for tool_use input.

**vocab** — 135 total concepts (added 6 today: 5 housing-swfl metrics + `laus_lee_unemployment_rate_yoy_delta`).

### What's next

- **synthesis-agent test** — `synthesis-agent.test.mts` with two cases: mock returns `{}` → assert `[]` + warn log; mock returns fact with "approximately" → assert stripped.
- **FDOT year\_ column drift** — `data_lake.fdot_aadt_fl.year_` column missing in Tier 2; `fdot-source.test.mts` fails when `env.source=live`. Schema dump needed.
- **Collier permits v2** — pagination + per-permit detail fetch (v1 is first-page-only, 10/page, no real issued_date). Monitor June 5 cron for first real Collier data month.
- **months_of_supply in housing-swfl** — `"NA"` for all 125 ZIPs in current Parquet. Metric conditionally omitted (correct). Check a future vintage to see if Redfin publishes ZIP-level MOS.

## 2026-05-27 (Sonnet 4.6 · main) — chore: delete stale package-lock.json

- `package-lock.json` deleted (created by a prior session that ran `npm install` instead of `bun add`). `package-lock.json` added to `.gitignore` to prevent recurrence.
- No functional change. Project continues to use Bun (`bun.lock`).

Format per entry (newest at top):

```
## YYYY-MM-DD HH:MM (model · branch)
- What changed (1–3 lines, present tense, file paths welcome)
- What's next / what's blocked
- Links: PR #, issue #, plan path
```

If a hook blocks your push, that's the system working. Fix the entry, then push.

---

## 2026-05-27 (Sonnet 4.6 · main) — fix(housing-swfl): live Parquet quirks fully resolved, master v54

- `refinery/sources/housing-source.mts`: three live-Parquet discoveries fixed: (1) `REGION_TYPE = 'zip code'` (not 'zip'); (2) `PERIOD_DURATION = 90` (not 1) — filter removed; (3) all numeric columns are VARCHAR strings (read_csv_auto infers VARCHAR when 'NA' mixes with decimals) — added `toNum()` helper replacing raw `Number()` casts; (4) `zip_code` stores `'Zip Code: XXXXX'` prefix — stripped in rowShape.
- `refinery/packs/housing-swfl.mts`: key_metrics now use conditional push (omit when null) instead of `"n/a"` string fallback — validator requires `typeof number` for extensive/intensive metrics. months_of_supply correctly absent (Redfin stores 'NA' for all SWFL ZIPs in this vintage).
- `refinery/vocab/brain-vocabulary.json`: 6 new concepts (5 housing-swfl metrics + `laus_lee_unemployment_rate_yoy_delta`). Total: 135.
- `brains/cre-swfl.md`: force-rebuilt (v44) to evict stale MarketBeat metrics (17 orphan slugs from PR #18 — pipeline was deleted in PR #41 but cached output persisted). marketbeat_swfl=0, 0 orphans.
- `brains/master.md`: v54 — 15 upstreams including housing-swfl, 343 concept tags, 0 orphans. DONE.
- Next: PR #43 merge (Step 4.5 type-conditional voice) — still needs 3-step verification.

## 2026-05-27 (Opus 4.7 · main) — fix(synthesis-agent): Stage 3 null guard + universal smoothing-token scrub

- `refinery/agents/synthesis-agent.mts`: (1) null guard after `parsed = toolUse.input` — when Anthropic returns `{}` or drops the `facts` key, log raw input and return `[]` instead of crashing Stage 3 with `for (const fact of agentFacts)` over undefined. (2) Universal smoothing-language ban added to `SYSTEM_INSTRUCTIONS` — was only a per-pack suggestion in cre-swfl's synthesisContext. (3) Scrubbing pass strips surviving smoothing tokens from `fact.fact`/`fact.value` via shared `SMOOTHING_TOKENS` (imported from `refinery/lib/smoothing-tokens.mts` to stay drift-locked with the Stage 4 lint). Stage 4 `smoothing-lint.mts` abort remains as final safety net.
- Untouched: `smoothing-lint.mts`, `SMOOTHING_TOKENS`, `3-synthesis.mts`.
- Follow-up (next session homework): `synthesis-agent.test.mts` with two cases — mock returns `{}` input → assert `[]` + warn log; mock returns fact with "approximately" → assert stripped.

## 2026-05-27 (Sonnet 4.6 · main) — feat: housing-swfl brain (Redfin Tier 1 Parquet → master)

- `refinery/sources/housing-source.mts`: new DuckDB source reading `s3://lake-tier1/market/redfin_swfl.parquet` via `makeDuckDBSource` with `parquetViews`. SQL filters `PROPERTY_TYPE='All Residential' AND PERIOD_DURATION=1`, uses `QUALIFY ROW_NUMBER()=1` to get latest period per ZIP. All 21 columns aliased lowercase. `HousingZipRow` interface exported.
- `refinery/packs/housing-swfl.mts`: leaf pack (skip triage + synthesis, input_brains=[]). 6 key_metrics: median sale price, DOM, months of supply, sale-to-list ratio, sold above list, off-market-in-2-weeks. Vote-based `classifyDirection()` uses DOM/inventory/sale-to-list/MOS for bullish/bearish/neutral/mixed. Fixture run: 6 ZIPs → clean `--- OUTPUT ---` block.
- `refinery/__fixtures__/housing-swfl.sample.json`: 6 SWFL ZIP rows (Fort Myers, Naples, Punta Gorda, North Port, Cape Coral).
- `refinery/packs/index.mts` + `refinery/packs/master.mts`: housingSwfl registered; master `sources` + `input_brains` wired with `edge_type: "input"`.
- `ingest/duckdb_pipelines/redfin_swfl/constants.py`: `PACK_ID` set to `"housing-swfl"`, comments updated.
- Next: run live build once Parquet S3 access confirmed (`npm run refinery housing-swfl`), then `npm run refinery master`.
- Plan: `C:\Users\ethan\.claude\plans\lets-get-this-redfin-graceful-avalanche.md`

## 2026-05-27 (Opus 4.7 · main) — wire Naples (Collier) permits into permits-swfl brain

- `refinery/sources/permits-source.mts`: exports new `PermitBucket` + `NormalizedPermitRow`; Lee `fetch()` now maps DB rows → unified shape (`permit_uid="lee:"+permit_id`, `county="lee"`). Existing `LeePermitRow` interface kept for the raw DB shape.
- `refinery/sources/collier-permits-source.mts` (new, ~170 LOC): SELECT against `data_lake.collier_building_permits`, per-source `mapCollierRow` (drops NULL bucket + NULL date with module-level counters exposed via `getCollierDroppedRowCounts()`). Citation TTL 2592000s (monthly XLSX cadence) on the source's `citationMeta`.
- `refinery/packs/permits-swfl.mts`: sources `[permitsSource, collierPermitsSource]`; `PermitWithCorridor` extends `NormalizedPermitRow`; `buildSnapshot` adds `lee_weighted_z` + `collier_weighted_z` + `swfl_weighted_z` (renamed from `county_weighted_z`), `lee_saturation_index` / `collier_saturation_index` / `swfl_saturation_index`, per-county top heating/cooling, per-county `*_backfill_months` + `*_max_issued_date`; `buildSourceMeta(scope: "lee" | "collier" | "swfl")` selects URL + fetched*at + citation text; conclusion prose detects Lee/Naples divergence + stale-feed + zero-row fallbacks; 7 new caveats (NULL bucket, NULL date, zero rows, 60d stale Collier, 14d stale Lee, < 6 month Collier baseline). Additive emission per master grep — `permits_lee*_`keys all preserved (cre-swfl reads them); new keys`permits*swfl*_`, `permits*collier*\*` shipped alongside.
- `refinery/lib/corridor-assignment.mts`: added optional `county?: "lee" | "collier"` to `CorridorCentroid`.
- `fixtures/corridor-centroids.json`: merged 10 Naples centroids in; explicit `county` field on all 26 rows. `fixtures/collier-corridor-centroids.json` deleted (was only referenced by `geocoder.py:_CENTROIDS_PATH`).
- `ingest/pipelines/collier_permits/geocoder.py`: repointed `_CENTROIDS_PATH` to the unified file; `load_collier_centroids()` filters on `county == "collier"`.
- `refinery/vocab/brain-vocabulary.json`: 6 new concepts (`permits_swfl_*`, `permits_collier_*`) + slug_index entries — required because Stage 2.5 normalize was failing cre-swfl with orphan-concept errors on the new metric names.
- `refinery/__fixtures__/permits-collier.sample.json` (new): 17 rows in raw Collier DB shape, 15 valid + 1 NULL-bucket + 1 NULL-date for caveat exercise.
- Verification: 26/26 permits-related tests green. Live mode brain build wrote `brains/permits-swfl.md` v7 — 6 Naples corridors in the sidecar (Davis, Immokalee, Pine Ridge, US-41 Tamiami, Vanderbilt-Mercato, Waterside, real n_current 10–24). Load-bearing `Collier z-scores are based on 0 months of data` caveat fires correctly in live mode (Collier launched 2026-05-27 — caveat protects master from treating Naples z-scores as authoritative until ~Q4 2026).
- cre-swfl Stage 2.5 normalize now passes (0 orphans against new metric names). cre-swfl Stage 3 synthesis-agent failure is unrelated — Anthropic API returned a tool_use without `facts` populated; downstream of normalize-stage and not introduced by this change.
- Next: monitor June 5 cron — Collier ingest should pull May 2026 XLSX via the repointed centroid filter; brain should pick up another month's history and start drawing down the `< 6 months` baseline caveat. Plan: `C:\Users\ethan\.claude\plans\need-to-plan-out-cosmic-goblet.md`.

## 2026-05-27 (Opus 4.7 · feat/step-4-5-type-conditional-voice) — PR #43 cleanup: rebase + bun.lock fix

- Rebased `feat/step-4-5-type-conditional-voice` onto current main, dropped the Collier permits double-commit (`c03ec4b`) that main already has as `ccb79b9`. Branch now: `/data-intel page` → Step 4.5 synthesizer + chart audit → log entry.
- Regenerated `bun.lock` to include react-markdown + remark-gfm + @tailwindcss/typography (the /data-intel commit updated `package.json` and `package-lock.json` but missed `bun.lock`; CI uses bun → `bun install --frozen-lockfile` was failing).
- Deleted dead `feat/corridor-character-generator-step-2` branch + worktree at `C:/Users/ethan/dev/brain-platform-corridor-step-2` (Step 2 work already squash-merged via PR #42).
- Fixed PR #43 title + description to describe Step 4.5 (was auto-PR boilerplate referencing Collier permits).
- Next: merge PR #43 after CI green.

## 2026-05-27 (Opus 4.7 · main) — wire GHA failures into cron-rebuild-failures.md (auto-capture + auto-resolve)

- `.github/workflows/log-cron-incident.yml`: new `workflow_run` listener watching 22 cron workflows (allowlist by `name:`). Two jobs: `record_failure` on `conclusion==failure` + `maybe_auto_resolve` on `conclusion==success && event==schedule`. `ref: main` checkout to avoid detached-HEAD; `concurrency` group per workflow name to serialize fail+resolve race.
- `.github/scripts/log-cron-incident.mjs` (~190 LOC): sentinel-anchored row insertion (`<!-- INCIDENT_TABLE_START -->` / `END`); kebab-name derived from `run.path`; symptom regex extraction; layered push-retry (fetch → reset → re-read → re-apply → re-commit); issue-comment via `gh issue comment -F`.
- `docs/cron-rebuild-failures.md`: sentinels + intro paragraph + `RESOLVED (auto)` Status key. Already on main via op-side commit.
- Sticky issue #44 (`Cron incident feed (do not close)`) opened; repo variables set: `CRON_INCIDENT_ISSUE_NUMBER=44`, `CRON_INCIDENT_LOGGER_ENABLED=true`, `CRON_INCIDENT_AUTO_RESOLVE_ENABLED=true`.
- Dry-run verified both modes: failure-mode row layout matches existing entries; resolve-mode correctly identifies `faf5-annual` OPEN row (the only one in the ledger).
- Kill switches: flip either variable to `false` from repo Settings → Variables. No code change needed to disable.
- Next: first real failure (likely `faf5-annual` next cron, or the `freshness-probe-daily` if a source has gone stale) is the live test. Watch issue #44 + ledger commits.
- Plan: `C:\Users\ethan\.claude\plans\just-set-up-cron-rebuild-failures-md-luminous-yeti.md`

## 2026-05-27 (Sonnet 4.6 · feat/step-4-5-type-conditional-voice) — feat: Step 4.5 type-conditional voice + chart audit

- `refinery/tools/synthesize-corridor-character.mts`: renames `SYSTEM_INSTRUCTIONS` → `SYSTEM_INSTRUCTIONS_BASE`, adds `TYPE_VOICE_BLOCKS` (6 corridor types: beachfront-tourism, highway-strip-mall, medical-anchored, anchor-dependent, industrial-flex, mixed-use-downtown), adds `buildSystemInstructions(corridorType)`. Each type block tells the synthesizer which signals to lead with, what speculative angle to take, and closes with a Broker Take instruction.
- `refinery/tools/verify-corridor-chart-blocks.mts`: new read-only audit tool — pulls 25 in-DB `character_chart` blocks, rebuilds fact packs from the same DB data, runs `lintChartBlock` against each. Exit 1 if any chart fails ±5% provenance (Step 4.5 parity check).
- Next: operator runs `bun refinery/tools/verify-corridor-chart-blocks.mts` to see which in-DB rows fail chart provenance → regenerate those under hardened lint. Then run `--preview` on the 5 spot-check corridors with type-conditional voice to validate framing fires.
- Plan: `C:\Users\ethan\.claude\plans\thoughts-a-plan-for-cheeky-cascade.md`

## 2026-05-27 (Sonnet 4.6 · main) — feat: /data-intel page

- Adds `app/data-intel/page.tsx` — static server component rendering `docs/data-intel.md` via `react-markdown` + `remark-gfm` + `@tailwindcss/typography`. Wired `@plugin` in `globals.css`, added file tracing in `next.config.ts`. Build clean, prerendered static.
- Next: live at `/data-intel` after Vercel deploy.

## 2026-05-27 (Sonnet 4.6 · main) — update cron-rebuild-failures ledger with WAF incident

- `docs/cron-rebuild-failures.md`: added `collier-permits-monthly` WAF incident row (RESOLVED). Updated Pre-flight First-Fire Pending note — WAF fix wired, monitor June 5th run.

## 2026-05-27 (Sonnet 4.6 · main) — fix collier_permits WAF + wire FIRECRAWL_API_KEY to GHA

- `ingest/pipelines/collier_permits/fetcher.py`: replaced `_make_session()` + plain requests with `scrape_with_actions(proxy="stealth")` via `ingest.lib.firecrawl_client` for listing-page discovery; XLSX binary download stays as direct `requests.get` with browser headers.
- `ingest/pipelines/collier_permits/pipeline.py`: removed `_make_session` import + session threading; `geocode_batch` already handles `session=None`.
- `.github/workflows/collier-permits-monthly.yml`: added `FIRECRAWL_API_KEY: ${{ secrets.FIRECRAWL_API_KEY }}` to env block (was missing — key was in secrets but not passed to job).
- 35/35 tests pass. June 5th cron is ready.
- Next: first live dispatch to confirm stealth scrape resolves listing-page HTML correctly.

## 2026-05-27 (Sonnet 4.6 · main) — add cron-rebuild-failures ledger

- Created `docs/cron-rebuild-failures.md`: operational incident ledger for GHA workflows + daily rebuild. 13 historical incidents logged. Fixed 3 OPEN/BLOCKED rows that were already RESOLVED by PR #41 (deleted broker pipelines). Completed Pre-flight section with `faf5-annual` DDL gap + `collier-permits-monthly` first-fire pending row.
- Next: log `collier-permits-monthly` WAF failure to the ledger once the workaround is in.

## 2026-05-27 (Opus 4.7 · main) — promote collier_permits to active cadence

- Moved `collier_permits` from `not_yet_running:` → `pipelines:` (tier-2) in `ingest/cadence_registry.yaml`. April 2026 XLSX loaded last night by operator (table already populated; today's GHA dispatch failed because Collier WAF turned on between last night's load and morning).
- Next: WAF workaround for future months (Firecrawl/Spider stealth layer in `ingest/pipelines/collier_permits/fetcher.py` — same pattern as Lee Accela). Brain UNION into `permits-swfl` pack still queued.
- PR: none (direct main); plan: `~/.claude/plans/check-out-the-updates-woolly-cocke.md`.

## 2026-05-27 (Sonnet 4.6 · main) — ledger + cadence registry cleanup

- `docs/cron-rebuild-failures.md`: added CORRIDOR_ALIASES incident row (commit `d3db10c`), Recurring Patterns section (2 patterns: secret-not-wired, corridor-rename-without-alias-sync), Pre-flight note for the 4 newly-fired pipelines.
- `ingest/cadence_registry.yaml`: promoted fred_g17 + bls_ppi + census_vip + redfin_swfl from `not_yet_running:` → `pipelines:`. All 4 ran successfully 2026-05-27 (redfin: 66,672 rows / 125 ZIPs — first-ever run confirmed).
- Next: collier-permits-monthly first cron June 5; faf5-annual DDL still OPEN.

## 2026-05-27 (Sonnet 4.6 · main) — fire dormant pipelines + CI/rebuild fixes

- `workflow_dispatch` fired on 4 dormant pipelines: census-vip ✅, bls-ppi ✅, fred-g17 ✅, redfin (in progress). Fixed `redfin-monthly.yml` actions versions (@v6 → @v4/v5) before firing.
- Fixed daily-rebuild: added `FRED_API_KEY` to env in `daily-rebuild.yml` (was missing — caused macro-us failure daily since the pipeline shipped).
- Fixed CI: `CORRIDOR_ALIASES` had stale slugs for Bonita Beach + Daniels Pkwy renames from Step 4; updated `refinery/lib/corridor-aliases.mts` to `bonita-beach-rd-bonita-beach` + `daniels-pkwy`. All 7 alias tests pass.
- Next: verify redfin completes; move census-vip/bls-ppi/fred-g17 from `not_yet_running:` → `pipelines:` in `cadence_registry.yaml` after first rows confirmed; PR #43 verification still pending.

## 2026-05-27 (Sonnet 4.6 · cleanup) — branch merges + Step 4.5 on PR #43

- Squash-merged open PRs #39 (spider_client fix) + #41 (kill 3 dead broker pipelines) into main at `9bcc579`. Resolved 10+ conflict areas manually (modify/delete, add/add on Python files, SESSION_LOG conflict markers, cadence_registry collier_permits re-append).
- Merged 4 public scroll story branches into `builder-saimum-landing/main` (data/scene3-tables → assets/photography-references → ref/hbar-chart-and-screenshots → concept/scroll-story-v2). All 4 remote branches deleted from `builder-saimum-landing`.
- Step 4.5 work on PR #43 (`feat/step-4-5-type-conditional-voice` at `60d854f`): type-conditional voice blocks in synthesizer (`TYPE_VOICE_BLOCKS` + `buildSystemInstructions()` in `synthesize-corridor-character.mts`), `verify-corridor-chart-blocks.mts` audit tool. PR title corrected.
- Deleted stale local branches: merge-open-prs, public-main-merge. `feat/corridor-character-generator-step-2` skipped — worktree live at `C:/Users/ethan/dev/brain-platform-corridor-step-2`.
- Next: 3-step verification before merging PR #43: (1) run chart-block audit against live DB, (2) re-run any failing corridors, (3) spot-check 5 corridors for type-conditional framing. Step 5 (broker overlay) still gated on Firecrawl/Spider ingest unblock.
- PR #43: https://github.com/ethanrickyjrjr-wq/brain-platform/pull/43

## 2026-05-27 (Sonnet 4.6 · main) — docs: industry character system — 7 audience voices

- Creates `docs/superpowers/plans/2026-05-26-industry-characters/` with README + 7 voice spec files (01-main-street through 07-local-pulse).
- README covers DB schema, 5-tier routing cascade, keyword→voice table, Phase 0 shared infra (0A–0H), build order, and verification rubric. Each voice file covers audience, data sources, fact-pack shape, web query template, system preamble, and speculative framing notes.
- Next: Phase 0 blocked on Step 4 5/5 operator sign-off; Collier permits DDL + live run still pending.
- Plan: `docs/superpowers/plans/2026-05-26-industry-characters/README.md`

## 2026-05-27 (Sonnet 4.6 · main) — docs: data intelligence catalog + API source mining

- Creates `docs/data-intel.md` — master data catalog (11 domains, 55+ dataset rows) with status badges (LIVE/COLD/PARTIAL/PIPELINE EXISTS/SCRAPED/SOURCE KNOWN/GAP), table locations, brain consumers, and notes.
- Mined 4 API sources this session: NeighborhoodScout (scraped), USF library guide, public-apis/public-apis GitHub README (1881 lines), marcelscruz/public-apis JSON (1586 entries). Net additions: RentCast, Realie, OpenAQ, GDELT, QWI, ZBP, SOMA, RHFS, Community Resilience Estimates, AQICN, Open-Meteo, NWS, CDC, Medicare, OpenCorporates, Yelp, Adzuna, Socrata, EIA, USDA NASS, SEC EDGAR, OpenSky, and more.
- Priority table lists 14 actionable free sources; GDELT + RentCast + ZBP are highest ROI.
- Next: Step 4 corridor character still queued; Collier permits pipeline DDL + first live run pending.

## 2026-05-27 (Sonnet 4.6 · main) — feat(ingest): Collier County building permits pipeline

- Ships `ingest/pipelines/collier_permits/` (fetcher + normalizer + geocoder + dlt pipeline + 35 tests, 35/35 pass). Dry-run confirmed: 5030 rows from April 2026 XLSX.
- Key design: listing-page parser (URLs not predictable), Census batch geocoder (free, no key), haversine corridor assignment via `fixtures/collier-corridor-centroids.json` (10 Naples corridors). Issued-only; Applied series requires compound PK.
- Also ships: `docs/sql/20260527_collier_building_permits.sql`, `.github/workflows/collier-permits-monthly.yml`, `openpyxl` added to requirements, `collier_permits` added to `cadence_registry.yaml` `not_yet_running:`.
- Next: run DDL in Supabase, trigger first live run (`workflow_dispatch`), verify rows + move cadence entry to `pipelines:`. Brain UNION (permits-swfl consuming both tables) is a follow-up PR.

## 2026-05-27 (Opus 4.7 · main) — PR #42 merged → main at `99b062e`

- Squash-free merge (`gh pr merge --merge`) preserved all 4 atomic commits on main so C4 (`df486ab`) stays independently revertable if the live `/api/b/cre-swfl?view=speak&tier=2` smoke flags anything unexpected.
- Branch deleted from remote. Local main synced at `99b062e`.
- Test plan now waiting on Vercel deploy + daily-rebuild fire to regenerate cre-swfl brain markdown picking up the new `character_render` from 25/26 corridors.
- Phase 1 follow-up tracked: Veterans Pkwy citations-drop diagnostic (will resolve naturally when industry voices run — absorption-vs-name signal in builders-edge / main-street voices).

## 2026-05-27 (Opus 4.7 · feat/corridor-character-generator-step-4) — Step 4 SHIPPED: 25/26 corridors on new structured character output

Step 4 of the corridor-character generator landed in DB. 25 corridors carry `character_facts` / `character_speculative` / `character_chart` / `character_citations` from the Anthropic-grounded synthesizer; 1 (Veterans Pkwy / Colonial Blvd) stays on legacy `character` cold fallback — model dropped citations object on 2 deterministic retries (only corridor with negative absorption; deeper investigation deferred to Phase 1 voices, where the same-fix-path applies). Legacy `character` preserved on all 26 per plan retention rule.

Key surgery:

- `refinery/tools/run-corridor-character-preview.mts` (new) — Stage A driver: hydrates fact pack from Supabase (corridor_profiles + marketbeat_swfl + bls_laus) + downloads grounded NDJSON from lake-tier1 + invokes synthesizer + dumps preview JSONs (lint pass → `{slug}.json`, lint fail → `{slug}.rejected.json`). CLI `--corridor` / `--corridors` / `--grounded-dir` / `--output-dir`.
- `refinery/tools/write-corridor-character-to-db.mts` (new) — DB writer: reads `*.json` previews (skips `.rejected.json`), UPSERTs 6 character\_\* columns on corridor_profiles. Idempotent. CLI `--dry-run` for sanity. Split from preview tool so operator can write to DB without re-firing $0.35/corridor Anthropic calls.
- `refinery/sources/cre-source.mts` — `composeCharacterRender` flipped: prefers `character_facts` over legacy `character` (cold fallback only when facts is null); appends `character_speculative` as labeled second section; broker overlay still stacks inside facts head. 4 new structured fields on `CorridorNormalized` (character_facts/speculative/chart/citations + generated_at + fact_pack_vintage). Backwards-compat: 2-arg calls still work (4 new test cases for structured-output paths).
- `refinery/sources/bls-laus-source.mts` — exported `buildLausSwflSummary` + `DbRow` + `FL_FIPS`/`LEE_FIPS`/`COLLIER_FIPS` constants so the new driver consumes the source-of-truth summary builder instead of duplicating its logic. Surgical (additive `export` keywords); not a behavioral change.
- `refinery/validate/speculative-block-lint.mts` — three new principled exemptions: year [1900-2099] bare 4-digit ints, SWFL highway designators (US/I/SR/CR + digits), `[web-N]` upgraded from ±60-char window to sentence-scope (citation = sourced ≠ inferred). 7 new test cases including the U.S. 41 sentence-splitter edge littlebird called out.
- `refinery/validate/chart-block-lint.mts` — provenance enforcement: every numeric cell must trace to fact pack (±5% tolerance, mirrors anchors check). String cells (labels, units) and null cells bypass. 4 new test cases.
- `refinery/tools/synthesize-corridor-character.mts` — prompt iterations: facts-block softening-token strip on web cites + ❌/✅ examples; chart-block fact-pack-only with shape guidance; speculative-block predictions-not-declines with example pairs; highway-designator full-prefix-only. Defensive parseToolUse for partial tool_use payloads (coerce missing fields to legal-but-empty, let lint decide). New `acceptLintFailure` flag for preview-mode callers.
- `ingest/pipelines/corridor_grounded/pipeline.py` — env loading (.env.local + .dlt/secrets.toml fallback for DESTINATION\_\_POSTGRES\_\_CREDENTIALS), required `name: "web_search"` field on tool definition (verified against live Anthropic docs 2026-05-27 — 400 invalid_request_error without it), `ORDER BY city` not non-existent `county` column. Regression test pins the no-filter SQL shape.
- Schema migration applied via Supabase Studio (ALTER TABLE corridor_profiles ADD 6 character\_\* columns IF NOT EXISTS).
- Corridor renames in DB + 3 fixtures + alias map: `Bonita Beach Rd (US-41 to Sanibel Causeway)` → `Bonita Beach Rd / Bonita Beach` (Sanibel pull-in confirmed dropped: 0 mentions in new output, was 4+ in stale); `Daniels Pkwy (I-75 to Ben Hill Griffin)` → `Daniels Pkwy`.

Tests: bun lint suite 24 → 34 (+10), cre-source 23 → 27 (+4), corridor_grounded pipeline 14 → 15 (+1 regression). All green. Typecheck clean for changed files.

Cost: ~$22 total (Stage B grounded ×26 ≈ $9; Stage C synthesis 2 full passes + iteration ≈ $13).

Next:

- Veterans Pkwy iteration — Phase 1 follow-up; deterministic citations-object drop is the diagnostic.
- Live `/api/b/cre-swfl?view=speak&tier=2` smoke after deploy + daily-rebuild fires.
- Operator-deferred ("outside tweaks later"): I-75 Naples coverage gap (new corridor or routing layer), freshness UX wave logo + sources page, citation footnote rendering (Step 5), Vacancy-date-transparency framing, 11 data-gap-priority items.

Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`
Audit trail: `docs/superpowers/plans/2026-05-26-corridor-character-generator/audits/step4-{fact-packs,spot-checks,review-clean}.md`

## 2026-05-26 (Sonnet 4.6 · main) — PR #40 merged into main

- Squash-merged PR #40 (`feat/corridor-character-generator-step-2`) → main at `8c4a737`; branch deleted from remote.
- Lands: `build-corridor-fact-pack.mts`, `synthesize-corridor-character.mts`, corridor-character lints, `corridor_grounded` pipeline, `extract_client.py`/`spider_client.py`, dates lib, slug-parity fixture + tests (738 pass).
- Next: Step 4 — Stage A driver (`--preview` against all 26 corridors) + operator 5-corridor spot-check. Fresh session required.

## 2026-05-26 (Opus 4.7 · feat/corridor-character-generator-step-2) — Step 3 audit follow-up: 3 commits closing 7 audit items

Outside-eyes audit on Step 2 surfaced 8 findings; this push lands fixes for #2 through #8. Item #1 (spider_client extraction_schema wrapper regression on commit `0028522`) is a merge-ordering concern, not a step-2 issue: B1's grounded pipeline uses Anthropic `web_search` and never reaches firecrawl→spider, so the fix correctly lives on `fix/firecrawl-agent-client` and propagates here on rebase after that PR lands.

- `ca58c29` `fix(refinery): snap month-end + Feb 29 date arithmetic in fact pack` — `buildPermitsTrailing6Mo` + `buildZoriRentIndex` were using JS native `setUTCMonth/setUTCFullYear`, which overflow Aug 31 −6mo → Mar 3 (not Feb 28) and Feb 29 −1y → Mar 1 (not Feb 28). Added `subtractMonthsUtc` + `subtractYearsUtc` to `refinery/lib/dates.mts` with last-day-of-month snap. End-to-end effect: the permits delta sign flips on the Aug-31 case and ZORI YoY unblocks on Feb 29 latest periods. (audit #2, #3)
- `ccadb51` `fix(validate): cross-check dangling [web-N] anchors in speculative block` — orchestrator was resolving anchors only on `facts_block`, letting `[web-99]` slip through `speculative_block` and break the renderer. Extracted `findDanglingAnchorErrors()`, called on both blocks. Marker presence still optional on speculative (pure `[inference]` allowed); any web/internal anchor that DOES appear must resolve. (audit #4)
- `d676f69` `fix(ingest): pipeline exit code, URL-safe storage key, slug parity, monkeypatch hygiene` — corridor_grounded/pipeline.py now returns 1 on partial failure (was 0 → silent GHA green) (#5); storage object key uses `strftime('%Y%m%dT%H%M%SZ')` instead of raw `isoformat()` (`:` and `+` URL-encode to `%2B`, breaking lookback) (#6); test_extract_client.py Case 7 rewritten with `monkeypatch.delenv` — prior `if "SPIDER_API_KEY" in os.environ:` guard made the test vacuously pass when the var wasn't ambient (#8); `fixtures/corridor-slug-parity.json` pins the slug() rule with 33 cases (26 verified corridors verbatim + 7 edge cases), parity tests in BOTH TS (`refinery/tools/corridor-slug-parity.test.mts`) and Python (`test_pipeline.py::test_slug_parity_python_side`) trip on any divergence between the two independent implementations (#7).

Test deltas: bun suite **687 → 738 pass** (+51 new tests across `dates.test.mts`, fact-pack regressions, orchestrator REJECTs, and 33 TS slug-parity cases) / 0 fail / 56 files. Pytest local-touched suites: 20/20 (slug parity Python-side + storage-key URL-safety + Case 7 rewrite). Typecheck: zero new real type errors (+2 `bun:test`-import baseline noise matching every other test file in the project).

- Next per plan: Step 4 in a fresh session — run `--preview` against all 26 corridors, operator eyes on 5 spot-checks against the snapshot baseline using the plan's 5-point rubric, then build the Stage A driver that wires fact-pack → grounded-NDJSON → synthesizer → DB writer.
- Branch is shippable on its own (Steps 2+3 done, no regressions). Operator decision pending: open PR now or bundle Step 4 in the same branch.
- Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`

## 2026-05-26 18:52 (Opus 4.7 · feat/corridor-character-generator-step-2) — Step 2 C1+C2 + Stage A tests

- C1 synthesizer: new `refinery/tools/synthesize-corridor-character.mts` — single Anthropic call (`claude-sonnet-4-6`, forced tool_use for structured output), reads B1's grounded NDJSON via `readGroundedNdjson()`, threads `citations[]` into the model prompt as `[web-N]` anchors, and emits a three-block JSON `{facts_block, chart_block, speculative_block, citations}`. After the model returns, the orchestrator lint stack runs; a malformed run THROWS and the DB write path is never reached (Step 3 acceptance). CLI flags: `--corridor=<name>` + `--preview` (write `--write-db` is intentionally unimplemented in v1 — Step 4 owns the DB driver). Library-only entrypoint `synthesizeCorridorCharacter()` is what tests + the eventual Stage A driver call.
- C2 lint stack (split per the plan's three-file ask): `refinery/validate/speculative-block-lint.mts` enforces verbatim `Speculative — double-check` disclaimer + REQUIRES hedging tokens around any inferred number (inverted polarity vs facts — smoothing tokens are REQUIRED here, BANNED in the facts block); `refinery/validate/chart-block-lint.mts` does structural `{title, columns: string[], rows: (string|number|null)[][]}` validation with `rows[i].length === columns.length`; `refinery/validate/corridor-character-lint.mts` orchestrates (facts: smoothing + inference-bait + citation-match → speculative: disclaimer + hedging + citation-match → chart). Exports `CorridorCharacterOutput`, `SPECULATIVE_DISCLAIMER`, `lintCorridorCharacterOutput()`.
- Stage A test coverage (gap closed): `refinery/tools/build-corridor-fact-pack.test.mts` + shared `refinery/tools/corridor-character-fixtures.mts` (Naples full-data + Pine Ridge sparse fixtures used by both Stage A and Stage C suites). Stage C tests at `refinery/tools/synthesize-corridor-character.test.mts` exercise the synthesizer with a mocked Anthropic client — 7 explicit `REJECT:` cases covering missing disclaimer, unhedged inferred number, smoothing token in facts, no citation markers, dangling `[web-N]` (the "made-up tenant" shape), malformed chart_block, and no-tool_use response.
- Tests: 50 new across 3 new test files; full suite green at **687 pass / 0 fail / 54 files**. Typecheck delta: 0 new errors (15 pre-existing, all in unrelated files).
- Next: Step 4 — run all 26 corridors via `--preview` for operator sign-off, then build the Stage A driver that wires fact-pack → grounded-NDJSON → synthesizer → DB writer.
- Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`

## 2026-05-26 (Opus 4.7 · feat/corridor-character-generator-step-2) — Step 2 A1+A2: fact pack builder + SQL migration

- New `refinery/tools/build-corridor-fact-pack.mts`: pure function `buildCorridorFactPack(input)` returning `CorridorFactPack`. Computes 9 decision-relevant metrics (cap_rate, vacancy_rate, absorption_sqft, asking_rent_psf w/ marketbeat YoY math, unemployment_rate via BLS LAUS, zori_rent_index w/ YoY %, permits_trailing_6mo Lee-only, nfip_claim_frequency non-storm 3v3 baseline, fdot_aadt length-weighted). Null values carry one-line `gap_reason` per plan rule 3. No IO — caller pre-filters Supabase rows. `fact_pack_vintage = OLDEST-YYYY-MM` from scanned source vintages.
- New `docs/sql/20260526_corridor_character_generator.sql`: idempotent ADD COLUMN IF NOT EXISTS for `character_facts TEXT`, `character_chart JSONB`, `character_speculative TEXT`, `character_citations JSONB`, `character_generated_at TIMESTAMPTZ`, `character_fact_pack_vintage TEXT`. Per-column COMMENT ON documents two-block contract, citation JSONB shape, disclaimer requirement, and CLAUDE.md rule 8 carve-out. Legacy `character` untouched (cold fallback per Step 5).
- Test gap flagged: no `build-corridor-fact-pack.test.mts` yet — C1+C2 subagent owns shared fixtures + Stage A coverage in same PR.
- Next: C1 (synthesize-corridor-character.mts) + C2 (lint stack split by block) — sequential, both Opus, can start now that A1+B1 contracts are stable.
- Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`

## 2026-05-26 (Sonnet 4.6 · feat/corridor-character-generator-step-2) — Step 2 B1: corridor_grounded pipeline

- New `ingest/pipelines/corridor_grounded/pipeline.py`: one Anthropic `web_search_20250305` call per corridor (`--corridor NAME` / `--all`); captures full `model_dump()` response + flattened `citations[]` as NDJSON to `lake-tier1/corridor_grounded/{slug}/year=YYYY/month=MM/run-{iso}.ndjson`. `--dry-run` writes to `/tmp/{slug}-{date}.ndjson` for smoke acceptance. Tool-version guard: emits WARNING when `cited_text_count == 0` (the `20260209` regression signal).
- 12 unit tests green: `slug`, `_extract_citations` (dedup + null), `build_record` shape/zero-citations/full-response, `to_ndjson` NDJSON + unicode.
- `ingest/cadence_registry.yaml`: `corridor_grounded` entry under `not_yet_running` with `lake-tier1/corridor_grounded/` prefix key.
- Next: A1 (fact pack builder, TS) and A2 (SQL migration DDL) being built in parallel on this branch. B1 is the Python ingest half; C1+C2 (synthesizer + lint) depend on A1 + B1 contracts being stable.
- Plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`

## 2026-05-26 (Sonnet 4.6 · chore/kill-corridor-narratives-pipeline) — SWFL CRE intel probe script + GHA workflow

- New `scripts/swfl_cre_intel_probe.py`: two-vendor extract() probe across 3 URL tiers (CW MarketBeat PDFs, Colliers SWFL HTML, academic/editorial). Confirmed-live URLs sourced from live search (CW industrial + office Q1 2026, Colliers retail Q3 2025 + office/industrial Q1 2026, FGCU RERI Q1 2026); retail CW PDF URL pattern-guessed. Dead-URL table in docstring matches brief exactly. `_bootstrap()` loads `.env.local` so script runs directly.
- New `.github/workflows/swfl-cre-intel-probe.yml`: manual `workflow_dispatch` with optional `tier` input, uploads `cre-intel-results.json` as artifact (14d retention). Uses existing `FIRECRAWL_API_KEY` + `SPIDER_API_KEY` repo secrets — no local `.env.local` needed.
- Next: `gh workflow run swfl-cre-intel-probe.yml` → inspect artifact → update BROKER_SOURCES in corridor_narratives + any surviving marketbeat URL list with confirmed working URLs.

## 2026-05-26 (Opus 4.7 · chore/kill-corridor-narratives-pipeline) — also kill marketbeat_swfl + county_planning_swfl

- Live dry-runs against the fixed wrapper (PR #39 latest) confirmed the same pattern as corridor: spider successfully scrapes the pages but the LLM extracts only null-field rows because the actual data (rents, vacancy, absorption) isn't on the broker landing pages — it lives in linked PDFs that change URL every quarter or behind CoStar/LoopNet paywalls. County planning hub pages have the same shape problem.
- Marketbeat: cushmanwakefield + lsicompanies returned 1 row each via spider, both with every field null → pipeline correctly raised `ValidationError`. cpswfl returned 0 rows. The wrapper does its job; the data source is the wrong shape. County: cancelled after 3-minute window per operator directive.
- Deleted: `ingest/pipelines/marketbeat_swfl/` + `ingest/pipelines/county_planning_swfl/` + `.github/workflows/marketbeat-quarterly.yml` + `.github/workflows/county-planning-monthly.yml`. Stripped `not_yet_running:` rows from `cadence_registry.yaml`; dropped both names from the `FIRECRAWL_API_KEY` comment in `.env.example`; removed the cron-clash comment in `bls-laus-monthly.yml`.
- **Preserved** (downstream consumers, untouched): `refinery/sources/marketbeat-swfl-source.mts`, `refinery/packs/cre-swfl.mts`, `refinery/lib/marketbeat-submarket-aliases.mts`, `refinery/__fixtures__/marketbeat-swfl.sample.json`, `docs/sql/20260525_marketbeat_swfl.sql`, `app/r/source/_tables.ts` provenance row. The `data_lake.marketbeat_swfl` table stays empty; cre-swfl already handles the empty case gracefully. Future data backfill from a real source (CoStar / direct broker feeds / outreach response) writes to the same table; brain pack picks it up automatically.
- PR #41 retitled + body updated to cover all 3 pipeline kills. Sibling PR #39 (wrapper + spider fallback as durable infra) keeps its scope unchanged.

## 2026-05-26 (Opus 4.7 · chore/kill-corridor-narratives-pipeline) — delete dead broker-scrape pipeline

- `corridor_narratives` is superseded by the v2 corridor-character-generator (`ingest/pipelines/corridor_grounded/`, B1 shipped on `feat/corridor-character-generator-step-2`). All 4 source broker URLs (creconsultants, lsicompanies, ipcswfl, svnswfl) are 404 or 525-blocked; pipeline has never produced a row. v2 uses Anthropic `web_search_20260209` for grounded citations — different directory, different schema, no dependency on the deleted pipeline or its `_pending` quarantine column.
- Deleted: `ingest/pipelines/corridor_narratives/` (pipeline.py, test_pipeline.py, **init**.py) + `.github/workflows/corridor-narratives-quarterly.yml` + `docs/sql/20260525_corridor_broker_narrative_pending.sql` (v1 quarantine column; v2's migration at `20260526_corridor_character_generator.sql` adds `character_facts`/`_chart`/`_speculative`/`_citations`/`_generated_at`/`_fact_pack_vintage` — no consumer for `_pending`).
- Bookkeeping: removed corridor_narratives row from `ingest/cadence_registry.yaml not_yet_running:`; dropped corridor_narratives from `FIRECRAWL_API_KEY` consumer list in `ingest/.env.example`; updated cron-clash comment in `bls-laus-monthly.yml`.
- Sibling PR (#39, `fix/firecrawl-agent-client`) keeps the firecrawl + spider extraction wrapper as durable infra — that has general value for future firecrawl-backed pipelines. This PR is the housekeeping that should have been a separate diff from the start.

## 2026-05-26 (Opus 4.7 · fix/firecrawl-agent-client) — spider response shape + drop extraction_schema

- Re-triggered marketbeat + county dry-runs on `0028522`/`8cae402` — spider returned HTTP 400 with empty body on **every** URL (live and dead, marketbeat + county, identical body keys). That meant the request body itself was being rejected, not the targets.
- Probed the spider MCP server (`mcp__spider__spider_ai_scrape`) against `https://example.com` with just `url` + `prompt` — returned 200 with `[{metadata: {extracted_data: {...}}, status: 200, costs: {...}}]`. Two findings: (1) **spider works without `extraction_schema`** — every schema we sent was being rejected, possibly because spider's documented `extraction_schema: object` field doesn't actually accept arbitrary JSON Schema in practice; (2) **response is an array even for single-URL calls**, with the LLM output at `metadata.extracted_data`.
- `spider_client.ai_scrape()` now omits `extraction_schema` from the request body — kept `schema` as a no-op parameter so the call signature stays stable and `extract_client.extract()` doesn't need touching. `ai_scrape()` returns `list[dict]` (normalizes dict→[dict] for safety). `extract_rows()` walks `metadata.extracted_data[rows_key]` first, then `extracted_data` itself if it's a dict (single-row case) or list, then defensive legacy paths. 14/14 tests still green (mocked at the boundary).
- Next: re-trigger marketbeat + county dry-runs. Firecrawl agent is still refusing (separate diagnosis), so spider has to carry the load.

## 2026-05-26 (Opus 4.7 · fix/firecrawl-agent-client) — extract timeout + GHA wall-clock tuning

- Corridor + county dry-runs hit GHA's 15m/20m wall-clock without ever reaching a vendor traceback — firecrawl SDK was still polling at the kill. Marketbeat (3 URLs) finished in 9m and surfaced both vendor errors cleanly; corridor (4 URLs) couldn't make the same window. Confirms firecrawl agent polling time scales roughly per-URL.
- `extract()` default `timeout` lowered 900 → 480s so spider fallback always gets a real turn. GHA workflow `timeout-minutes` bumped 15→25 (corridor + marketbeat) and 20→25 (county) — combined budget of 8m firecrawl + ~12m spider per-URL fits comfortably under 25m even on the worst-case dead-URL run.
- Cancelled in-flight county run (was using the pre-fix spider body shape; would have timed out anyway). Marketbeat already finished and surfaced the spider 400 — that diagnostic was what enabled the schema-shape fix in the previous commit.

## 2026-05-26 (Opus 4.7 · fix/firecrawl-agent-client) — spider /ai/scrape request-shape fix

- Live GHA dry-runs on `fix/firecrawl-agent-client` surfaced two real failures: (1) firecrawl agent terminal `status=failed` with `Refusal: Error: Agent reached max credits (credits_used=0, job_id=None)` — vendor-side refusal before any work; (2) spider returning HTTP 400 with empty body on every URL. Root cause for spider: `extraction_schema` was being sent as OpenAI-style `{name, description, schema: JSON-encoded string, strict: bool}` wrapper, but spider's OpenAPI spec defines `extraction_schema: object` — a raw JSON Schema, no wrapper.
- Verified vendor-first against `spider.cloud/openapi.yaml`: spider's `/ai/scrape` body is `allOf(RequestParams, AIRequestExtras)`; `extraction_schema` is a plain object; `stealth`/`anti_bot`/`proxy_enabled` are top-level RequestParams fields (current placement correct); required field is `prompt` (current naming correct).
- Fix in `ingest/lib/spider_client.py`: `ai_scrape()` now forwards `schema` directly as `extraction_schema=schema`. Removed unused `schema_name`/`schema_description` parameters and the `json` import. `_post()` error message now includes request body keys + parsed response keys when present, so future empty-body 400s yield actionable debugging info instead of `returned 400: `.
- 14/14 tests still green (extract_client tests mock at the boundary, no breakage from signature change). Next: re-trigger dry-runs against the new commit; firecrawl refusal still needs separate diagnosis but spider fallback should now actually deliver rows.

## 2026-05-26 (Opus 4.7 · fix/firecrawl-agent-client) — firecrawl /v2/agent polling fix + spider fallback layer

- Root cause: `ingest/lib/firecrawl_client.py:agent()` was a single sync POST that returned the job-ID payload, never polled `GET /v2/agent/<id>`. Three pipelines (corridor_narratives, marketbeat_swfl, county_planning_swfl) were silently failing with "zero rows" because the extractor was reading `data.result.rows` on `{success, id}` — finds nothing → empty. Vendor-first verified `firecrawl-py>=4.28.0` already implements correct polling via `Firecrawl().agent()`.
- Wrapper fix: `agent()` now delegates to the SDK; raises `FirecrawlError` on terminal non-completed status (`failed` / `cancelled`) so silent-empty stops being a failure mode. `extract_agent_rows()` reads `data.rows` first; keeps legacy `data.result.rows` + `result.rows` as defensive fallbacks. 7 mocked tests cover happy + failed + legacy + empty + missing-key paths.
- Fallback layer (operator-requested, same PR): new `ingest/lib/spider_client.py` wraps `https://api.spider.cloud/ai/scrape` (defensive response parsing — OpenAPI spec underdocumented); new `ingest/lib/extract_client.py` `extract()` tries firecrawl across all URLs → on empty/error, per-URL spider fallback. Returns firecrawl-shape dict + `_provenance` log; raises `ExtractError` only when both vendors fail loudly per URL. 7 fallback tests green. 3 pipelines swapped to `extract()`; `SPIDER_API_KEY` wired to 3 GHA workflow env blocks + `ingest/.env.example`. Pipelines stay running on firecrawl-only when `SPIDER_API_KEY` unset.
- Why bundled: shared root cause (single client, three consumers); spider rescue is the durable answer to the silent-fail vendor lock-in.
- Discovery (use spider triage before next PR): all 4 corridor_narratives BROKER_SOURCES URLs are dead — `creconsultants.com/research/` 404, `lsicompanies.com/market-reports/` 404, `ipcswfl.com/research/` 525, `svnswfl.com/market-reports` 525. Wrapper fix surfaces this loudly now; URL audit is a separate follow-up PR per the corridor-broker-promotion plan Step 1.
- Followup commit on same branch: `spider_client.ai_scrape()` now sets `stealth=True` + `anti_bot=True` + `proxy_enabled=True` by default. Spider's `/unblocker` endpoint per OpenAPI only takes `RequestParams` (no `prompt`/`extraction_schema`), so chaining unblocker → re-extract would have been two round-trips; setting the same RequestParams flags on `/ai/scrape` does the unblock-then-extract in one call. This is the durable answer for the 525-blocked broker pages (`ipcswfl.com`, `svnswfl.com`).
- Next: live dry-runs (`gh workflow run corridor-narratives-quarterly.yml -f dry_run=true`, same for county-planning + marketbeat) to confirm spider rescue path lights up. Then URL audit follow-up.

---

## 2026-05-26 (Opus 4.7 · main) — corridor character generator Step 1 SHIPPED + tool-version correction

- Step 1 (Anthropic web_search verification + smoke against Pine Ridge Rd Naples) done. Vendor-first WebFetch confirmed contract; ran two questions through `web_search_20260209` then an A/B with `web_search_20250305` on Q1 after observing zero `cited_text` spans in the dynamic-filtering variant. Same prompt, same model, same `allowed_domains`: `20260209` returned 0 cited spans (Claude pipes content through code-execution and emits text from Python variables); `20250305` returned 9 verbatim cited spans with raw publisher URLs. **Corrected tool-version pick from `20260209` → `20250305`** in the v2 plan, the research doc (correction note at top), and memory. Anthropic-as-vendor unchanged.
- Other findings: `news-press.com` and `naplesnews.com` block Anthropic's crawler — API rejects allowlist with 400. Pine Ridge–specific NNN rents are not on the open web (paywalled in LoopNet/CoStar) — facts block will have to surface this as `{value: null, gap_reason: ...}` and let the speculative block do the inference work. Token budget for the full generator is ~$30/yr at `20250305`.
- Files: `docs/vendor-notes/anthropic-web-search-wire-up.md` (Step 1 deliverable — full Q&A, A/B table, blocked-publisher list, verified seed allowlist, parallel-eligible Step-2 task split for Opus + Sonnet), `docs/vendor-notes/anthropic-web-search-smoke-output.json` + `anthropic-web-search-compare-output.json` (raw API responses), `scripts/smoke/anthropic_web_search_smoke.py` + `anthropic_web_search_compare.py` (re-runnable). Plan + research doc + memory + this log carry the correction. `pip install anthropic` added a setup dep — flag for ingest pipeline `requirements.txt` work in Step 2 B1.
- Next: Step 2 (Pine Ridge end-to-end generator) — A1 Stage A fact pack builder + A2 SQL migration can run in parallel on Opus; B1 Stage B Python pipeline runs against the verified `20250305` contract on Sonnet; C1+C2 synthesis + lint stack are Opus-sequential after A+B contracts firm. Worktree pattern recommended. Plan path: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`. Wire-up doc: `docs/vendor-notes/anthropic-web-search-wire-up.md`.

---

## 2026-05-26 (Sonnet 4.6 · main) — CCPM installed + corridor character generator epic wired to GitHub

- Installed CCPM (agentskills.io PM skill) into `.claude/skills/ccpm/` — gives any session a live `standup.sh` + GitHub Issues source of truth instead of relying on SESSION_LOG alone. Motivated by 4-5 parallel sessions with no shared state.
- Created corridor character generator epic in CCPM: `.claude/prds/corridor-character-generator.md` + `.claude/epics/corridor-character-generator/` with 5 task files (34.md–38.md). Synced to GitHub: epic #33, tasks #34–#38 (`ethanrickyjrjr-wq/brain-platform`).
- Step 1 (vendor verification) was already DONE by a prior Opus session — discovered from untracked `docs/vendor-notes/anthropic-web-search-wire-up.md`. Critical finding: **use `web_search_20250305`, NOT `web_search_20260209`** (dynamic filtering kills citations — 0 `cited_text` spans). Posted finding on GitHub epic #33 and closed issue #34.
- Step 2 parallel decomposition from wire-up doc posted to GitHub: Batch A (fact pack builder + SQL migration, parallel) → Batch B (corridor_grounded pipeline, `web_search_20250305`) → Batch C (synthesizer + lint stack).
- Next: any session picking up Step 2 should read `docs/vendor-notes/anthropic-web-search-wire-up.md` first, then `gh issue view 35` for acceptance criteria. Branch: `feat/corridor-character-generator-step-2`.

## 2026-05-26 (Opus 4.7 · main) — corridor character generator v2 plan propagation

- Locked v2 plan for replacing `corridor_profiles.character` (24–26 May-era Claude-drafted strings) with a two-block generator output: facts block (strict, sourced, lint-tight) + speculative block (AI unleashed with inline "Speculative — double-check" disclaimer). Optional chart block when comparison is useful. Sources chart page at the bottom of every answer carries citations + freshness token + legal/disclaimer (NOT in the answer body).
- Anthropic `web_search_20260209` locked as the grounded-search vendor. Decision rationale captured in `docs/vendor-notes/grounded-search-research-2026-05-26.md` from a 7-vendor background research run; per-claim citations with `cited_text` spans + raw publisher URLs + `ANTHROPIC_API_KEY` already wired. Three-vendor bake-off skipped — structural pick was clear.
- Propagation shipped in this commit: canonical plan at `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`; vendor research at `docs/vendor-notes/grounded-search-research-2026-05-26.md`; CLAUDE.md SWFL Protocol rule 8 carries an in-place carve-out exempting the speculative block from the smoothing-tokens ban; ontology-and-roadmap.md bumped to v1.6 with a new "Future-vision items (post-character-generator)" section (FL-other-cities comparison, statewide/national anchors, forecasts, outlier brain, BYO overlay, Tavily helper — all gated, none start before the generator ships one full cycle); memory `project_corridor-character-generator.md` indexed in MEMORY.md as a high-visibility ACTIVE PLAN pointer.
- Next: Step 1 — Anthropic web_search vendor-first check + smoke test against one corridor (Pine Ridge Rd Naples). Gated on operator availability. Plan path: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`.

---

## 2026-05-26 (Opus 4.7 · main) — corridor character snapshot baseline

- Froze the live `corridor_profiles.character` strings into a committed baseline at `docs/audits/2026-05-26-corridor-character-snapshot.md` (26 corridors · 10 Collier · 16 Lee · 0 unknown-county · 0 pending broker narratives). Source: `refinery/tools/pull-corridor-character-snapshot.mts` (re-runnable; same-day re-runs are byte-identical). Renames an earlier audit-mode puller; strips the per-row decision-checkbox template — file is a data snapshot, not a worksheet. Reverted the `docs/audits/*-corridor-character-audit.md` gitignore rule. Added `npm run snapshot:corridor-character`. Carries along the parallel-session commit `20692fc` (bare-env fix) onto origin/main.
- Why now: the May-2026 Claude-drafted character strings are about to be replaced by a corridor-character generator (deterministic local data pack + Gemini grounded answer → cited prose). Need a diff baseline + restore safety before the live column gets rewritten.
- Next: vendor-first check on the Gemini grounding API (model ID, grounded-answer response shape, citation format) before scoping the generator pipeline. Do not start the generator until that check is in-session.

---

## 2026-05-26 (Opus 4.7 · main) — env names: BRAINS\_ no longer required

- Finished the 2026-05-25 env normalization. Code now reads canonical bare `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` first, with `BRAINS_SUPABASE_*` as legacy fallback (matches the `service-role.ts` pattern from PR #19/#30). Updated: `refinery/config/env.mts:76-82`, `refinery/lib/predictions-log.mts:97-104`, `refinery/lib/predictions-log.test.mts` (clears both pairs), `scripts/lake-probe.mts:8-10`. Stale doc comments fixed: `refinery/tools/embed-all-concepts.mts`, `refinery/packs/cre-swfl.mts`, `.claude/commands/vault.md`, `utils/supabase/service-role.ts`.
- Why this slipped: PR #19 normalized `.env.example` + the GHA cron wrappers but left the runtime code reading `BRAINS_`-prefixed only. Anyone running with a fresh `.env.local` (bare names only) hit "missing env" — Ricky just hit it via `npm run audit:corridor-character`. The legacy fallback stays per `docs/littlebird-notes/2026-05-26.md`: "Don't cleanup the fallback first" — Vercel still has the legacy names.
- Verified: `bun test refinery/lib/predictions-log.test.mts` 5/5 pass; `npx tsc --noEmit -p .` clean.
- Next: when Vercel env is renamed, one-line PR to delete the `??` legacy fallback in each of the 4 code sites.

---

## 2026-05-26 (Opus 4.7 · main) — cleanup pass

- Merged PR #32 (`acee6aa`) and PR #29 (`ca0a099`). main is at `ca0a099`. Zero open PRs.
- Resolved PR #29's SESSION_LOG.md conflict in the `brain-platform-permits` worktree by taking origin/main's version (which had the corrective Opus entry from PR #32) — no content was lost. Merge commit on the branch: `1a14e85`, squashed into `ca0a099` on merge.
- Cleaned up 4 stale remote branches (`feat/permits-swfl-v2`, `feat/firecrawl-pipelines`, `feat/firecrawl-pipelines-github-actions`, `fix/waitlist-resend-lazy-init`) — all confirmed merged via PRs #29/#17/#15/#16. Removed the permits worktree. Force-deleted 2 stale local branches (squash-merge orphans).
- Final remote: only `origin/main`. Final local: only `main`. Working tree: only the untracked `docs/superpowers/plans/2026-05-26-corridor-broker-narrative-promotion/` directory (operator's, not from any session).
- Next: operator refresh — `git pull` in any other sessions, point Sonnet at the worktree pattern (`git worktree add ../brain-platform-<branch> <branch>`) for the next parallel run.

## 2026-05-26 (Opus 4.7 · fix/redfin-dry-run)

- Restored the Opus race-condition entry below that the prior `9c514eb` commit dropped (append-only violation: Sonnet edited from a stale read of SESSION_LOG.md and rewrote my entry with an older version).
- No code changes; SESSION_LOG.md only. This is a corrective commit so the eventual merge to main does not silently delete the warning entry already on origin/main.
- Lesson for the next session: **before editing SESSION_LOG.md, `git pull` first and confirm you see every prior session's entry.** If your edit would remove any line of any prior `## YYYY-MM-DD (model · ...)` block, stop — you're working from a stale base.

## 2026-05-26 (Sonnet 4.6 · fix/redfin-dry-run)

- Added `--dry-run` to `ingest/duckdb_pipelines/redfin_swfl/pipeline.py` + `test_dry_run.py`.
- Last of the not-yet-running pipelines missing the flag; all 8 now covered.
- Next: merge PR #29 and this PR after CI green.

## 2026-05-26 (Sonnet 4.6 · feat/permits-swfl-v2)

- Rebased `feat/permits-swfl-v2` (651c102) onto main (c19d3ca); 1 commit, clean.
- Added `--dry-run` to `ingest/pipelines/lee_permits/pipeline.py` + test; 33/33 green.
- Updates PR #29 (already open); no new PR needed.
- Next: merge PR #29 after CI green; add `--dry-run` to `redfin_swfl` on separate branch.

## 2026-05-26 (Opus 4.7 · main)

- Shipped enforced session-log mechanism + commit/push autonomy rubric. Five files: `SESSION_LOG.md` (this), `CLAUDE.md` (RULE 0 + RULE 1 at top, behind `<!-- SESSION-LOG-RULE-MARKER -->`), `.claude/hooks/print-session-log.mjs` (SessionStart: prints last 8 entries + verifies marker), `.claude/hooks/check-session-log-on-push.mjs` (PreToolUse Bash: blocks `git push` when no commit ahead touched SESSION_LOG.md), `.claude/settings.json` (wired).
- RULE 1 authorizes Claude to commit + push small/policy/tooling changes without asking, and lists what still requires a diff review (brain pack math, ingest→data_lake, schema migrations, multi-file refactors, anything affecting live `/api/b/*` or MCP).
- Race condition discovered mid-build: a parallel Sonnet 4.6 session sharing this working tree picked up my untracked `SESSION_LOG.md`, committed it onto `feat/permits-swfl-v2`, and switched HEAD under me. Sonnet's own entry will arrive on `main` when PR #29 merges — expect a 30-second conflict on this file, resolve by keeping both entry blocks. **Operator action needed: use `git worktree add` for parallel Claude sessions, not the same working tree.**
- Memory: `project_session-log-mechanism.md` + high-visibility pointer at top of MEMORY.md.
- Pushing this commit now under RULE 1 authority.

## 2026-05-25 (prior session · main)

- Seed entry — see git log for c19d3ca (GHA unblock + brand scrub), 86435b8 (Lane D fully live), c3b9d0a (waitlist env-name fallback #30).
