# SOLO-25 — value-level data tests (Quality pillar) + column-type-change detector (Schema pillar)

**Date:** 2026-06-22 · **Build:** Phase-7 #25 (`docs/audit/2026-06-21-full-platform-audit/PLAN/phase-7-best-practices-hardening/data-reliability/SOLO-25-value-tests-and-schema-detector--OPUS.md`) · **Priority:** P2 (best-practices hardening, not a daily-red fix).

## Goal

Fill the two Monte Carlo observability pillars the lake has **zero** coverage on today — **Quality** (no value tests assert that a load-bearing column is non-null / a key is unique / an enum stays in its set) and **Schema** (`check_view_liveness` catches a dropped view / missing GRANT, but **not** a column added / removed / **type-changed at rest** — the `news_articles_swfl.published_date` `date`↔`text` class that crashes a dlt LOAD with no warning).

Freshness + Volume are already covered by `ingest/scripts/check_freshness.py` (`check_tier2_entry` / `check_volume_entry`). This build adds Quality + Schema **beside** them, on the same probe seam.

## Binding guardrails

- **RULE 3 C2 — extend the seam, never erect a new mandatory pre-materialization gate.** This is **observability, not gating**: it mirrors `check_freshness.py`'s "Always exits 0" contract. A value-test failure or schema drift surfaces in the GHA step summary (and may open a `public.checks` row, same pattern as the structural-gap detector) — it does **not** abort a build. It is **opt-in per table**; a table is untouched unless it appears in the quality registry. It is **not** the rejected five-facet "Source Contract as spine."
- **SQL injection is the one real hazard.** Every table / column identifier routes through `psycopg.sql.Identifier`; every accepted-value routes through a bound parameter. **Never** an f-string into SQL.

## Architecture

New sibling script `ingest/scripts/check_data_quality.py`, invoked by a **second `run:` step** in the existing `freshness-probe-daily.yml` job (same `env:` block; independent step = independent log + summary visibility). It imports `_get_connection` and `_to_date` from `check_freshness.py` and reuses that module's defensive patterns. Always exits 0.

### Why a sibling script, not in `check_freshness.py`

`check_freshness.py` is already ~870 lines. Quality/Schema is a distinct concern keyed by **physical table** (the freshness probe is keyed by **pipeline name**, which often differs from its table). A sibling keeps each module focused.

### Config: `ingest/quality/quality_registry.yaml` (keyed by table)

A **separate** file, NOT `cadence_registry.yaml` (which is overloaded and keyed by pipeline, not table). Shape:

```yaml
tables:
  data_lake.news_articles_swfl:
    value_tests:
      - { col: article_url, test: not_null, severity: error }
      - { col: article_url, test: unique, severity: error }
      - { col: source_name, test: not_null, severity: warn }
      - { col: source_name, test: accepted_values, severity: warn,
          values: [collier_county_govt, fort_myers_news_press, lee_county_govt, naples_daily_news] }
    schema_baseline: true
  data_lake.zhvi_swfl:
    value_tests:
      - { col: zip_code,   test: not_null, severity: error }
      - { col: period_end, test: not_null, severity: error }
      - { col: home_value, test: not_null, severity: warn }
    schema_baseline: true
  data_lake.zori_swfl:
    value_tests:
      - { col: zip_code,   test: not_null, severity: error }
      - { col: period_end, test: not_null, severity: error }
      - { col: rent_index, test: not_null, severity: warn }
    schema_baseline: true
  data_lake.leepa_parcels:
    value_tests:
      - { col: folioid, test: not_null, severity: error }
      - { col: folioid, test: unique,   severity: error }
    schema_baseline: true
```

All seed assertions were verified against the live DB on 2026-06-22 to return **zero failing rows** (so the first CI run is genuinely green): news 64 rows (0 null/dupe url, 0 null source), zhvi 33,922 rows, zori 5,277 rows, leepa 548,798 rows (0 null/dupe folioid). `leepa.last_sale_amount` has 20,668 NULLs — used as the deliberate-failure proof column, NOT seeded into the registry.

### Pilot scope

Four load-bearing tables only (do not boil the ocean): `news_articles_swfl` (the published_date class), `zhvi_swfl` + `zori_swfl` (the parity-tested home-value spine), `leepa_parcels` (the largest Lee value table). More tables = adding a key to the registry; default = untouched.

## Components

### 1. Quality — value tests

For each table's `value_tests:`, run the dbt model (a test passes iff its failing-row query returns 0):

- `not_null(col)` → `SELECT count(*) FROM <t> WHERE <col> IS NULL`
- `unique(col)`   → `SELECT count(*) FROM (SELECT <col> FROM <t> WHERE <col> IS NOT NULL GROUP BY <col> HAVING count(*) > 1) d`
- `accepted_values(col, [v1,…])` → `SELECT count(*) FROM <t> WHERE <col> IS NOT NULL AND <col>::text <> ALL(%s::text[])`, params `= [[str(v) for v in values]]`

**`accepted_values` composition — LOCKED (proven live 2026-06-22).** The psycopg2 idiom `... NOT IN %s` with a list param does **NOT** work in psycopg3 — psycopg3 adapts a Python list to a PG **array** literal, not a SQL tuple, so the query raises `SyntaxError at or near "$1"`. We use the **`<> ALL(%s::text[])`** form instead (a single bound param, type-agnostic via the `::text` cast, no dynamic-placeholder bookkeeping). Verified against `data_lake.news_articles_swfl.source_name`: full accepted set → 0 failing rows; drop one value → 5 failing rows (fires correctly). Do **not** substitute `NOT IN (%s,%s,…)` dynamic placeholders — it works too but the `ALL(array)` form is the locked choice.

Pure SQL builders `build_not_null_sql / build_unique_sql / build_accepted_values_sql` return `(query, params)` where `query` is a `psycopg.sql.Composable` — unit-testable without a DB. Each test runs in its own `try` / `conn.rollback()` (a missing table can't break the run, mirroring `_fetch_max_freshness`). Result per test: `{table, col, test, severity, failing_rows, status: PASS|FAIL}`.

### 2. Schema — column-type-change detector

For each table with `schema_baseline: true`:

- Read live `information_schema.columns` → `{column_name: data_type}` (parameterized `table_schema` / `table_name`).
- Diff vs checked-in `ingest/quality/schema_baselines/<schema>.<table>.json` (`{column: data_type}`).
- Classify each delta: `ADDED` (in live, not baseline), `REMOVED` (in baseline, not live), `TYPE_CHANGED` (type differs). `TYPE_CHANGED` is the load-bearing signal (the published_date class) — surfaced loud.
- **Missing baseline file** → `BASELINE_MISSING` (surface a note: "run `--update-baseline`"), never a crash.

**`diff_schema(baseline, live)` return shape (LOCKED so the unit test is unambiguous):** `list[dict]`, one entry per delta, sorted by `col`:
```python
{"col": str, "change": "ADDED"|"REMOVED"|"TYPE_CHANGED",
 "baseline_type": str | None,   # None for ADDED
 "live_type": str | None}       # None for REMOVED
```
Identical maps → `[]`. The classifier is pure (two dicts in, list out) — no DB.

Baseline JSON is generated/re-blessed by **`--update-baseline`**, which is **manual, dev-run, committed in the same PR as the intended type change**. The GHA probe **never** writes baselines — auto-committing from CI would silently bless unintended drift, defeating the detector. CI only diffs-and-surfaces.

Vocab alignment: the at-rest `TYPE_CHANGED` reason code aligns with build-04's SCHEMA_DRIFT classifier (write-time). Build 22 (dlt `schema_contract`) catches drift at WRITE; this catches it AT REST — complementary, not redundant.

### 3. Checks-ledger sync (non-`--dry-run` only)

`_QUALITY_PROJECT = "data-quality"` (distinct from the gap detector's `cre-swfl`). On an **`error`-severity** value-test FAIL or any **`TYPE_CHANGED`**, open/auto-close a `public.checks` row over the existing psycopg connection, reusing the `sync_gap_checks` idempotent open / auto-close / respect-dropped logic.

**check_key format (LOCKED):** the table portion is slugged the same way the gap detector's `_slug()` works (lowercase, non-alphanumeric → single hyphen, trimmed) so the qualified name's dot/underscore don't leak into the key:
- `quality_fail_<table_slug>_<col>_<test>` — e.g. `quality_fail_data-lake-news-articles-swfl_article_url_unique`. Opened on error-FAIL, auto-closed when it passes again.
- `schema_drift_<table_slug>_<col>` — opened on TYPE_CHANGED, auto-closed when the diff clears (or after `--update-baseline` re-bless lands).

(`<col>`/`<test>` are already `[a-z_]` tokens; only the qualified table needs slugging. Reuse `_slug` imported from `check_freshness`.)

`warn`-severity fails are **summary only** (no checks row) — this is why `accepted_values(source_name)` is `warn`: a new news source is an expected-to-evolve soft signal, not a tracked obligation. Auto-close scans `WHERE project = %s AND state='open' AND (check_key LIKE 'quality_fail_%' OR check_key LIKE 'schema_drift_%')` — **scoped to `_QUALITY_PROJECT`** (unlike the gap detector, which is project-unscoped) so a same-prefixed key created by another project can never be silently auto-closed; the prefix-OR is parenthesized so it binds before the state filter.

### Output

`format_value_tests(...)` + `format_schema_drift(...)` sections, mirroring `format_view_liveness` / `format_gaps`: a table of alerting rows (FAIL / drift), a clean ✅ line when all pass. Written to `$GITHUB_STEP_SUMMARY`, or stdout under `--dry-run`.

## CLI

- `python -m ingest.scripts.check_data_quality` — full run; writes summary + syncs checks ledger.
- `--dry-run` — **no mutation, not no-DB**: value-test SELECTs and the `information_schema` read still run (read-only); only the checks-ledger writes and baseline-file writes are suppressed; output to stdout.
- `--update-baseline` — re-write every `schema_baseline: true` table's JSON from the live `information_schema`. Dev-run, committed with the intended change. Implies no ledger sync.

## Error handling

Always exit 0 (mirrors `check_freshness.py`). Per-test `try`/`rollback`. A DB-connection failure or an unexpected top-level error writes a degraded summary and returns 0, exactly like `check_freshness.main`. A missing table → that table's tests are skipped with a note, never a raise.

## Testing

`ingest/tests/scripts/test_check_data_quality.py`, mirroring `test_check_freshness.py` (mocked `psycopg` connection):

1. **SQL builders** — `build_not_null_sql` / `build_unique_sql` / `build_accepted_values_sql` emit the expected `count(*)` shape. Safety is proven structurally, not by string-matching: `assert isinstance(query, psycopg.sql.Composable)` (a raw `str` fails it) and, for `accepted_values`, `assert params == [[...str values...]]` (values are bound, not in the SQL). A `.as_string(conn)` render check is allowed as a readability assertion but is **not** the safety guarantee.
2. **Baseline-diff classifier** — `diff_schema(baseline, live)` returns the locked `list[dict]` shape: an `ADDED` (baseline_type None), a `REMOVED` (live_type None), a `TYPE_CHANGED` (both set, differing); identical maps → `[]`.
3. **Quality-registry smoke** — `quality_registry.yaml` parses; every test entry has `col`/`test`/`severity`; `accepted_values` entries carry `values`; the four pilot tables are present.

Plus the two **"done when" live proofs**:
- (a) point a `not_null` test at `leepa_parcels.last_sale_amount` (20,668 NULLs) → reports `failing_rows > 0` with the right severity.
- (b) hand-edit a baseline JSON (flip one column's type) → next run reports `TYPE_CHANGED`; `--update-baseline` re-blesses → next run clean.

## Done when

- **Seed the four baselines in the same PR:** run `python -m ingest.scripts.check_data_quality --update-baseline` once, commit the four `ingest/quality/schema_baselines/*.json` files. Without this, the first CI run shows four `BASELINE_MISSING` notes (not a crash, but not the clean ✅ a reader expects) — so committing the baselines is a required build step, not optional.
- `python -m ingest.scripts.check_data_quality --dry-run` runs **green/exit 0**, summary contains a **"Quality — value tests"** section and a **"Schema drift"** section for the four pilot tables (clean ✅ once baselines are committed).
- Both seeded-failure proofs (a, b) fire as described.
- The new checks are unit-tested; adding a table key to `quality_registry.yaml` is the **only** thing that opts a table in (default = untouched, no global gate).
- Second `run:` step wired into `freshness-probe-daily.yml`; `requirements-probe.txt` unchanged (PyYAML + psycopg already present).

## Risk

Low–medium. New files / a second non-gating GHA step only; exit 0 preserved; opt-in per table. SQL-injection neutralized by `Identifier` + bound params. A value-test on a large table (leepa 548K rows) is a full scan — kept to 4 pilot tables on the existing daily cadence, no per-build inline execution.

## Ties to existing builds

- Build 22 (dlt `schema_contract`) — WRITE-time drift; this is AT-REST. Complementary.
- Build 24 (freshness/volume SLA) — same probe seam; this adds Quality + Schema beside it.
- Build 04 (SCHEMA_DRIFT classifier) — coordinate `TYPE_CHANGED` reason-code vocab.
