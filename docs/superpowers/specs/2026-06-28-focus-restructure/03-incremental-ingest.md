# Issue 03 — Incremental Ingest (stop re-fetching everything)

**Parent analysis:** `docs/superpowers/specs/2026-06-28-repo-focus-restructure-analysis.md`
**Status:** SPEC-READY breakdown. NOT built. Build via the protocol at the bottom.
**Priority:** #3 — real engineering; per-source; verify dlt docs live before coding.
**One line:** Adopt dlt incremental cursors so append-heavy pipelines extract only new/changed rows
(keep `merge` for idempotency); leave full-snapshot sources on `replace` and document WHY.

---

## 1. THE PROBLEM (in detail, with evidence)

Ricky's complaint — "we ingest ALL data instead of just updating new data with the current" — is
**literally true at the extraction layer.** Measured across `ingest/`:
- `write_disposition="merge"`: **17** pipelines (idempotent upsert by `primary_key` — good)
- `write_disposition="replace"`: **8** pipelines (full table wipe + reload)
- **`dlt.sources.incremental`: 0 occurrences. Nowhere.**
- `primary_key`: 74 uses · `merge_key`: 0 · `upsert`: 431 (mostly TS/SQL, not the dlt extract layer)

So even the 17 "merge" pipelines pull the **entire source dataset every run**, then upsert. Nothing
uses an incremental cursor to fetch only rows newer than the last load. The 8 "replace" pipelines
wipe and reload the whole table.

### The named full-replace pipelines (`write_disposition="replace"`)
`ingest/pipelines/census_acs/resources.py`, `census_cbp/`, `fdot/`, `fema/`, `fhfa/`,
`fl_dbpr_licenses/`, plus `ingest/scaffold.py` (the template — so NEW pipelines inherit replace!).

---

## 2. GROUND TRUTH — everything you need so you don't re-investigate

### `replace` is NOT always wrong — this is a PER-SOURCE decision (do not blanket-convert)
- **Full-snapshot sources** (small, whole-table, no natural cursor) — e.g. **Census ACS**, FHFA HPI:
  `replace` is *correct*. Each release is the full table. Leave it; document WHY in the area's
  `decisions.md` (ADR).
- **Append-heavy / event sources** — permits, listings, licenses, anything with a date or monotonic
  id: this is where incremental belongs. Use `dlt.sources.incremental("<cursor_col>")` so extraction
  pulls only rows newer than the last loaded value; keep `write_disposition="merge"` + `primary_key`
  for idempotent upsert.
- **The scaffold/template defaulting to `replace` is the root cause of the spread** — fix the
  template so new pipelines start incremental-aware.

### Project rules this issue MUST obey (already locked — re-read, don't reinvent)
- **PROBE FIRST (ingest):** before any multi-minute ingest, run the <1-min probe. Fetch only the
  columns the normalizer reads, at the largest page the API honors. (`docs/standards/data-and-build-bible.md` §0.1–0.2)
- **Gate 4 (pre-push):** a destructive write with no non-null guard is BLOCKED. Guard load-bearing
  columns via `ingest.lib.guards` before any `replace`. Override only with `ALLOW_REPLACE_WITHOUT_GUARD=1`.
- **Aggregate at source (OPERATOR DECREE, repeated):** push COUNT/AVG/median/grouping to SQL/DuckDB.
  Don't haul raw rows. `selectAllPaged` is legacy, not the target. New work defaults to aggregated queries.
- **Brain-first ingest gate:** no bulk ingest hits Tier 2 (`data_lake.*`) without its consuming
  brain's `PackDefinition` in the same PR.
- **dlt → PostgREST grant** after table creation:
  `GRANT SELECT ON ALL TABLES IN SCHEMA data_lake TO service_role; NOTIFY pgrst,'reload schema';`
- **Pipeline-freshness:** every pipeline ships its GHA cron wrapper + `--dry-run` in the same PR.
  (`docs/standards/pipeline-freshness.md`)
- Creds: `.dlt/secrets.toml`. Migrations via `new Bun.SQL` (psql NOT installed). `sslmode=require`.

### The reference implementation (NOT realtor.com)
**realtor.com is NOT an incremental target.** It's monthly FULL S3 CSV snapshots — each file
re-publishes all ZIPs for the month. Per our own note it loads as **REPLACE** (or `merge` on a
zip+month key); leave it. Do not call it the incremental reference (that was a contradiction in the
first draft).
Pick a genuinely append/event source as the reference implementation instead:
- **permits (Accela)** — new permits arrive by date; clean server-side cursor candidate.
- **listing_lifecycle event stream** — DOM ticks accrue over time. NOTE:
  `ingest/pipelines/listing_lifecycle/distill.py` is being actively modified by a parallel session —
  coordinate before building on it.

---

## 3. THE BUILD

1. **Audit (classify all 25 pipelines):** for each, decide snapshot (keep `replace`, document) vs
   append-heavy (move to incremental + merge). Produce a table in the spec: pipeline → source shape →
   cursor column (or "none") → target disposition.
2. **Verify dlt incremental API LIVE (RULE 0.4):** crawl the current dlt docs for
   `dlt.sources.incremental` — cursor column, `initial_value`, `last_value_func`, `primary_key`/
   `merge_key` semantics, and how state is persisted. The API and idiom drift between dlt versions;
   confirm against the version in `ingest/` (check `pyproject`/`requirements`). DO NOT code from memory.
3. **Fix the scaffold/template first** (`ingest/scaffold.py`) so new pipelines are incremental-aware
   by default.
4. **Convert the append-heavy pipelines** one at a time: add the incremental cursor, switch to
   `merge` + `primary_key`, guard before any remaining destructive path, ship the cron wrapper +
   `--dry-run`.
5. **Verify row deltas:** after converting, a second run with no new source rows should write ~0 rows
   (proof of incrementality), not re-load the table.

---

## 4. EXECUTION PROTOCOL — do exactly this, in order
1. **Read first (RULE 0.5):** this file, parent analysis, `docs/standards/data-and-build-bible.md`
   §0.1–0.2, `docs/standards/pipeline-freshness.md`, `ingest/scaffold.py`, and 2 real pipelines (one
   merge, one replace) to learn the house style.
2. **Research first (RULE 0.4):** crawl4ai the live dlt incremental-loading docs. Write findings into
   `SESSION_LOG.md` so the next session inherits evidence.
3. **Brainstorm (RULE 3.5)** the per-source classification table with Ricky before touching code.
4. **Register the build:** `node scripts/new-build.mjs incremental-ingest "Incremental ingest: dlt cursors + per-source replace/merge audit"`.
5. **PROBE before any real ingest run** (<1 min). Guard before any destructive write (Gate 4).
6. **TDD where pure:** the normalizer/classification logic gets tests first. Pipelines get a
   `--dry-run` proof.
7. **One pipeline per PR/commit group.** Ship cron wrapper + dry-run in the same change.
   Brain-first: consuming `PackDefinition` in the same PR for any new Tier-2 table.
8. **Verify live:** second no-new-rows run writes ~0 rows; PostgREST grant applied; freshness probe green.

---

## 5. HARD RULES / GUARDRAILS
- **Do NOT blanket-convert replace→incremental.** Snapshot sources keep `replace`. This is per-source
  or you'll break correct pipelines.
- **Never code the dlt incremental API from memory.** Verify the live docs for the installed version
  first (RULE 0.4). Wrong cursor semantics silently double-load or skip rows.
- **Never bypass Gate 4** without an explicit guard and a logged reason.
- **Aggregate at source.** If you're hauling raw rows to count them in TS, you've done it wrong.
- **No invented numbers ever.** This is data plumbing — a wrong row count must come from a real query,
  never an estimate.

## 6. VERIFICATION (definition of done)
- Every pipeline classified (snapshot vs append) with its disposition justified.
- Converted append-heavy pipelines: second no-delta run writes ~0 rows (logged proof).
- `ingest/scaffold.py` defaults to incremental-aware.
- Each converted pipeline ships its cron wrapper + `--dry-run`; PostgREST grant applied; freshness
  probe green.
- Gate 4 satisfied (guards present); `bun test` / ingest tests green.

## 7. ANTI-PATTERNS (what NOT to do)
- Switching Census ACS to incremental (it's a full snapshot — pointless and risky).
- Adding a cursor without a `merge` + `primary_key` (you'll append duplicates).
- Skipping the probe and running a multi-minute full pull "just to see."
- Landing a Tier-2 table without its consuming brain (violates brain-first gate).

## 8. OPEN QUESTIONS for brainstorming
- Which sources have a reliable monotonic cursor (updated_at vs created_at vs a load-date)?
- For sources without a server-side cursor, do we use a client-side high-water mark or accept periodic full merge?
- Which append/event source is the incremental reference — permits (Accela) or listing_lifecycle? (NOT realtor.com — it's a monthly snapshot → REPLACE.)
