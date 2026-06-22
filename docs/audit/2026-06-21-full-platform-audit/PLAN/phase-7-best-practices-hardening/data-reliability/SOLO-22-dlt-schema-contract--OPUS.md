# 22 — dlt `schema_contract` on load-bearing pipelines (durable schema-drift guard)

**Model: OPUS.** Per-pipeline dlt config touching multiple `pipeline.py` files + a vendor-API surface
(`schema_contract` request shape) whose exact keys must be confirmed live — the choice of evolve-vs-freeze
per table is judgment, not mechanical. **Priority: P2.** Best-practices *hardening* (durable
recurrence-prevention), not a daily red — the daily red is build 01; this stops its whole class from coming
back. (REPORT "three things that break" row 1 + P0 #1 + observability Schema row.)

## The gap (verified)
dlt **never `ALTER`s an existing column** — it follows the structure of the *extracted* data and evolves the
schema, but a pre-existing destination column with a conflicting type drives a hard `DatatypeMismatch` on
load. That is exactly the news_swfl red build 01 fixes: `ingest/pipelines/news_swfl/pipeline.py:12-14` pins
`columns={"published_date": {"data_type": "text"}}` against a legacy `date` column, and the dlt LOAD fails
**every run** (`psycopg2.errors.DatatypeMismatch: column "published_date" is of type date but expression is
of type character varying`).

Build 01 ALTERs that ONE column ONCE to align the live DB with the pipeline's committed intent. It does
**nothing** to stop the *next* type drift on the *next* column of the *next* pipeline — the same failure
re-opens silently. **Verified across the ingest fleet** (probe in STEP 1): the pipelines run bare
`@dlt.resource(...)` / `pipeline.run(...)` with **no `schema_contract`** set anywhere —
`ingest/pipelines/news_swfl/pipeline.py` (the `columns=` override but no contract),
`ingest/pipelines/fema/pipeline.py` (a `tier1_inventory` pipeline that swallows failures in a bare
`except`), and the ~45 other `ingest/pipelines/*/pipeline.py`. There is no durable guard: a type drift either
crashes opaquely (current news_swfl behavior) or — worse on the swallow path — disappears.

`schema_contract`'s `data_type` entity is the durable complement. On type drift, `"evolve"` routes the
non-coercible data to a **variant column** (dlt convention `<col>__v_<type>`, e.g. `published_date__v_text`)
instead of crashing; `"freeze"` raises a clean `DataValidationError` (re-raised via `PipelineStepFailed`)
carrying full context — `schema_name` / `table_name` / `column_name`, `schema_entity` / `contract_mode`, and
the causing `data_item` — so the failure is loud *and* diagnosable, not an opaque psycopg crash. Either is a
strict improvement over the silent/opaque status quo, and `load_info` already carries the
`schema_update` deltas we should be surfacing on every column change.

## Steps
1. **Probe first (RULE 0.5 — read the actual files, do NOT trust this spec's line numbers blindly):**
   - `ingest/pipelines/news_swfl/pipeline.py` — confirm the `@dlt.resource(... columns={"published_date":
     {"data_type": "text"}})` override and that **no** `schema_contract=` is present (the start target).
   - A representative second pipeline (e.g. `ingest/pipelines/fema/pipeline.py` and one ArcGIS/API source) —
     confirm the bare `dlt.pipeline(...).run(...)` shape and whether failures are swallowed (`fema`'s bare
     `except` is the danger case: a drift there vanishes, so a contract is *more* valuable, not less).
   - `ingest/lib/` (`guards.py`, `coercion.py`, `__init__.py`) — confirm there is **no** shared dlt-config
     helper today and decide whether the alert-surfacing of `load_info...schema_update` belongs in a small
     shared helper or inline per-pipeline. Do NOT invent a new global wrapper if a per-pipeline kwarg suffices.
   - Confirm which pipelines are genuinely "load-bearing" (the daily-rebuild inputs) before widening past
     news_swfl — start narrow.
2. **Vendor-first (RULE 1 — `schema_contract` is a dlt API surface; the round capture is a *pointer*, not
   authority for verbatim values):** `WebFetch` the **live** dlt docs in-session
   (`https://dlthub.com/docs/general-usage/schema-contracts`) and reconfirm, verbatim, at build time:
   (a) the entity keys `tables` / `columns` / `data_type` and that `data_type` is the one governing type
   drift + variant columns; (b) the mode values `evolve` / `freeze` / `discard_row` / `discard_value`;
   (c) that `freeze` raises `DataValidationError` re-raised as `PipelineStepFailed` and the exact context
   fields; (d) the **variant-column naming convention** (`<col>__v_<type>`) — do not ship `__v_text`
   from memory if the live docs say otherwise; (e) that the contract is accepted on `@dlt.resource` /
   `@dlt.source` / `pipeline.run()` with run-level overriding. The wrong key ships silently and the guard is
   a no-op.
3. **RULE 3.5 brainstorm (short, at execution time):** the one real decision is **evolve vs freeze per
   pipeline**. `freeze` = loud clean fail (best for a curated brain-input table where a drift means upstream
   broke — you *want* the run to stop); `evolve` = variant column, no crash (best where a new variant is
   tolerable and a downstream view can pick it up). For news_swfl specifically: build 01 already aligns the
   column to `text`, so a contract there is recurrence-prevention — lean `freeze` on `data_type` so the
   *next* drift fails loud with context instead of re-opening the opaque psycopg red, but confirm no
   benign variant is expected first. Also decide whether `columns`/`tables` get any constraint or stay
   `evolve` (default) — keep new-column/new-table tolerance unless a specific table is curated.
4. **Implement — per-pipeline, opt-in, additive.** Start on news_swfl: add `schema_contract={"data_type":
   "freeze"}` (or the brainstormed per-pipeline value) to its `@dlt.resource`, leaving `tables`/`columns` at
   the `evolve` default. Then wire the highest-value daily-rebuild tables one at a time. Wrap the
   `pipeline.run()` in the `try/except PipelineStepFailed` shape from the dlt docs so the
   `DataValidationError` context is logged in plain English (table/column/contract_mode) — not a bare stack.
5. **Surface `schema_update` to the alert path.** After every successful `pipeline.run()`, read
   `load_info` and emit any `schema_update` (added/changed columns) to the same log/alert path the cron
   ledger reads, so **every column change is visible** — not just the ones that break. This is the
   observability half of the REPORT Schema row; coordinate the message shape with build 28 (the cron
   postmortem record) so a schema delta lands as a real ledger line, and with build 04 (the
   `DatatypeMismatch` classifier rule) so a contract-`freeze` failure is classified as a schema event, not a
   crawl flap.

## Architecture guardrail (bake in — RULE 3 C2)
This is a **data-pipeline** build. It is framed as **EXTENDING each pipeline's own dlt config** — a
per-pipeline, opt-in `schema_contract` kwarg on the existing `@dlt.resource`, plus reading the `load_info`
the pipeline already returns. It is **NOT** a new mandatory global pre-materialization gate that every source
must pass through. The five-facet **"Source Contract as spine" bundled-governance design was already REJECTED
on evidence** (dbt warns against early bundled governance; ODCS is descriptive, not a gate). Do **not**
re-erect it here under a new name. Each pipeline opts in where the curator decides a contract earns its keep;
ungated pipelines keep their current default-`evolve` behavior untouched.

## Dependencies / file-conflicts
- **Builds on / runs AFTER build 01.** 01 ALTERs the live `news_swfl.published_date` column NOW (aligns DB to
  the pipeline's committed `text` intent); 22 is the **durable recurrence-prevention** that stops the class.
  22 may touch the same `ingest/pipelines/news_swfl/pipeline.py` — do not run concurrently with 01.
- **Touches per-pipeline dlt config** (`pipeline.py` across the started set) — stage explicit paths only;
  these are independent files but the `schema_update`-alert helper (if shared) lands once in `ingest/lib/`.
- **Coordinates with build 04** (the `DatatypeMismatch` classifier rule) — a contract-`freeze` failure should
  be classified as a schema event. Align the error string / ledger reason so 04's classifier matches it.
- **Complements build 25** (the at-rest column-type-change detector) — 25 detects drift in the DB after the
  fact; 22 prevents/loud-fails it at write time. Don't duplicate the detection logic; let 22 own write-time,
  25 own at-rest.

## Done when
- A real verification gate, not a code-read:
  1. **news_swfl carries a contract:** `grep -n 'schema_contract' ingest/pipelines/news_swfl/pipeline.py`
     returns the added kwarg, and `python -c "import ingest.pipelines.news_swfl.pipeline"` imports clean.
  2. **A `news-swfl-ingest` run (local or `workflow_dispatch`) completes the dlt LOAD with exit 0** and rows
     land (after build 01's ALTER) — i.e. the contract does not break the happy path.
  3. **Drift fails loud, with context** — a one-off probe (feed one row whose `published_date` is a
     non-coercible value into a throwaway dataset, or unit-test the resource against a frozen schema) shows
     either a `<col>__v_<type>` variant column created (`evolve`) **or** a `PipelineStepFailed` whose
     `__context__` is a `DataValidationError` printing the table/column/contract_mode (`freeze`) — NOT a bare
     `psycopg2.errors.DatatypeMismatch`.
  4. **`schema_update` is surfaced** — a forced added column appears in `load_info` and is emitted to the
     log/alert path (visible to the cron ledger), proving every column change is observable.

## Risk
Low–medium. Additive and per-pipeline, so blast radius is one resource at a time, and ungated pipelines are
untouched. The one real hazard is choosing `freeze` on a table that *legitimately* gets a new variant — that
would start failing loud on a benign change; mitigated by the per-pipeline brainstorm (STEP 3) and by starting
on news_swfl (where build 01 already pinned the column, so no benign drift is expected). Vendor-surface drift
(wrong entity key / variant-naming) is mitigated by the mandatory in-session `WebFetch` (STEP 2) — the wrong
key ships a silent no-op, which is why the verification gate (STEP "Done when" #3) forces an observed drift,
not a code-read.

## References (added 2026-06-22)
**best-practices-research (docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round1/data-dlt-schema-contracts.md` — evolve vs freeze, variant columns, PipelineStepFailed context (the `DataValidationError` fields)
- `docs/audit/2026-06-21-best-practices-research/round1/data-dlt-schema-evolution.md` — column evolution semantics; why dlt never ALTERs an existing column
- `docs/audit/2026-06-21-best-practices-research/round3/q-dlt-data-types-coercion.md` — date/varchar coercion (the `published_date` class)
- `docs/audit/2026-06-21-best-practices-research/round2/data-dlt-write-dispositions.md` — how the contract interacts with write disposition (merge/append/replace)
**crawl4ai-live (docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — data-reliability build)
**Ties to existing builds:** build 01 (the one-off ALTER this generalizes), build 04 (DatatypeMismatch classifier), build 25 (the at-rest schema-change detector)
**Verified:** dlt `schema_contract` entity keys (`tables`/`columns`/`data_type`) + modes (`evolve`/`freeze`/`discard_row`/`discard_value`) + `freeze`→`DataValidationError`-via-`PipelineStepFailed` confirmed against live dlt docs 1.28.1 in-session — RECONFIRM verbatim at build time (RULE 1); variant-column naming `<col>__v_<type>` to be re-verified before shipping `__v_text`.
