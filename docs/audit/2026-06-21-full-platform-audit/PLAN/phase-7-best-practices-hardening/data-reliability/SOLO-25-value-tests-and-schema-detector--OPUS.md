# 25 — value-level data tests (Quality pillar) + column-type-change detector (Schema pillar)

**Model: OPUS.** New cross-cutting probe surface over the lake's load-bearing tables — the
not_null/unique/accepted_values assertion math + the at-rest column-type diff (the `published_date` class)
are subtle and easy to get wrong silently, so Opus. **Priority: P2.** Best-practices hardening — fills the
two pillars the lake has zero coverage on (Quality, Schema), not a daily-red fix.

## The gap (verified)
The Monte Carlo "5 pillars" are Freshness · **Quality** · Volume · **Schema** · Lineage (REPORT §
observability table). Our coverage today, confirmed against the actual probe:

- **Freshness + Volume — covered.** `ingest/scripts/check_freshness.py` queries `MAX(freshness_column)` vs a
  cadence threshold (`check_tier2_entry`, ~383) and landed rows vs `expected_rows_min`
  (`check_volume_entry`, ~322). Build 24 lifts these to a warn/error SLA.
- **Schema — PARTIAL.** The only schema-aware probe is `check_view_liveness` (~97): it issues a live
  PostgREST `SELECT 1 LIMIT 1` and catches a **missing GRANT / dropped view** (404), nothing else. It does
  **not** see a column that was added, removed, or **type-changed at rest** — which is exactly the
  `news_swfl.published_date` `date`-vs-`text` class (build 01 / REPORT three-things row 1) that crashes a dlt
  LOAD with no prior warning. REPORT § Schema row: "⚠️ partial — no column-type-change detector."
- **Quality — MISSING ENTIRELY.** REPORT § Quality row: dbt value tests (`not_null` / `unique` /
  `accepted_values`) → **"none on the lake" → ❌ missing.** Nothing asserts that a load-bearing column is
  non-null, that a key is unique, or that an enum-shaped column stays inside its accepted set. The probe
  checks *that rows landed* (Volume), never *whether the values in them are sane* (Quality).

REPORT P2 #8 (THE FIX LIST): "Add value-level data tests (Quality pillar) on load-bearing lake tables; a
column-type-change detector (Schema pillar)." This build is the 1:1 transcription of that line.

## Architecture guardrail (bake this in — RULE 3 C2)
This is a **data-pipeline build.** Per RULE 3 C2 it **EXTENDS the existing probe seam** — the same
`check_freshness.py` runner + `cadence_registry.yaml` entries that already carry the per-entry, opt-in,
always-exit-0 view-liveness probe — applied to a **PILOT** set of the highest-value tables. It is **NOT** a
new global gate, **NOT** a mandatory pre-materialization contract, and is **not bundled** into the rejected
five-facet "Source Contract as spine." A table gets value-tests / a schema baseline only when its registry
entry opts in (a `value_tests:` / `schema_baseline:` block); everything else is untouched. The probe stays
**observability, not gating** (mirrors `check_freshness.py`'s "Always exits 0" contract, ~26) — a value-test
failure or schema drift surfaces in the GHA step summary (and may open a `public.checks` row, same pattern
as the structural-gap detector at ~511), it does **not** abort a build. The loud-fail SLA escalation, if any,
is build 24's job (Freshness/Volume), opt-in per source — do not duplicate it here.

## Steps
1. **PROBE FIRST (RULE 0.5 — read the actual files, do not trust the line numbers above blindly):**
   - Read `ingest/scripts/check_freshness.py` end-to-end. The reusable seam is `check_view_liveness` +
     `collect_views_manifest` + the per-entry dispatch in `run_probe` (~599) and the
     `format_*`/`sync_gap_checks` (~511–590) ledger-write pattern. Confirm: the runner carries only
     `DESTINATION__POSTGRES__CREDENTIALS` (no Supabase REST, no `.dlt/secrets.toml`), so any new check must
     run over the **existing psycopg connection**, exactly as `check_structural_gaps` does (~511) — it
     **cannot** shell out to `scripts/check.mjs`.
   - Read `ingest/cadence_registry.yaml` — see how `liveness_view:`, `freshness_table:`, `expected_rows_min:`
     hang off a pipeline entry. Your new `value_tests:` / `schema_baseline:` blocks attach the same way.
   - Confirm the live column types of the pilot tables (this is the Schema-baseline seed, and verifies the
     `information_schema` query shape): `SELECT column_name, data_type FROM information_schema.columns WHERE
     table_schema='data_lake' AND table_name IN ('news_swfl_articles','zhvi_*','zori_*',<leepa table>)
     ORDER BY table_name, ordinal_position;` (resolve the real table names — leepa/zhvi/zori naming differs
     from the brain ids; `mcp__lake__list_views` / `describe_view` or a direct `\dt data_lake.*` will show
     them). Pick **3–4 load-bearing tables only** for the pilot — news_swfl (the published_date class lives
     here), zhvi + zori (the parity-tested home-value spine), and one leepa parcels/value table. Do **not**
     boil the ocean.
2. **RULE 3.5 brainstorm (short — at execution time):** invoke `superpowers:brainstorming` to settle: (a)
   where the value-test spec lives — inline `value_tests:` in `cadence_registry.yaml` vs a sibling
   `ingest/quality/value_tests.yaml` keyed by table (keep it next to the registry the probe already loads, so
   one file load covers it); (b) the schema-baseline store — a checked-in `ingest/quality/schema_baselines/`
   JSON per pilot table (`{column: data_type}`), regenerated by an explicit `--update-baseline` flag so an
   *intended* type change is a one-command re-bless, an *unintended* one is a loud diff (mirror build 24's
   opt-in posture); (c) severity vocab — reuse dbt's `warn` | `error` words (REPORT round2 dbt-tests) but map
   both to non-gating probe output here (error = surfaced + opens a `public.checks` row; warn = summary only),
   since the probe never exits non-zero; (d) whether a failing value-test row count is *stored* (dbt's
   `store_failures`) or just counted — counted is enough for v1.
3. **Implement additively, two new check families in `check_freshness.py` (or a sibling
   `ingest/scripts/check_data_quality.py` the same GHA step invokes — decide in the brainstorm; sibling keeps
   the freshness file from ballooning):**
   - **Quality — value tests.** For each pilot table's opted-in `value_tests:` block, run the three dbt-style
     assertions as `SELECT count(*)` "failing-row" queries (dbt's model: the assertion passes iff the query
     returns zero rows — REPORT round2 dbt-tests):
     - `not_null(col)` → `SELECT count(*) FROM <t> WHERE <col> IS NULL`
     - `unique(col)` → `SELECT count(*) FROM (SELECT <col> FROM <t> WHERE <col> IS NOT NULL GROUP BY <col>
       HAVING count(*) > 1) d`
     - `accepted_values(col, [v1,v2,…])` → `SELECT count(*) FROM <t> WHERE <col> IS NOT NULL AND <col> NOT IN
       (…)`
     Use `psycopg.sql.Identifier`/parameterized values throughout (the file already imports `psycopg.sql`,
     ~226) — never string-format a table/column/value in. Each test carries `severity: warn|error`; both are
     non-gating. Wrap every query in its own try/`conn.rollback()` so a missing table can't break the run
     (same defensive pattern as `_fetch_max_freshness`, ~259).
   - **Schema — column-type-change detector.** For each opted-in `schema_baseline:` table, read live
     `information_schema.columns` (`{column_name: data_type}`), diff against the checked-in baseline JSON, and
     classify each delta as `ADDED` / `REMOVED` / `TYPE_CHANGED`. `TYPE_CHANGED` is the load-bearing one (the
     published_date class) — surface it loud. `--update-baseline` re-writes the JSON to bless an intended
     change.
   - **Surface, don't gate.** Add `format_value_tests(...)` + `format_schema_drift(...)` sections appended
     below the freshness table (mirror `format_view_liveness` / `format_gaps`, ~688/730). On an `error`-severity
     value-test failure or a `TYPE_CHANGED`, open/auto-close a `public.checks` row over the existing connection
     (reuse the `sync_gap_checks` idempotent open/auto-close logic, ~531 — new key prefixes e.g.
     `quality_fail_` / `schema_drift_`). Keep `--dry-run` mutation-free, exactly like the gap detector.
   - Keep the runner **exit 0 always** — add nothing that can fail CI.

## Done when
- `python ingest/scripts/check_freshness.py --dry-run` (or the sibling script) runs **green/exit 0** and its
  step-summary output now contains a **"Quality — value tests"** section and a **"Schema drift"** section for
  the pilot tables, alongside the existing freshness/volume/view-liveness sections.
- A **deliberately seeded failure proves each detector fires:** (a) point a `not_null` test at a column known
  to contain a NULL → it reports the failing-row count (non-zero) with the right severity; (b) hand-edit a
  pilot table's baseline JSON (flip one column's type) and re-run → the Schema section reports
  `TYPE_CHANGED` for that column; then `--update-baseline` re-blesses it and the next run is clean.
- The new checks are **unit-tested** (the failing-row SQL builders + the baseline-diff classifier) the same
  way the rest of the probe is, and adding a `value_tests:`/`schema_baseline:` block to a registry entry is
  the **only** thing that opts a table in (default = untouched, no global gate).

## Risk
Low–medium. New files / additive blocks only; non-gating (exit 0 preserved); opt-in per table. The one real
hazard is **SQL injection via table/column/accepted-value interpolation** — neutralized by routing every
identifier through `psycopg.sql.Identifier` and every value through a bound parameter (never an f-string).
Secondary: a value-test on a large table is a full scan — keep the pilot set to 3–4 tables and the cadence to
the probe's existing daily run, don't add per-build inline execution.

## References (added 2026-06-22 — best-practices fold-in)
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round2/data-dbt-tests.md` — not_null/unique/accepted_values, severity warn|error (the four built-in dbt generic tests; a test passes iff its failing-row query returns zero rows)
- `docs/audit/2026-06-21-best-practices-research/round2/data-contract-spec.md` — schema+quality+SLA as a versioned artifact (descriptive contract, NOT a gate — informs the opt-in `value_tests:`/`schema_baseline:` block shape, not a mandatory pre-materialization spine)
- `docs/audit/2026-06-21-best-practices-research/round3/q-data-observability-pillars.md` — the Quality + Schema pillars this build fills (Quality = %NULL/%unique/accepted range; Schema = added/removed/type-changed columns)
**crawl4ai-live (docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — data-reliability build)
**Ties to existing builds:** build 22 (dlt `schema_contract` — catches drift at **WRITE** time; this build catches it **at REST** — complementary, not redundant) · build 24 (freshness/volume SLA — same probe seam, this build adds the Quality + Schema pillars beside it) · build 04 (the SCHEMA_DRIFT classifier — coordinate vocab so the at-rest `TYPE_CHANGED` signal aligns with the classifier's reason codes)
